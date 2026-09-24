import { parsePartialJson } from "@langchain/core/output_parsers";
import { useStreamContext, ThinkingStep } from "@/providers/Stream";
import { AIMessage, Checkpoint, Message } from "@langchain/langgraph-sdk";
import {
  getContentString,
  stripFollowUpSection,
  linkifyCitations,
  hasInlineCitation,
} from "../utils";
import { DocumentsAnalyzed } from "./documents-analyzed";
import { BranchSwitcher, CommandBar } from "./shared";
import { MarkdownText } from "../markdown-text";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import { cn } from "@/lib/utils";
import { ToolCalls, ToolResult } from "./tool-calls";
import { ContentBlock } from "@langchain/core/messages";
import { Fragment } from "react/jsx-runtime";
import { isAgentInboxInterruptSchema } from "@/lib/agent-inbox-interrupt";
import { ThreadView } from "../agent-inbox";
import { useQueryState, parseAsBoolean } from "nuqs";
import { GenericInterruptView } from "./generic-interrupt";
import { useArtifact } from "../artifact";
import { useDeferredValue, useMemo, useState } from "react";
import { Bot, Check, ChevronRight } from "lucide-react";
import { MessageFeedback } from "@/components/thread/feedback";
import { DebugSection } from "./debug-section";
import { ACTIVITY_LABELS } from "@/lib/activity-labels";

function CustomComponent({
  message,
  thread,
}: {
  message: Message;
  thread: ReturnType<typeof useStreamContext>;
}) {
  const artifact = useArtifact();
  const { values } = useStreamContext();
  const customComponents = values.ui?.filter(
    (ui) => ui.metadata?.message_id === message.id,
  );

  if (!customComponents?.length) return null;
  return (
    <Fragment key={message.id}>
      {customComponents.map((customComponent) => (
        <LoadExternalComponent
          key={customComponent.id}
          stream={thread as any}
          message={customComponent}
          meta={{ ui: customComponent, artifact }}
        />
      ))}
    </Fragment>
  );
}

function parseAnthropicStreamedToolCalls(
  content: ContentBlock[],
): AIMessage["tool_calls"] {
  const toolCallContents = content.filter((c) => c.type === "tool_use" && c.id);

  return toolCallContents.map((tc) => {
    const toolCall = tc as Record<string, any>;
    let json: Record<string, any> = {};
    if (toolCall?.input) {
      try {
        json = parsePartialJson(toolCall.input) ?? {};
      } catch {
        // Pass
      }
    }
    return {
      name: toolCall.name ?? "",
      id: toolCall.id ?? "",
      args: json,
      type: "tool_call",
    };
  });
}

interface InterruptProps {
  interrupt?: unknown;
  isLastMessage: boolean;
  hasNoAIOrToolMessages: boolean;
}

function Interrupt({
  interrupt,
  isLastMessage,
  hasNoAIOrToolMessages,
}: InterruptProps) {
  const fallbackValue = Array.isArray(interrupt)
    ? (interrupt as Record<string, any>[])
    : (((interrupt as { value?: unknown } | undefined)?.value ??
        interrupt) as Record<string, any>);

  return (
    <>
      {isAgentInboxInterruptSchema(interrupt) &&
        (isLastMessage || hasNoAIOrToolMessages) && (
          <ThreadView interrupt={interrupt} />
        )}
      {interrupt &&
      !isAgentInboxInterruptSchema(interrupt) &&
      (isLastMessage || hasNoAIOrToolMessages) ? (
        <GenericInterruptView interrupt={fallbackValue} />
      ) : null}
    </>
  );
}

