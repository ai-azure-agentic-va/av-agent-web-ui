import { v4 as uuidv4 } from "uuid";
import {
  ReactNode,
  RefObject,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStreamContext } from "@/providers/Stream";
import { FormEvent } from "react";
import { getContentString, extractFollowUps } from "./utils";
import { Button } from "../ui/button";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import {
  AssistantMessage,
  AssistantMessageLoading,
  ThinkingIndicator,
} from "./messages/ai";
import { HumanMessage } from "./messages/human";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import { ETSLogo } from "../icons/ets-logo";
import {
  ArrowDown,
  LoaderCircle,
  PanelLeftClose,
  PanelLeft,
  Settings,
  SquarePen,
  XIcon,
  Send,
  LogOut,
} from "lucide-react";
import { SettingsPanel } from "./settings-panel";
import { useQueryState, parseAsBoolean } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Skeleton } from "../ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useArtifactOpen, ArtifactContent, ArtifactTitle } from "./artifact";

const ssoEnabled = process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true";

type StarterPrompt = { label?: string; message: string };

function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();
  return (
    <div
      ref={context.scrollRef}
      style={{ width: "100%", height: "100%" }}
      className={props.className}
    >
      <div
        ref={context.contentRef}
        className={props.contentClassName}
      >
        {props.content}
      </div>
      {props.footer}
    </div>
  );
}

function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn(
        "border-border h-10 w-10 rounded-full border shadow-lg",
        props.className,
      )}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
    </Button>
  );
}

type ChatInputProps = {
  input: string;
  setInput: (v: string) => void;
  handleSubmit: (e: FormEvent) => void;
  isLoading: boolean;
  stream: { isLoading: boolean; stop: () => void };
  hideToolCalls: boolean | null;
  setHideToolCalls: (v: boolean) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  onSettingsClick?: () => void;
};

function ChatInput({
  input,
  setInput,
  handleSubmit,
  isLoading,
  stream,
  hideToolCalls,
  setHideToolCalls,
  textareaRef,
  placeholder = "Message Enterprise Technology Services...",
  onSettingsClick,
}: ChatInputProps) {
  return (
    <div className="border-border bg-card relative rounded-2xl border shadow-sm">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col"
      >
        <div className="flex items-end gap-2 p-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.metaKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                const el = e.target as HTMLElement | undefined;
                const form = el?.closest("form");
                form?.requestSubmit();
              }
            }}
            placeholder={placeholder}
            rows={1}
            className="placeholder:text-muted-foreground/50 field-sizing-content max-h-[200px] min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm focus:ring-0 focus:outline-none"
          />
          <div className="flex items-center gap-1 pb-1">
            {stream.isLoading ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={() => stream.stop()}
              >
                <LoaderCircle className="h-4 w-4 animate-spin" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9"
                disabled={isLoading || !input.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <div className="flex items-center gap-4">
            {/* When tool calls are force-hidden via NEXT_PUBLIC_HIDE_TOOL_CALLS,
                this toggle is moot — omit it from the UI. */}
            {process.env.NEXT_PUBLIC_HIDE_TOOL_CALLS !== "true" && (
              <div className="flex items-center gap-2">
                <Switch
                  id="render-tool-calls"
                  checked={hideToolCalls ?? false}
                  onCheckedChange={setHideToolCalls}
                  className="scale-90"
                />
                <Label
                  htmlFor="render-tool-calls"
                  className="text-muted-foreground text-xs"
                >
                  Hide tool calls
                </Label>
              </div>
            )}
            {/* The settings button can be hidden entirely via
                NEXT_PUBLIC_HIDE_SETTINGS_BUTTON. */}
            {process.env.NEXT_PUBLIC_HIDE_SETTINGS_BUTTON !== "true" &&
              onSettingsClick && (
                <button
                  type="button"
                  onClick={onSettingsClick}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
                  title="Open settings"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </button>
              )}
          </div>
        </div>
      </form>
    </div>
  );
}

