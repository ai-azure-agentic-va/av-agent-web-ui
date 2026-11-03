import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThinkingStep } from "@/providers/Stream";
import { ACTIVITY_LABELS } from "@/lib/activity-labels";
import { ToolStepRaw, ToolStepSummary } from "./messages/tool-calls";

// The current turn's clock, provided once by Thread. `startedAt` is when the
// turn began (null while idle); `seen` remembers which steps have already
// risen in, so the chain doesn't replay its entrance when its host message
// changes mid-turn (each change remounts it).
export type TurnClock = { startedAt: number | null; seen: Set<string> };
export const LiveClockContext = createContext<TurnClock>({
  startedAt: null,
  seen: new Set(),
});

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useElapsed(since: number | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);

  return since == null ? null : formatElapsed(now - since);
}

// Turn geometry, shared with the speaker marks: a 40px gutter holding a 28px
// mark column, with the 2px rail through its centre (13px + 1px = 14px).
export const TURN_GUTTER = "pl-10";
const MARK_COLUMN = "absolute -left-10 flex w-7 justify-center";
const RAIL = "bg-rail absolute -left-10 ml-[13px] w-0.5";

type NodeState = "done" | "gap" | "live" | "stopped" | "summary";

// Beads on the rail. Each carries a white ring so the rail breaks around it.
function Node({ state }: { state: NodeState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ring-background ring-[3px]",
        state === "done" && "bg-foreground size-2 rounded-full",
        state === "gap" &&
          "border-foreground bg-background size-2 rounded-full border-[1.5px]",
        state === "live" && "bg-signal live-dot size-2.5 rounded-full",
        state === "stopped" &&
          "border-muted-foreground bg-background size-2 rounded-full border-[1.5px]",
        state === "summary" && "bg-foreground size-1.5",
      )}
    />
  );
}

// How the rail leaves the chain's last element: on into the answer's U, open
// (dashed) while the agent is still working, or stopping at the last bead.
type Tail = "answer" | "open" | "end";

function Segment({
  last,
  tail,
  bead = "h-4",
}: {
  last: boolean;
  tail: Tail;
  // Height from the element's top to its bead's centre, where an ending rail stops.
  bead?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        RAIL,
        "top-0",
        !last && "bottom-0",
        // 8px into the 12px gap above the answer, stopping 4px short of the U.
        last && tail === "answer" && "-bottom-2",
        last && tail === "open" && "bottom-0",
        // Stop at the last bead's centre (a step row's is 6px padding + half
        // its 20px line).
        last && tail === "end" && bead,
      )}
    />
  );
}

function StepRow({
  step,
  live,
  last,
  tail,
  showDetail,
}: {
  step: ThinkingStep;
  live: boolean;
  last: boolean;
  tail: Tail;
  showDetail: boolean;
}) {
  const clock = useContext(LiveClockContext);
  const isDone = step.endedAt !== undefined;
  const isGap = step.key.startsWith("think:");
  const state: NodeState = isDone
    ? isGap
      ? "gap"
      : "done"
    : live
      ? "live"
      : "stopped";
  const elapsed = useElapsed(
    state === "live" ? (step.liveStartedAt ?? clock.startedAt) : null,
  );
  // Decided once per mount: only a step new to this turn rises in.
  const [enter] = useState(() => live && !clock.seen.has(step.key));
  useEffect(() => {
    clock.seen.add(step.key);
  }, [clock.seen, step.key]);

  const rawId = useId();
  const [showRaw, setShowRaw] = useState(false);
  const tool = showDetail ? step.tool : undefined;

  const duration =
    step.durationMs == null
      ? null
      : step.durationMs < 1000
        ? "<1"
        : String(Math.round(step.durationMs / 1000));

  const line = (
    <>
      <span
        className={cn(
          "min-w-0 break-words",
          state === "live" && "font-medium",
          (state === "gap" || state === "stopped") && "text-muted-foreground",
        )}
      >
        {step.label}
      </span>
      {state === "live" && elapsed ? (
        <span className="shrink-0 text-xs">{elapsed}</span>
      ) : state === "stopped" ? (
        <span className="text-muted-foreground shrink-0 text-xs">
          {ACTIVITY_LABELS.stopped}
        </span>
      ) : duration != null ? (
        <span className="text-muted-foreground shrink-0 text-xs">
          {duration}
          {ACTIVITY_LABELS.thoughtSuffix}
        </span>
      ) : null}
    </>
  );

  return (
    <li className={cn("relative py-1.5", enter && "step-in")}>
      <Segment
        last={last}
        tail={tail}
      />
      <span className={cn(MARK_COLUMN, "top-1.5 h-5 items-center")}>
        <Node state={state} />
      </span>
      {tool ? (
        // With tool details on, the step's label opens its raw input/output.
        <button
          type="button"
          aria-expanded={showRaw}
          aria-controls={rawId}
          onClick={() => setShowRaw((v) => !v)}
          className="group/raw focus-visible:ring-ring -mx-1 flex max-w-full items-baseline gap-2 rounded-md px-1 text-left text-sm leading-5 outline-none focus-visible:ring-2"
        >
          {line}
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "text-muted-foreground group-hover/raw:text-foreground size-3.5 shrink-0 self-center transition-transform",
              showRaw && "rotate-90",
            )}
          />
          <span className="sr-only">
            {showRaw
              ? "Hide raw input and output"
              : "Show raw input and output"}
          </span>
        </button>
      ) : (
        <div className="flex items-baseline gap-2 text-sm leading-5">
          {line}
        </div>
      )}
      {tool && <ToolStepSummary tool={tool} />}
      {tool && showRaw && (
        <ToolStepRaw
          id={rawId}
          tool={tool}
        />
      )}
    </li>
  );
}

