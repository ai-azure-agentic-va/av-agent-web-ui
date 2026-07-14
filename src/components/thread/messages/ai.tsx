import { parsePartialJson } from "@langchain/core/output_parsers";
import {
  useStreamContext,
  ThinkingStep,
  deriveActivityStepsForAnswer,
  isTurnAnswer,
} from "@/providers/Stream";
import { AIMessage, Checkpoint, Message } from "@langchain/langgraph-sdk";
import {
  getContentString,
  stripFollowUpSection,
  linkifyCitations,
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
    thread.messages[thread.messages.length - 1].id === message?.id;
  const hasNoAIOrToolMessages = !thread.messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );
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

  const documents = message?.id
    ? thread.documentsMap?.[message.id]
    : undefined;
  const debug = message?.id ? thread.debugMap?.[message.id] : undefined;
  const thoughtEntry = message?.id ? thread.thinkingStepsMap?.[message.id] : undefined;

  // Host the LIVE activity disclosure on the current turn's last AI message, so
  // it sits on top of the streaming answer in the same slot the sealed "Thought
  // for Ns" disclosure will occupy — no position jump when the run finishes.
  const lastAiId = useMemo(() => {
    // Only needed while streaming; skip the scan on settled threads.
    if (!thread.isLoading) return null;
    const msgs = thread.messages;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i]?.type === "ai" && msgs[i]?.id) return msgs[i].id;
    }
    return null;
  }, [thread.messages, thread.isLoading]);
  const showLiveThought =
    thread.isLoading &&
    !thoughtEntry &&
    message?.id === lastAiId &&
    thread.thinkingSteps.length > 0;

  // For turns NOT run in this session (opened from chat history), the sealed
  // live trace (thoughtEntry) doesn't exist. Rebuild the trace from the turn's
  // persisted messages so history shows the same tool tracing the boxes do.
  // Only host it on the turn's answer message, and only when there's no live or
  // sealed trace already covering it.
  const historicalSteps = useMemo(() => {
    if (
      isToolResult ||
      thoughtEntry ||
      showLiveThought ||
      !message?.id ||
      !isTurnAnswer(thread.messages, message.id)
    ) {
      return null;
    }
    const steps = deriveActivityStepsForAnswer(thread.messages, message.id);
    return steps.length ? steps : null;
  }, [isToolResult, thoughtEntry, showLiveThought, message?.id, thread.messages]);

  // Citation-linked markdown source. Memoized so the regex linkify only re-runs
  // when this message's content or its documents change — not every render of an
  // unrelated streaming turn. During streaming `documents` is empty, so this is
  // just the raw content; once documents arrive the `[n]` markers become links.
  const linkedContent = useMemo(
    () => linkifyCitations(contentString, documents),
    [contentString, documents],
  );

  // Deferring the markdown source keeps the browser responsive while an answer
  // streams: re-parsing the whole (growing) markdown every token is O(n) per
  // token / O(n²) over the turn and runs synchronously, which otherwise
  // saturates the main thread and freezes all input (e.g. the disclosure arrow).
  // useDeferredValue renders the expensive markdown at low priority, so urgent
  // updates — clicks, scrolling — can interrupt it. Settled messages are
  // unaffected (their content never changes, so deferred === current).
  const deferredContent = useDeferredValue(linkedContent);


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
    !thoughtEntry &&
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
            {thoughtEntry ? (
              <ThoughtDisclosure
                steps={thoughtEntry.steps}
                durationSec={Math.max(
                  1,
                  Math.round(
                    (thoughtEntry.turnEndedAt - thoughtEntry.turnStartedAt) /
                      1000,
                  ),
                )}
              />
            ) : showLiveThought ? (
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

            {documents && documents.length > 0 && (
              <DocumentsAnalyzed documents={documents} />
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
  durationSec,
  live = false,
}: {
  steps: ThinkingStep[];
  durationSec?: number;
  live?: boolean;
}) {
  // Sealed/historical disclosures own their expand state locally. The LIVE one
  // reads/writes shared context state so it survives the host AI message changing
  // mid-turn (each change would otherwise remount a fresh, collapsed disclosure).
  const thread = useStreamContext();
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = live ? thread.liveThoughtExpanded : localExpanded;
  const setExpanded = live ? thread.setLiveThoughtExpanded : setLocalExpanded;

  if (!steps.length) return null;

  // While live, prefer the currently-open step's label; if all steps have
  // closed (e.g. search finished and the answer is now streaming), fall back to
  // the generic working label.
  const openStep = steps.find((s) => s.endedAt === undefined);
  const headerLabel = live
    ? (openStep?.label ?? ACTIVITY_LABELS.working)
    : durationSec != null
      ? `${ACTIVITY_LABELS.thoughtPrefix} ${durationSec}${ACTIVITY_LABELS.thoughtSuffix}`
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
            return (
              <div
                key={`${step.key}-${step.startedAt}`}
                className="flex items-center gap-2"
              >
                {isDone ? (
                  <Check className="text-primary h-3.5 w-3.5 shrink-0" />
                ) : (
                  <div className="bg-primary/60 h-2 w-2 shrink-0 animate-pulse rounded-full" />
                )}
                <span className={cn(!isDone && "italic")}>{step.label}</span>
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