// One assistant turn (the AI message plus its follow-up chips). Extracted and
// memoized so the per-message follow-up parsing only re-runs when THIS message's
// content changes — not on every streamed token of the active message. Without
// this, the parent re-renders the whole list each chunk and re-parses every
// message, which is the dominant cost that makes long threads feel laggy.
const AssistantTurn = memo(function AssistantTurn({
  message,
  isLoading,
  isStreamingLast,
  handleRegenerate,
  onFollowUpClick,
}: {
  message: Message;
  isLoading: boolean;
  isStreamingLast: boolean;
  handleRegenerate: (parentCheckpoint: Checkpoint | null | undefined) => void;
  onFollowUpClick: (question: string) => void;
}) {
  // Per-message follow-up chips, parsed from this answer's own content (works
  // live and on reload). Suppressed while this message is the streaming tail.
  const followUps = useMemo(
    () =>
      isStreamingLast
        ? []
        : extractFollowUps(getContentString(message.content)),
    [isStreamingLast, message.content],
  );

  return (
    <>
      <AssistantMessage
        message={message}
        isLoading={isLoading}
        handleRegenerate={handleRegenerate}
      />
      {followUps.length > 0 && (
        <div className="flex flex-col gap-2 pb-2">
          <p className="text-muted-foreground text-xs font-medium">
            Want to explore further?
          </p>
          <div className="flex flex-wrap gap-2">
            {followUps.map((q, i) => (
              <button
                key={i}
                onClick={() => onFollowUpClick(q)}
                className="border-border bg-card text-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary rounded-full border px-3 py-1.5 text-xs transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
});

export function Thread() {
  // Only the setter is used now (to reset on thread switch). The artifact
  const [artifactOpen, closeArtifact] = useArtifactOpen();

  const [threadId, _setThreadId] = useQueryState("threadId");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );
  const [hideToolCalls, setHideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );
  const [debugOpen, setDebugOpen] = useQueryState(
    "debugPanel",
    parseAsBoolean.withDefault(false),
  );

  const [input, setInput] = useState("");
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const [starterPromptsLoading, setStarterPromptsLoading] = useState(true);
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");

  const stream = useStreamContext();
  const messages = stream.messages;
  const isLoading = stream.isLoading;

  const lastError = useRef<string | undefined>(undefined);

  const setThreadId = (id: string | null) => {
    _setThreadId(id);
    closeArtifact();
  };

  // Fetch starter prompts once on mount
  useEffect(() => {
    fetch("/api/starter-prompts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.prompts)) {
          setStarterPrompts(data.prompts);
        }
      })
      .catch(() => {})
      .finally(() => setStarterPromptsLoading(false));
  }, []);

  useEffect(() => {
    if (!stream.error) {
      lastError.current = undefined;
      return;
    }
    try {
      const message = (stream.error as any).message;
      if (!message || lastError.current === message) {
        return;
      }
      lastError.current = message;
      toast.error("An error occurred. Please try again.", {
        description: (
          <p>
            <strong>Error:</strong> <code>{message}</code>
          </p>
        ),
        richColors: true,
        closeButton: true,
      });
    } catch {
      // no-op
    }
  }, [stream.error]);

  const prevMessageLength = useRef(0);
  useEffect(() => {
    if (
      messages.length !== prevMessageLength.current &&
      messages?.length &&
      messages[messages.length - 1].type === "ai"
    ) {
      setFirstTokenReceived(true);
    }
    prevMessageLength.current = messages.length;
  }, [messages]);

  const handleSubmit = (e: FormEvent | null, overrideText?: string) => {
    e?.preventDefault();
    const text = (overrideText ?? input).trim();
    if (text.length === 0 || isLoading) return;
    setFirstTokenReceived(false);

    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: [{ type: "text", text }] as Message["content"],
    };

    const toolMessages = ensureToolCallsHaveResponses(stream.messages);

    stream.submit(
      { messages: [...toolMessages, newHumanMessage] },
      {
        // streamMode is intentionally omitted: the SDK already tracks the modes
        // it needs (`messages-tuple` + `values`) from the getters this app reads.
        // Passing ["values"] explicitly only forces full-thread-state snapshots
        // on every super-step, which we don't want for per-token streaming.

        optimisticValues: (prev) => ({
          ...prev,
          messages: [
            ...(prev.messages ?? []),
            ...toolMessages,
            newHumanMessage,
          ],
        }),
      },
    );

    // Only clear the composer for a typed message; a follow-up chip click
    // (overrideText) leaves any half-typed input untouched.
    if (overrideText === undefined) setInput("");
  };

  const handleStarterPrompt = (message: string) => {
    if (isLoading) return;
    setFirstTokenReceived(false);
    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: [{ type: "text", text: message }] as Message["content"],
    };
    stream.submit(
      { messages: [newHumanMessage] },
      {
        optimisticValues: (prev) => ({
          ...prev,
          messages: [...(prev.messages ?? []), newHumanMessage],
        }),
      },
    );
  };

  // Clicking a follow-up suggestion sends it immediately as a new turn,
  // through the same submit path as the composer (tool-call reconciliation
  // preserved).
  const handleFollowUpClick = (question: string) => {
    handleSubmit(null, question);
  };

  const handleRegenerate = (
    parentCheckpoint: Checkpoint | null | undefined,
  ) => {
    prevMessageLength.current = prevMessageLength.current - 1;
    setFirstTokenReceived(false);
    stream.submit(undefined, {
      checkpoint: parentCheckpoint,
    });
  };

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = !messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );

  return (
    <div className="bg-background flex h-screen w-full overflow-hidden">
      {/* Sidebar */}
      <div className="relative hidden lg:flex">
        <motion.div
          className="border-border bg-sidebar absolute z-20 h-full overflow-hidden border-r"
          style={{ width: 280 }}
          animate={
            isLargeScreen
              ? { x: chatHistoryOpen ? 0 : -280 }
              : { x: chatHistoryOpen ? 0 : -280 }
          }
          initial={{ x: -280 }}
          transition={
            isLargeScreen
              ? { type: "spring", stiffness: 300, damping: 30 }
              : { duration: 0 }
          }
        >
          <div
            className="relative h-full"
            style={{ width: 280 }}
          >
            <ThreadHistory />
          </div>
        </motion.div>
      </div>

      {/* Main Content */}
      <div
        className={cn(
          "grid w-full grid-cols-[1fr_0fr] transition-all duration-500",
          artifactOpen && "grid-cols-[3fr_2fr]",
        )}
      >
        <motion.div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-hidden",
            !chatStarted && "grid-rows-[1fr]",
          )}
          layout={isLargeScreen}
          animate={{
            marginLeft: chatHistoryOpen ? (isLargeScreen ? 280 : 0) : 0,
            width: chatHistoryOpen
              ? isLargeScreen
                ? "calc(100% - 280px)"
                : "100%"
              : "100%",
          }}
          transition={
            isLargeScreen
              ? { type: "spring", stiffness: 300, damping: 30 }
              : { duration: 0 }
          }
        >
          {/* Header */}
          <header className="border-border bg-background/80 sticky top-0 z-10 flex h-14 items-center justify-between border-b px-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setChatHistoryOpen((p) => !p)}
                    >
                      {chatHistoryOpen ? (
                        <PanelLeftClose className="h-4 w-4" />
                      ) : (
                        <PanelLeft className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{chatHistoryOpen ? "Close sidebar" : "Open sidebar"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setThreadId(null)}
                title="New chat"
              >
                <SquarePen className="h-4 w-4" />
              </Button>

              <button
                className="flex cursor-pointer items-center gap-2.5"
                onClick={() => setThreadId(null)}
              >
                <ETSLogo
                  width={28}
                  height={28}
                />
                <span className="text-foreground text-lg font-semibold tracking-tight">
                  ETS Virtual Assistant
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {ssoEnabled && (
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive h-9 gap-2 px-3 text-sm"
                  onClick={() => {
                    window.location.href = "/api/auth/logout";
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </Button>
              )}
            </div>
          </header>

          {/* Chat Area */}
          <StickToBottom className="relative flex-1 overflow-hidden">
            <StickyToBottomContent
              className={cn(
                "absolute inset-0 scrollbar-thin overflow-y-auto px-4",
                !chatStarted && "flex flex-col items-center justify-center",
                chatStarted && "grid grid-rows-[1fr_auto]",
              )}
              contentClassName={cn(
                "w-full max-w-3xl mx-auto flex flex-col gap-6",
                chatStarted && "pt-8 pb-32",
              )}
              content={
                <>
                  {!chatStarted && (
                    <div className="flex w-full flex-col items-center gap-6 text-center">
                      <ETSLogo
                        width={48}
                        height={48}
                      />
                      <div>
                        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
                          ETS Virtual Assistant
                        </h1>
                      </div>

                      {/* Search Box */}
                      <div className="w-full max-w-2xl text-left">
                        <ChatInput
                          input={input}
                          setInput={setInput}
                          handleSubmit={handleSubmit}
                          isLoading={isLoading}
                          stream={stream}
                          hideToolCalls={hideToolCalls}
                          setHideToolCalls={setHideToolCalls}
                          textareaRef={chatInputRef}
                          placeholder="How can I support you today?"
                          onSettingsClick={() => setSettingsOpen(true)}
                        />
                      </div>

                      {/* Starter Prompts */}
                      {starterPromptsLoading ? (
                        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <div
                              key={i}
                              className="border-border bg-card rounded-xl border px-4 py-3.5 shadow-sm"
                            >
                              <Skeleton className="h-4 w-2/3" />
                              <Skeleton className="mt-2 h-3 w-full" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        starterPrompts.length > 0 && (
                          <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                            {starterPrompts.map((prompt, i) => (
                              <button
                                key={i}
                                onClick={() =>
                                  handleStarterPrompt(prompt.message)
                                }
                                disabled={isLoading}
                                className="border-border bg-card hover:border-primary/40 hover:bg-accent rounded-xl border px-4 py-3.5 text-left shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                              >
                                <p className="text-foreground text-sm font-semibold">
                                  {prompt.label || prompt.message}
                                </p>
                                {prompt.label && (
                                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                                    {prompt.message}
                                  </p>
                                )}
                              </button>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {chatStarted &&
                    messages
                      .filter((m) => !m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX))
                      .map((message, index) =>
                        message.type === "human" ? (
                          <HumanMessage
                            key={message.id || `${message.type}-${index}`}
                            message={message}
                            isLoading={isLoading}
                          />
                        ) : (
                          <AssistantTurn
                            key={message.id || `${message.type}-${index}`}
                            message={message}
                            isLoading={isLoading}
                            isStreamingLast={
                              isLoading && index === messages.length - 1
                            }
                            handleRegenerate={handleRegenerate}
                            onFollowUpClick={handleFollowUpClick}
                          />
                        ),
                      )}

                  {hasNoAIOrToolMessages && !!stream.interrupt && (
                    <AssistantMessage
                      key="interrupt-msg"
                      message={undefined}
                      isLoading={isLoading}
                      handleRegenerate={handleRegenerate}
                    />
                  )}

                  {isLoading && !firstTokenReceived && (
                    <AssistantMessageLoading
                      thinkingStep={stream.thinkingStep}
                    />
                  )}

                  {isLoading &&
                    firstTokenReceived &&
                    (() => {
                      const lastMessage = messages[messages.length - 1];
                      const isAfterToolCall =
                        lastMessage?.type === "tool" ||
                        (lastMessage?.type === "ai" &&
                          "tool_calls" in lastMessage &&
                          lastMessage.tool_calls &&
                          lastMessage.tool_calls.length > 0);
                      return isAfterToolCall ? <ThinkingIndicator /> : null;
                    })()}
                </>
              }
              footer={
                chatStarted && (
                  <div className="pointer-events-none absolute right-6 bottom-6">
                    <ScrollToBottom className="animate-in fade-in-0 zoom-in-95 pointer-events-auto" />
                  </div>
                )
              }
            />
          </StickToBottom>

          {/* Input Area */}
          {chatStarted && (
            <div className="border-border bg-background border-t px-4 py-4">
              <div className="mx-auto max-w-3xl">
                <ChatInput
                  input={input}
                  setInput={setInput}
                  handleSubmit={handleSubmit}
                  isLoading={isLoading}
                  stream={stream}
                  hideToolCalls={hideToolCalls}
                  setHideToolCalls={setHideToolCalls}
                  textareaRef={chatInputRef}
                  placeholder="How can I support you today?"
                  onSettingsClick={() => setSettingsOpen(true)}
                />
              </div>
            </div>
          )}

          {/* Debug Panel */}
          {debugOpen && (
            <div className="border-border bg-muted/40 border-t px-4 py-3 text-xs">
              <div className="mx-auto max-w-3xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-foreground font-semibold">Debug Panel</h3>
                  <button
                    onClick={() => setDebugOpen(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div>
                    <p className="text-foreground font-medium">Thread ID</p>
                    <p className="text-muted-foreground font-mono break-all">
                      {threadId || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium">Messages</p>
                    <p className="text-muted-foreground">
                      {stream.messages.length} total (
                      {stream.messages.filter((m) => m.type === "human").length}{" "}
                      human,{" "}
                      {stream.messages.filter((m) => m.type === "ai").length}{" "}
                      AI)
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium">Status</p>
                    <p className="text-muted-foreground">
                      {isLoading
                        ? `Loading${stream.thinkingStep ? ` — ${stream.thinkingStep}` : ""}`
                        : "Idle"}
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium">Follow-ups</p>
                    <p className="text-muted-foreground">
                      {stream.followUpQuestions.length} suggestions
                    </p>
                  </div>
                </div>

                {stream.lastDonePayload != null && (
                  <div>
                    <p className="text-foreground mb-1 font-medium">
                      Last Response Payload
                    </p>
                    <pre className="border-border bg-background text-muted-foreground max-h-48 overflow-auto rounded border p-2 font-mono text-[10px]">
                      {JSON.stringify(stream.lastDonePayload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>

        {/* Artifact Panel */}
        <div className="border-border bg-card relative flex flex-col border-l">
          <div className="absolute inset-0 flex min-w-[30vw] flex-col">
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <ArtifactTitle className="truncate text-sm font-medium" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={closeArtifact}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
            <ArtifactContent className="relative flex-grow" />
          </div>
        </div>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