function stepCount(n: number): ReactNode {
  const noun =
    n === 1 ? ACTIVITY_LABELS.stepNoun.one : ACTIVITY_LABELS.stepNoun.many;
  return `${n} ${noun}`;
}

/**
 * The turn's chain of thought: one rail running from the person's initials at
 * the question to the IVY leaf at the answer, with every step the agent took
 * as a bead on it.
 *
 * While the agent works the chain is open and grows step by step, the current
 * step a pulsing red bead with its own clock, the rail left open below it. The
 * moment the answer starts, it folds into a single 36px row so the answer
 * copy never moves; the user can reopen it at any time.
 */
export function TurnChain({
  steps,
  live = false,
  answerStarted,
  expanded,
  onToggle,
  showDetail,
}: {
  steps: ThinkingStep[];
  live?: boolean;
  answerStarted: boolean;
  // null = automatic: open while working, folded once the answer starts.
  expanded: boolean | null;
  onToggle?: () => void;
  showDetail: boolean;
}) {
  const panelId = useId();
  const clock = useContext(LiveClockContext);
  // The turn's running clock stays on the folded header while the answer is
  // written, like an on-air counter.
  const turnElapsed = useElapsed(live ? clock.startedAt : null);
  if (!steps.length) return null;

  const working = live && !answerStarted;
  const open = expanded ?? working;
  // In the automatic working phase the steps speak for themselves; the header
  // row appears once there is something to fold.
  const showHeader = !(working && expanded === null);
  const tail: Tail = working ? "open" : answerStarted ? "answer" : "end";

  const openStep = steps.find((s) => s.endedAt === undefined);
  const totalMs = steps.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  const hasDurations = steps.some((s) => s.durationMs != null);
  const unfinished = !live && !!openStep;

  // Live, the header names what is happening now; settled, how long it took.
  const summary = live ? (
    <span>
      {openStep?.label ?? ACTIVITY_LABELS.working}
      {turnElapsed && (
        <span className="text-foreground ml-2">{turnElapsed}</span>
      )}
    </span>
  ) : hasDurations ? (
    // One span, so the row's flex gap can't land inside the phrase.
    <span>
      {unfinished
        ? ACTIVITY_LABELS.stoppedPrefix
        : ACTIVITY_LABELS.thoughtPrefix}{" "}
      {Math.max(1, Math.round(totalMs / 1000))}
      {ACTIVITY_LABELS.thoughtSuffix} · {stepCount(steps.length)}
    </span>
  ) : (
    <span>
      {unfinished ? ACTIVITY_LABELS.stopped : ACTIVITY_LABELS.thoughtProcess} ·{" "}
      {stepCount(steps.length)}
    </span>
  );

  return (
    <div className="relative">
      {/* Screen readers hear each live step once, not the ticking clocks. */}
      {live && (
        <span
          role="status"
          className="sr-only"
        >
          {openStep?.label ?? ACTIVITY_LABELS.working}
        </span>
      )}
      {showHeader && onToggle && (
        <div className="relative">
          <Segment
            last={!open}
            tail={tail}
            bead="h-[18px]"
          />
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            // Toggle on pointer-down, not click: while the answer streams,
            // StickToBottom auto-scrolls the list, which can move this button
            // between mousedown and mouseup so the derived `click` is unreliable.
            onPointerDown={(e) => {
              e.preventDefault();
              onToggle();
            }}
            // Keyboard equivalent (pointer-down doesn't fire for Enter/Space).
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle();
              }
            }}
            className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring relative flex h-9 items-center gap-2 rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-2"
          >
            <span className={cn(MARK_COLUMN, "inset-y-0 items-center")}>
              <Node state="summary" />
            </span>
            {summary}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
      )}
      {open && (
        <ol
          id={panelId}
          className={cn("flex flex-col", showHeader && "pb-1")}
        >
          {steps.map((step, i) => (
            <StepRow
              key={`${step.key}-${step.startedAt}`}
              step={step}
              live={live}
              last={i === steps.length - 1}
              tail={tail}
              showDetail={showDetail}
            />
          ))}
        </ol>
      )}
      {working && (
        // The rail stays open below the current step until the answer lands.
        <div
          aria-hidden="true"
          className="relative h-10"
        >
          <span className="chain-tail absolute top-0 -left-10 ml-[13px] h-full w-0.5" />
        </div>
      )}
    </div>
  );
}

/**
 * A single live line outside the conversation (the sign-in redirect): the same
 * red bead and words as a running step, without the rail.
 */
export function LiveLine({ label }: { label: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-3 text-[15px] font-medium"
    >
      <Node state="live" />
      {label}
    </p>
  );
}
