import { ConversationThread, useThreads } from "@/providers/Thread";
import { KeyboardEvent, useEffect, useRef } from "react";
import { getContentString } from "../utils";
import { useQueryState, parseAsBoolean } from "nuqs";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RotateCw } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { useBackgroundRuns } from "@/lib/background-runs";
import { SkillList } from "../skills/skill-list";
import {
  type SidebarView,
  useOpenSkill,
  useSidebarView,
} from "../skills/state";

function ThreadList({
  threads,
  onThreadClick,
}: {
  threads: ConversationThread[];
  onThreadClick?: (threadId: string) => void;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const [, setOpenSkill] = useOpenSkill();
  // Threads with a run still streaming in this tab (kept alive server-side by
  // resumable submits) — badge them so the user can tell which conversations
  // are working in the background while they browse others.
  const runningThreads = useBackgroundRuns();

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-1 px-5 py-4">
        <p className="text-foreground text-sm font-medium">
          No conversations yet
        </p>
        <p className="text-muted-foreground text-sm font-light">
          Start a new chat to begin
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 scrollbar-thin flex-col gap-0.5 overflow-y-auto px-3">
      {threads.map((t) => {
        let itemText =
          t.title ||
          (typeof t.metadata?.title === "string" ? t.metadata.title : "") ||
          t.thread_id;
        if (
          !t.title &&
          typeof t.values === "object" &&
          t.values &&
          "messages" in t.values &&
          Array.isArray(t.values.messages) &&
          t.values.messages?.length > 0
        ) {
          const firstMessage = t.values.messages[0];
          if (firstMessage?.content !== undefined) {
            // Attachment-only first message has no text — keep the fallback.
            itemText = getContentString(firstMessage.content) || itemText;
          }
        }
        const updatedAt = t.updated_at
          ? new Date(t.updated_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : undefined;
        const isActive = t.thread_id === threadId;
        const isRunning = runningThreads.has(t.thread_id);

        return (
          <button
            key={t.thread_id}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onThreadClick?.(t.thread_id);
              // A conversation takes the reading column back from a skill.
              void setOpenSkill(null);
              if (t.thread_id === threadId) return;
              setThreadId(t.thread_id);
            }}
            className={cn(
              "group text-foreground focus-visible:ring-ring flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2",
              isActive ? "bg-muted font-medium" : "hover:bg-muted/60",
            )}
          >
            <span className="line-clamp-2 flex-1 text-sm">{itemText}</span>
            {isRunning ? (
              // Same red as the live strap: this thread is still on air.
              <span
                className="flex h-5 shrink-0 items-center"
                role="status"
                aria-label="Response in progress"
                title="Response in progress"
              >
                <span className="live-dot bg-signal size-2 rounded-full" />
              </span>
            ) : (
              updatedAt && (
                <span className="text-muted-foreground mt-0.5 shrink-0 text-xs font-normal">
                  {updatedAt}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div
      className="flex flex-1 flex-col gap-2 px-2"
      role="status"
      aria-label="Loading conversations"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={`skeleton-${i}`}
          className="flex items-start gap-3 px-3 py-2.5"
        >
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-9 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ThreadHistoryError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-1 flex-col items-start gap-3 px-5 py-4"
      role="alert"
    >
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">
          Couldn&apos;t load conversations
        </p>
        <p className="text-muted-foreground text-sm font-light">
          Check your connection and try again.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
      >
        <RotateCw />
        Try again
      </Button>
    </div>
  );
}

function ThreadHistoryBody({
  onThreadClick,
}: {
  onThreadClick?: (threadId: string) => void;
}) {
  const { refreshThreads, threads, threadsLoading, threadsError } =
    useThreads();
  const retry = () => void refreshThreads().catch(console.error);

  // Skeletons only while there is nothing to show yet. Background refreshes
  // (after every completed run) keep the current list in place instead of
  // flashing it back to placeholders.
  if (threads.length === 0) {
    if (threadsLoading) return <ThreadHistoryLoading />;
    if (threadsError) return <ThreadHistoryError onRetry={retry} />;
  }
  return (
    <ThreadList
      threads={threads}
      onThreadClick={onThreadClick}
    />
  );
}

const VIEWS: { value: SidebarView; label: string }[] = [
  { value: "conversations", label: "Conversations" },
  { value: "skills", label: "Skills" },
];

// The sidebar's two lists behind one segmented switch in its 52px head: a
// tab list, with the arrow keys moving between the two tabs.
function SidebarPanels({
  idPrefix,
  onNavigate,
  headClassName,
}: {
  // Fixed per placement (rail or sheet) rather than from useId: these ids are
  // server-rendered, and a tree-position id can come out different on the
  // client, which React reports as a hydration mismatch and never repairs.
  idPrefix: string;
  // Called when a row takes the person somewhere, so the mobile sheet closes.
  onNavigate?: () => void;
  headClassName?: string;
}) {
  const [view, setView] = useSidebarView();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (v: SidebarView) => `${idPrefix}-tab-${v}`;
  const panelId = `${idPrefix}-panel`;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = VIEWS.findIndex((v) => v.value === view);
    const next =
      (current + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) %
      VIEWS.length;
    void setView(VIEWS[next].value);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <div
        className={cn(
          "border-sidebar-border flex h-13 shrink-0 items-center border-b px-4",
          headClassName,
        )}
      >
        <div
          role="tablist"
          aria-label="Sidebar"
          onKeyDown={handleKeyDown}
          className="border-foreground grid w-full grid-cols-2 rounded-md border p-0.5"
        >
          {VIEWS.map((v, i) => {
            const selected = v.value === view;
            return (
              <button
                key={v.value}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={tabId(v.value)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => void setView(v.value)}
                className={cn(
                  "focus-visible:ring-ring rounded-[6px] py-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2",
                  selected
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(view)}
        className="flex flex-1 flex-col overflow-hidden"
      >
        {view === "skills" ? (
          <SkillList onNavigate={onNavigate} />
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden py-3">
            <ThreadHistoryBody onThreadClick={onNavigate} />
          </div>
        )}
      </div>
    </>
  );
}

export default function ThreadHistory() {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );

  const { refreshThreads } = useThreads();

  useEffect(() => {
    if (typeof window === "undefined") return;
    void refreshThreads().catch(console.error);
  }, [refreshThreads]);

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="bg-sidebar hidden h-full w-[280px] shrink-0 flex-col lg:flex">
        <SidebarPanels idPrefix="sidebar" />
      </div>

      {/* Mobile Sheet */}
      <div className="lg:hidden">
        <Sheet
          open={!!chatHistoryOpen && isLargeScreen === false}
          onOpenChange={(open) => {
            if (isLargeScreen !== false) return;
            setChatHistoryOpen(open);
          }}
        >
          <SheetContent
            side="left"
            className="flex w-[280px] flex-col gap-0 p-0"
          >
            <SheetTitle className="sr-only">Sidebar</SheetTitle>
            {/* Room on the right for the sheet's own close button. */}
            <SidebarPanels
              idPrefix="sidebar-sheet"
              headClassName="pr-12"
              onNavigate={() => setChatHistoryOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