export function AssistantMessage({
  message,
  isLoading,
  handleRegenerate,
}: {
  message: Message | undefined;
  isLoading: boolean;
  handleRegenerate: (parentCheckpoint: Checkpoint | null | undefined) => void;
}) {
  // Stable identity for the message content so the memos below don't re-run
  // every render (the `?? []` fallback would otherwise be a fresh array each time).
  const content = useMemo(() => message?.content ?? [], [message?.content]);
  // Strip the "Want to explore further?" section — it renders as chips below.
  // Memoized on the raw content so this (and the markdown linkify below) is not
  // recomputed on every streamed token for messages whose content is unchanged.
  const contentString = useMemo(
    () => stripFollowUpSection(getContentString(content)),
    [content],
  );
  const [hideToolCallsToggle] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );
  // Tool calls are an internal/debug surface. When NEXT_PUBLIC_HIDE_TOOL_CALLS
  // is set (e.g. in production) they are force-hidden; otherwise the composer
  // switch toggles them.
  const hideToolCalls =
    process.env.NEXT_PUBLIC_HIDE_TOOL_CALLS === "true" || hideToolCallsToggle;

  const thread = useStreamContext();
  const isLastMessage =
    thread.messages[thread.messages.length - 1]?.id === message?.id;
  // Hoisted to the provider (computed once per messages change) — reading the
  // precomputed flag avoids an O(n) scan here on every streamed token.
  const hasNoAIOrToolMessages = thread.hasNoAIOrToolMessages;
  const meta = message ? thread.getMessagesMetadata(message) : undefined;
  const threadInterrupt = thread.interrupt;

  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
  const anthropicStreamedToolCalls = useMemo(
    () =>
      Array.isArray(content)
        ? parseAnthropicStreamedToolCalls(content)
        : undefined,
    [content],
  );

  const hasToolCalls =
    message &&
    "tool_calls" in message &&
    message.tool_calls &&
    message.tool_calls.length > 0;
  const toolCallsHaveContents =
    hasToolCalls &&
    message.tool_calls?.some(
      (tc) => tc.args && Object.keys(tc.args).length > 0,
    );
  const hasAnthropicToolCalls = !!anthropicStreamedToolCalls?.length;
  const isToolResult = message?.type === "tool";

  // This answer's OWN retrieved set (undefined when the turn ran no search of its
  // own). Used only to decide whether an otherwise-empty tool-call message is worth
  // rendering (see the early return below); the visible panel uses the cumulative
  // set instead.
  const documents = message?.id
    ? thread.documentsMap?.[message.id]
    : undefined;
  // Cumulative referenced sources for THIS answer — and the set inline [n] markers
  // resolve against. The backend numbers documents append-only across the WHOLE
  // conversation, so an answer's own set is already the running list as of that
  // turn; a turn that searched nothing falls back to the nearest preceding answer's
  // list so any carried-forward [n] markers still link. Feeds the inline-citation
  // linkify, and the panel — but the panel renders only when this answer actually
  // cites into the list (see showReferencedSources below); a turn whose text cites
  // nothing shows no panel even though this fallback set is non-empty.
  // O(1) lookup into the map the provider rebuilds once per messages change
  // (previously an O(n) backward scan per message per streamed token).
  const citationDocuments = message?.id
    ? thread.citationDocumentsMap.get(message.id)
    : undefined;
  const debug = message?.id ? thread.debugMap?.[message.id] : undefined;

  // Host the LIVE activity disclosure on the current turn's last AI message, so
  // it sits on top of the streaming answer in the same slot the settled "Thought
  // for Ns" disclosure will occupy — no position jump when the run finishes.
  // The last-AI-id scan is hoisted to the provider (thread.liveHostAiId).
  const showLiveThought =
    thread.isLoading &&
    message?.id === thread.liveHostAiId &&
    thread.thinkingSteps.length > 0;

  // For every COMPLETED turn (this session or opened from history), the trace is
  // rebuilt from the turn's messages + their checkpoint timestamps — consistent
  // everywhere (durations come from created_at) and needs no sealed session
  // state. The per-answer derivation lives in the provider's historicalStepsMap
  // (one O(n) pass per messages change); only a turn's answer message has an
  // entry, so this stays an O(1) lookup per render.
  const historicalSteps =
    !isToolResult && !showLiveThought && message?.id
      ? (thread.historicalStepsMap.get(message.id) ?? null)
      : null;

  // Citation-linked markdown source. Memoized so the regex linkify only re-runs
  // when this message's content or its documents change — not every render of an
  // unrelated streaming turn. During streaming `documents` is empty, so this is
  // just the raw content; once documents arrive the `[n]` markers become links.
  const linkedContent = useMemo(
    () => linkifyCitations(contentString, citationDocuments),
    [contentString, citationDocuments],
  );

  // Deferring the markdown source keeps the browser responsive while an answer
  // streams: re-parsing the whole (growing) markdown every token is O(n) per
  // token / O(n²) over the turn and runs synchronously, which otherwise
  // saturates the main thread and freezes all input (e.g. the disclosure arrow).
  // useDeferredValue renders the expensive markdown at low priority, so urgent
  // updates — clicks, scrolling — can interrupt it. Settled messages are
  // unaffected (their content never changes, so deferred === current).
  const deferredContent = useDeferredValue(linkedContent);

  // Only surface the cumulative "Referenced Sources" panel when THIS answer
  // actually cites into it — i.e. its text carries at least one inline `[n]`
  // marker that resolves to a referenced document. A turn that renders text
  // without citing anything (a follow-up reformat that ran no search of its own,
  // or a plain reply) no longer drags the whole running source list forward.
  const showReferencedSources = useMemo(
    () =>
      contentString.length > 0 &&
      !!citationDocuments &&
      citationDocuments.length > 0 &&
      hasInlineCitation(contentString, citationDocuments),
    [contentString, citationDocuments],
  );


  // The run_id for feedback comes from the `done` SSE event payload,
  // stored on lastDonePayload by Stream.tsx
  const lastDonePayload = thread.lastDonePayload as Record<
    string,
    unknown
  > | null;
  const runId =
    isLastMessage && !isLoading && lastDonePayload
      ? ((lastDonePayload.run_id as string | null) ?? null)
      : null;

  if (isToolResult && hideToolCalls) {
    return null;
  }

  // An AI message that only carries tool calls has no visible body when tool
  // calls are hidden. Skip it entirely (avatar included) so it doesn't render
  // as a lone empty AI icon. Keep it if anything else would render here.
  const customComponents = thread.values.ui?.filter(
    (ui) => ui.metadata?.message_id === message?.id,
  );
  const interruptVisible =
    !!threadInterrupt && (isLastMessage || hasNoAIOrToolMessages);
  if (
    !isToolResult &&
    hideToolCalls &&
    contentString.length === 0 &&
    (hasToolCalls || hasAnthropicToolCalls) &&
    !(documents && documents.length > 0) &&
    !debug &&
    !interruptVisible &&
    !customComponents?.length &&
    !showLiveThought &&
    !historicalSteps
  ) {
    return null;
  }

  return (
    <div className="message-animate group flex w-full items-start gap-3">
      {/* Avatar */}
      {!isToolResult && (
        <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3",
          isToolResult && "ml-11",
        )}
      >
        {isToolResult ? (
          <>
            <ToolResult message={message} />
            <Interrupt
              interrupt={threadInterrupt}
              isLastMessage={isLastMessage}
              hasNoAIOrToolMessages={hasNoAIOrToolMessages}
            />
          </>
        ) : (
          <>
            {showLiveThought ? (
              <ThoughtDisclosure steps={thread.thinkingSteps} live />
            ) : historicalSteps ? (
              <ThoughtDisclosure steps={historicalSteps} />
            ) : null}

            {contentString.length > 0 && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {/* Render markdown live as tokens stream in, instead of showing
                    plain text and only formatting once the stream completes. */}
                <MarkdownText>{deferredContent}</MarkdownText>
              </div>
            )}

            {!hideToolCalls && (
              <>
                {(hasToolCalls && toolCallsHaveContents && (
                  <ToolCalls toolCalls={message.tool_calls} />
                )) ||
                  (hasAnthropicToolCalls && (
                    <ToolCalls toolCalls={anthropicStreamedToolCalls} />
                  )) ||
                  (hasToolCalls && (
                    <ToolCalls toolCalls={message.tool_calls} />
                  ))}
              </>
            )}

            {/* Cumulative "Referenced Sources" (append-only, collapsed by
                default), shown only when THIS answer actually cites into the list
                — its text carries at least one inline [n] marker resolving to a
                referenced document (see showReferencedSources). An answer with no
                inline citation (a follow-up reformat that ran no search, or a
                plain reply) no longer drags the running list forward. */}
            {showReferencedSources && citationDocuments && (
              <DocumentsAnalyzed documents={citationDocuments} />
            )}

            {debug && <DebugSection debug={debug} />}

            {message && (
              <CustomComponent
                message={message}
                thread={thread}
              />
            )}

            <Interrupt
              interrupt={threadInterrupt}
              isLastMessage={isLastMessage}
              hasNoAIOrToolMessages={hasNoAIOrToolMessages}
            />

            {/* Toolbar row: thumbs up, thumbs down, copy, refresh */}
            <div
              className="flex items-center gap-2"
            >
              <BranchSwitcher
                branch={meta?.branch}
                branchOptions={meta?.branchOptions}
                onSelect={(branch) => thread.setBranch(branch)}
                isLoading={isLoading}
              />
              {/* Feedback thumbs sit left of copy/refresh */}
              <MessageFeedback runId={runId} />
              <CommandBar
                content={contentString}
                isLoading={isLoading}
                isAiMessage={true}
                handleRegenerate={() => handleRegenerate(parentCheckpoint)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A single collapsed disclosure anchored on top of the assistant answer. It is
// shown BOTH while the turn is generating (live: header = current activity, e.g.
// "Searching ServiceNow tickets…", with a pulse) and after it finishes (sealed:
// header = "Thought for Ns"). Rendering it in the same slot in both states is
// what stops the old "jump" where the trace only appeared after generation.
function ThoughtDisclosure({
  steps,
  live = false,
}: {
  steps: ThinkingStep[];
  live?: boolean;
}) {
  // Settled/historical disclosures own their expand state locally. The LIVE one
  // reads/writes shared context state so it survives the host AI message changing
  // mid-turn (each change would otherwise remount a fresh, collapsed disclosure).
  const thread = useStreamContext();
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = live ? thread.liveThoughtExpanded : localExpanded;
  const setExpanded = live ? thread.setLiveThoughtExpanded : setLocalExpanded;

  if (!steps.length) return null;

  // Total = sum of per-activity durations, so the collapsed header and the
  // expanded breakdown always reconcile (the "Thinking" gap steps make the
  // per-activity durations tile the whole turn).
  const totalMs = steps.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  const hasDurations = steps.some((s) => s.durationMs != null);

  // While live, prefer the currently-open step's label; if all steps have
  // closed (e.g. search finished and the answer is now streaming), fall back to
  // the generic working label.
  const openStep = steps.find((s) => s.endedAt === undefined);
  const headerLabel = live
    ? (openStep?.label ?? ACTIVITY_LABELS.working)
    : hasDurations
      ? `${ACTIVITY_LABELS.thoughtPrefix} ${Math.max(1, Math.round(totalMs / 1000))}${ACTIVITY_LABELS.thoughtSuffix}`
      : ACTIVITY_LABELS.thoughtProcess;

  return (
    <div className="text-muted-foreground text-sm">
      <button
        type="button"
        // Toggle on pointer-down, not click: while the answer streams,
        // StickToBottom auto-scrolls the list, which can move this button
        // between mousedown and mouseup so the derived `click` is unreliable.
        // pointer-down fires on press, immune to the element shifting. We do NOT
        // also toggle on click — preventDefault here doesn't suppress the click,
        // so a second toggle there would cancel this one out and look "stuck".
        onPointerDown={(e) => {
          e.preventDefault();
          setExpanded(!expanded);
        }}
        // Keyboard equivalent (pointer-down doesn't fire for Enter/Space).
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className="hover:text-foreground flex items-center gap-1.5 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />
        {live && (
          <span className="bg-primary/60 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" />
        )}
        <span className={cn(live && "italic")}>{headerLabel}</span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5 pl-1">
          {steps.map((step) => {
            const isDone = step.endedAt !== undefined;
            const isGap = step.key.startsWith("think:");
            // Per-activity duration (from created_at).
            const stepSec =
              step.durationMs !== undefined
                ? Math.max(1, Math.round(step.durationMs / 1000))
                : null;
            return (
              <div
                key={`${step.key}-${step.startedAt}`}
                className="flex items-center gap-2"
              >
                {isGap ? (
                  // Reasoning gap — neutral marker, not a task checkmark.
                  // Pulses while the gap is still in progress (live thinking).
                  <div
                    className={cn(
                      "border-muted-foreground/50 h-2 w-2 shrink-0 rounded-full border",
                      !isDone && "bg-muted-foreground/40 animate-pulse",
                    )}
                  />
                ) : isDone ? (
                  <Check className="text-primary h-3.5 w-3.5 shrink-0" />
                ) : (
                  <div className="bg-primary/60 h-2 w-2 shrink-0 animate-pulse rounded-full" />
                )}
                <span
                  className={cn((!isDone || isGap) && "text-muted-foreground")}
                >
                  {step.label}
                </span>
                {stepSec != null && (
                  <span className="text-muted-foreground/70 text-xs">
                    · {ACTIVITY_LABELS.thoughtPrefix} {stepSec}
                    {ACTIVITY_LABELS.thoughtSuffix}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AssistantMessageLoading({
  thinkingStep,
}: {
  thinkingStep?: string;
}) {
  return (
    <div className="message-animate flex items-start gap-3">
      <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="bg-muted flex items-center gap-1.5 rounded-2xl px-4 py-3">
          <div className="bg-muted-foreground/40 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s]" />
          <div className="bg-muted-foreground/40 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s]" />
          <div className="bg-muted-foreground/40 h-2 w-2 animate-bounce rounded-full" />
        </div>
        {thinkingStep && (
          <p className="text-muted-foreground ml-1 text-xs italic">
            {thinkingStep}
          </p>
        )}
      </div>
    </div>
  );
}

