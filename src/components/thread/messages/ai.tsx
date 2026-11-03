import { useStreamContext, ThinkingStep } from "@/providers/Stream";
import { useClientConfig } from "@/providers/ClientConfig";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import {
  getContentString,
  stripFollowUpSection,
  linkifyCitations,
  hasInlineCitation,
  citedIndices,
} from "../utils";
import { DocumentsAnalyzed } from "./documents-analyzed";
import { BranchSwitcher, CommandBar } from "./shared";
import { MarkdownText } from "../markdown-text";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import { Fragment } from "react/jsx-runtime";
import { isAgentInboxInterruptSchema } from "@/lib/agent-inbox-interrupt";
import { ThreadView } from "../agent-inbox";
import { GenericInterruptView } from "./generic-interrupt";
import { useArtifact } from "../artifact";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { MessageFeedback } from "@/components/thread/feedback";
import { DebugSection } from "./debug-section";
import { ACTIVITY_LABELS } from "@/lib/activity-labels";
import { TurnChain, TURN_GUTTER } from "../turn-chain";
import { AgentMark } from "../speaker";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/app-config";

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
  // Tool inputs and outputs are an internal/debug surface, shown inside the
  // chain's steps. Controlled solely by the HIDE_TOOL_CALLS env var.
  const { hideToolCalls } = useClientConfig();

  const thread = useStreamContext();
  const isLastMessage =
    thread.messages[thread.messages.length - 1]?.id === message?.id;
  // Hoisted to the provider (computed once per messages change) — reading the
  // precomputed flag avoids an O(n) scan here on every streamed token.
  const hasNoAIOrToolMessages = thread.hasNoAIOrToolMessages;
  const meta = message ? thread.getMessagesMetadata(message) : undefined;
  const threadInterrupt = thread.interrupt;

  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;

  const hasToolCalls =
    !!message &&
    "tool_calls" in message &&
    !!message.tool_calls &&
    message.tool_calls.length > 0;
  // During streaming an Anthropic tool call can live only in `tool_use`
  // content blocks while `tool_calls` is still empty.
  const hasAnthropicToolCalls =
    Array.isArray(content) &&
    content.some(
      (c) =>
        !!c &&
        typeof c === "object" &&
        (c as { type?: string }).type === "tool_use",
    );
  const isToolResult = message?.type === "tool";
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
  // The host of the live chain is not animated in as a message: its chain's
  // steps rise in themselves, and the host changes as each tool call lands.
  // Decided once at mount so the class never toggles mid-life (which would
  // replay the animation when the turn settles).
  const [animateIn] = useState(() => !showLiveThought);

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

  // The numbers this answer actually cites, in reading order: the credit strap
  // leads with these rather than the whole running list.
  const cited = useMemo(
    () =>
      showReferencedSources
        ? citedIndices(contentString, citationDocuments)
        : [],
    [showReferencedSources, contentString, citationDocuments],
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

  const customComponents = thread.values.ui?.filter(
    (ui) => ui.metadata?.message_id === message?.id,
  );
  const interruptVisible =
    !!threadInterrupt && (isLastMessage || hasNoAIOrToolMessages);

  // Tool calls and their results are steps in the turn's chain (hosted on the
  // turn's last AI message), so they never render as messages of their own.
  // Keep one only if something else would render here.
  if (isToolResult && !interruptVisible) {
    return null;
  }
  if (
    !isToolResult &&
    contentString.length === 0 &&
    (hasToolCalls || hasAnthropicToolCalls) &&
    !debug &&
    !interruptVisible &&
    !customComponents?.length &&
    !showLiveThought &&
    !historicalSteps
  ) {
    return null;
  }

  const hasAnswer = contentString.length > 0;

  return (
    <div
      className={cn(
        "group relative flex w-full min-w-0 flex-col gap-3",
        TURN_GUTTER,
        animateIn && "message-animate",
      )}
    >
      {isToolResult ? (
        <Interrupt
          interrupt={threadInterrupt}
          isLastMessage={isLastMessage}
          hasNoAIOrToolMessages={hasNoAIOrToolMessages}
        />
      ) : (
        <>
          {showLiveThought ? (
            <ThoughtChain
              steps={thread.thinkingSteps}
              live
              answerStarted={hasAnswer}
              showDetail={!hideToolCalls}
            />
          ) : historicalSteps ? (
            <ThoughtChain
              steps={historicalSteps}
              answerStarted={hasAnswer}
              showDetail={!hideToolCalls}
            />
          ) : null}

          {hasAnswer && (
            // The U closes the chain where the answer begins, and pulses
            // while the agent is still writing it.
            <div
              className={cn("relative min-w-0", showLiveThought && "step-in")}
            >
              <span className="sr-only">{APP_NAME}:</span>
              <AgentMark
                responding={showLiveThought}
                className="absolute top-px -left-10"
              />
              {/* Render markdown live as tokens stream in, instead of showing
                  plain text and only formatting once the stream completes. */}
              <MarkdownText>{deferredContent}</MarkdownText>
            </div>
          )}

          {/* Cumulative "Referenced Sources" (append-only, collapsed by
              default), shown only when THIS answer actually cites into the list
              — its text carries at least one inline [n] marker resolving to a
              referenced document (see showReferencedSources). An answer with no
              inline citation (a follow-up reformat that ran no search, or a
              plain reply) no longer drags the running list forward. */}
          {/* The credit closes a finished answer: held back while this turn
              is still streaming, so it never rides down under new tokens. */}
          {showReferencedSources &&
            citationDocuments &&
            !(isLoading && isLastMessage) && (
              <DocumentsAnalyzed
                documents={citationDocuments}
                cited={cited}
              />
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

          {/* Toolbar row: thumbs up, thumbs down, copy, refresh. Only under an
              answer, or under a finished turn that ended without one (so it
              can still be regenerated). */}
          {/* Held back while this turn streams, like the credit strap, so
              it never rides down under new tokens. */}
          {!(isLoading && isLastMessage) &&
            (hasAnswer || !!historicalSteps) && (
              <div className="-ml-1.5 flex items-center gap-1">
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
            )}
        </>
      )}
    </div>
  );
}

// The turn's chain of thought, hosted on its last AI message. Live, its open
// state is shared through the stream context (null = automatic) so it survives
// the host changing as each tool call lands; settled, each answer owns its own.
function ThoughtChain({
  steps,
  live = false,
  answerStarted,
  showDetail,
}: {
  steps: ThinkingStep[];
  live?: boolean;
  answerStarted: boolean;
  showDetail: boolean;
}) {
  const thread = useStreamContext();
  const [localExpanded, setLocalExpanded] = useState(false);
  const liveOpen = thread.liveThoughtExpanded ?? !answerStarted;

  // While live, mirror what the user sees, so when the turn settles (the same
  // instance flips to `live={false}`) the chain stays exactly as it was left
  // and nothing below it moves.
  useEffect(() => {
    if (live) setLocalExpanded(liveOpen);
  }, [live, liveOpen]);

  return (
    <TurnChain
      steps={steps}
      live={live}
      answerStarted={answerStarted}
      expanded={live ? thread.liveThoughtExpanded : localExpanded}
      onToggle={() =>
        live
          ? thread.setLiveThoughtExpanded(!liveOpen)
          : setLocalExpanded((v) => !v)
      }
      showDetail={showDetail}
    />
  );
}

// Shown from submit until the turn's first AI message arrives: the same live
// chain, in the same place, so the hand-off doesn't move anything.
const STARTING_STEP: ThinkingStep = {
  // Same key as the turn's first derived "Thinking" step, so it doesn't rise
  // in a second time when the real steps replace this one.
  key: "think:0",
  label: ACTIVITY_LABELS.gettingStarted,
  startedAt: 0,
};

export function AssistantMessageLoading() {
  const thread = useStreamContext();
  const { hideToolCalls } = useClientConfig();
  const steps = thread.thinkingSteps.length
    ? thread.thinkingSteps
    : [STARTING_STEP];

  return (
    <div className={cn("message-animate", TURN_GUTTER)}>
      <TurnChain
        steps={steps}
        live
        answerStarted={false}
        expanded={thread.liveThoughtExpanded}
        showDetail={!hideToolCalls}
      />
    </div>
  );
}
