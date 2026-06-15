import { parsePartialJson } from "@langchain/core/output_parsers";
import { useStreamContext } from "@/providers/Stream";
import { AIMessage, Checkpoint, Message } from "@langchain/langgraph-sdk";
import {
  getContentString,
  stripFollowUpSection,
  linkifyCitations,
} from "../utils";
import { CitedSources } from "./sources";
import { BranchSwitcher, CommandBar } from "./shared";
import { MarkdownText } from "../markdown-text";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import { cn } from "@/lib/utils";
import { ToolCalls, ToolResult } from "./tool-calls";
import { MessageContentComplex } from "@langchain/core/messages";
import { Fragment } from "react/jsx-runtime";
import { isAgentInboxInterruptSchema } from "@/lib/agent-inbox-interrupt";
import { ThreadView } from "../agent-inbox";
import { useQueryState, parseAsBoolean } from "nuqs";
import { GenericInterruptView } from "./generic-interrupt";
import { useArtifact } from "../artifact";
import { Bot } from "lucide-react";
import { MessageFeedback } from "@/components/thread/feedback";
import { DebugSection } from "./debug-section";

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
  content: MessageContentComplex[],
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
  const content = message?.content ?? [];
  // Strip the "Want to explore further?" section — it renders as chips below.
  const contentString = stripFollowUpSection(getContentString(content));
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
  const streamingMessageId = thread.streamingMessageId as string | null;
  const isStreaming =
    !!streamingMessageId && streamingMessageId === message?.id;
  const isLastMessage =
    thread.messages[thread.messages.length - 1].id === message?.id;
  const hasNoAIOrToolMessages = !thread.messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );
  const meta = message ? thread.getMessagesMetadata(message) : undefined;
  const threadInterrupt = thread.interrupt;

  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
  const anthropicStreamedToolCalls = Array.isArray(content)
    ? parseAnthropicStreamedToolCalls(content)
    : undefined;

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

  const sources = message?.id ? thread.sourcesMap?.[message.id] : undefined;
  const debug = message?.id ? thread.debugMap?.[message.id] : undefined;

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
    !(sources && sources.length > 0) &&
    !debug &&
    !interruptVisible &&
    !customComponents?.length
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
            {contentString.length > 0 && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {isStreaming ? (
                  <p className="whitespace-pre-wrap">{contentString}</p>
                ) : (
                  <MarkdownText>
                    {linkifyCitations(contentString, sources)}
                  </MarkdownText>
                )}
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

            {sources && sources.length > 0 && (
              <CitedSources sources={sources} />
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
              className={cn(
                "flex items-center gap-2 transition-opacity",
                "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
              )}
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

export function ThinkingIndicator() {
  return (
    <div className="message-animate text-muted-foreground ml-11 flex items-center gap-2">
      <div className="flex items-center gap-1">
        <div className="bg-primary/60 h-1.5 w-1.5 animate-pulse rounded-full" />
        <div className="bg-primary/60 h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:0.2s]" />
        <div className="bg-primary/60 h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:0.4s]" />
      </div>
      <span className="text-sm italic">Thinking...</span>
    </div>
  );
}
