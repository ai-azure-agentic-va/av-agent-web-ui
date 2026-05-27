import { v4 as uuidv4 } from "uuid";
import { ReactNode, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStreamContext } from "@/providers/Stream";
import { FormEvent } from "react";
import { Button } from "../ui/button";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import { AssistantMessage, AssistantMessageLoading, ThinkingIndicator } from "./messages/ai";
import { HumanMessage } from "./messages/human";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import { ETSLogo } from "../icons/ets-logo";
import {
  ArrowDown,
  Bug,
  LoaderCircle,
  PanelLeftClose,
  PanelLeft,
  SquarePen,
  XIcon,
  Send,
  LogOut,
} from "lucide-react";

const ssoEnabled = process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true";
import { useQueryState, parseAsBoolean } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { ThemeToggle } from "../ui/theme-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  useArtifactOpen,
  ArtifactContent,
  ArtifactTitle,
  useArtifactContext,
} from "./artifact";

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
      <div ref={context.contentRef} className={props.contentClassName}>
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
        "h-10 w-10 rounded-full shadow-lg border border-border",
        props.className
      )}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
    </Button>
  );
}

export function Thread() {
  const [artifactContext, setArtifactContext] = useArtifactContext();
  const [artifactOpen, closeArtifact] = useArtifactOpen();

  const [threadId, _setThreadId] = useQueryState("threadId");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false)
  );
  const [hideToolCalls, setHideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false)
  );
  const [debugOpen, setDebugOpen] = useQueryState(
    "debugPanel",
    parseAsBoolean.withDefault(false)
  );

  const [input, setInput] = useState("");
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");

  const stream = useStreamContext();
  const messages = stream.messages;
  const isLoading = stream.isLoading;

  const lastError = useRef<string | undefined>(undefined);

  const setThreadId = (id: string | null) => {
    _setThreadId(id);
    closeArtifact();
    setArtifactContext({});
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
      .catch(() => {});
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim().length === 0 || isLoading) return;
    setFirstTokenReceived(false);

    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: [{ type: "text", text: input }] as Message["content"],
    };

    const toolMessages = ensureToolCallsHaveResponses(stream.messages);

    const context =
      Object.keys(artifactContext).length > 0 ? artifactContext : undefined;

    stream.submit(
      { messages: [...toolMessages, newHumanMessage], context },
      {
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        config: { configurable: { rag_enabled: true } },
        optimisticValues: (prev) => ({
          ...prev,
          context,
          messages: [
            ...(prev.messages ?? []),
            ...toolMessages,
            newHumanMessage,
          ],
        }),
      }
    );

    setInput("");
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
      }
    );
  };

  const handleFollowUp = (question: string) => {
    if (isLoading) return;
    setFirstTokenReceived(false);
    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: [{ type: "text", text: question }] as Message["content"],
    };
    const toolMessages = ensureToolCallsHaveResponses(stream.messages);
    stream.submit(
      { messages: [...toolMessages, newHumanMessage] },
      {
        optimisticValues: (prev) => ({
          ...prev,
          messages: [
            ...(prev.messages ?? []),
            ...toolMessages,
            newHumanMessage,
          ],
        }),
      }
    );
  };

  const handleRegenerate = (
    parentCheckpoint: Checkpoint | null | undefined
  ) => {
    prevMessageLength.current = prevMessageLength.current - 1;
    setFirstTokenReceived(false);
    stream.submit(undefined, {
      checkpoint: parentCheckpoint,
      streamMode: ["values"],
      streamSubgraphs: true,
      streamResumable: true,
      config: { configurable: { rag_enabled: true } },
    });
  };

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = !messages.find(
    (m) => m.type === "ai" || m.type === "tool"
  );

  // Show follow-up chips after the last AI message when not loading
  const lastAiMessageId = !isLoading
    ? [...messages].reverse().find((m) => m.type === "ai")?.id
    : undefined;
  const showFollowUps =
    !!lastAiMessageId && stream.followUpQuestions.length > 0 && !isLoading;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="relative hidden lg:flex">
        <motion.div
          className="absolute z-20 h-full overflow-hidden border-r border-border bg-sidebar"
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
          <div className="relative h-full" style={{ width: 280 }}>
            <ThreadHistory />
          </div>
        </motion.div>
      </div>

      {/* Main Content */}
      <div
        className={cn(
          "grid w-full grid-cols-[1fr_0fr] transition-all duration-500",
          artifactOpen && "grid-cols-[3fr_2fr]"
        )}
      >
        <motion.div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-hidden",
            !chatStarted && "grid-rows-[1fr]"
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
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm">
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
                <ETSLogo width={28} height={28} />
                <span className="text-lg font-semibold tracking-tight text-foreground">
                  Enterprise Technology Services
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              {ssoEnabled && (
                <Button
                  variant="ghost"
                  className="h-9 gap-2 px-3 text-sm text-muted-foreground hover:text-destructive"
                  onClick={() => { window.location.href = "/api/auth/logout"; }}
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
                "absolute inset-0 overflow-y-auto scrollbar-thin px-4",
                !chatStarted && "flex flex-col items-center justify-center",
                chatStarted && "grid grid-rows-[1fr_auto]"
              )}
              contentClassName={cn(
                "w-full max-w-3xl mx-auto flex flex-col gap-6",
                chatStarted && "pt-8 pb-32"
              )}
              content={
                <>
                  {!chatStarted && (
                    <div className="flex flex-col items-center gap-4 text-center">
                      <ETSLogo width={48} height={48} />
                      <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                          Enterprise Technology Services
                        </h1>
                      </div>

                      {/* Starter Prompts */}
                      {starterPrompts.length > 0 && (
                        <div className="mt-2 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                          {starterPrompts.map((prompt, i) => (
                            <button
                              key={i}
                              onClick={() => handleStarterPrompt(prompt.message)}
                              disabled={isLoading}
                              className="rounded-xl border border-border bg-card px-4 py-3.5 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-accent hover:shadow-md disabled:opacity-50"
                            >
                              <p className="text-sm font-semibold text-foreground">
                                {prompt.label || prompt.message}
                              </p>
                              {prompt.label && (
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {prompt.message}
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
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
                          <AssistantMessage
                            key={message.id || `${message.type}-${index}`}
                            message={message}
                            isLoading={isLoading}
                            handleRegenerate={handleRegenerate}
                          />
                        )
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
                    <AssistantMessageLoading thinkingStep={stream.thinkingStep} />
                  )}

                  {isLoading && firstTokenReceived && (() => {
                    const lastMessage = messages[messages.length - 1];
                    const isAfterToolCall = lastMessage?.type === "tool" ||
                      (lastMessage?.type === "ai" &&
                       "tool_calls" in lastMessage &&
                       lastMessage.tool_calls &&
                       lastMessage.tool_calls.length > 0);
                    return isAfterToolCall ? <ThinkingIndicator /> : null;
                  })()}

                  {/* Follow-up question chips */}
                  {showFollowUps && (
                    <div className="flex flex-col gap-2 pb-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Want to explore further?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {stream.followUpQuestions.map((q, i) => (
                          <button
                            key={i}
                            onClick={() => handleFollowUp(q)}
                            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              }
              footer={
                chatStarted && (
                  <div className="pointer-events-none absolute bottom-6 right-6">
                    <ScrollToBottom className="pointer-events-auto animate-in fade-in-0 zoom-in-95" />
                  </div>
                )
              }
            />
          </StickToBottom>

          {/* Input Area */}
          <div className="border-t border-border bg-background px-4 py-4">
            <div className="mx-auto max-w-3xl">
              <div className="relative rounded-2xl border border-border bg-card shadow-sm">
                <form onSubmit={handleSubmit} className="flex flex-col">
                  <div className="flex items-end gap-2 p-3">
                    <textarea
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
                      placeholder="Message Enterprise Technology Services..."
                      rows={1}
                      className="field-sizing-content min-h-[44px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-0"
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

                  <div className="flex items-center justify-between border-t border-border px-4 py-2">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          id="render-tool-calls"
                          checked={hideToolCalls ?? false}
                          onCheckedChange={setHideToolCalls}
                          className="scale-90"
                        />
                        <Label
                          htmlFor="render-tool-calls"
                          className="text-xs text-muted-foreground"
                        >
                          Hide tool calls
                        </Label>
                      </div>

                      <button
                        type="button"
                        onClick={() => setDebugOpen((p) => !p)}
                        className={cn(
                          "flex items-center gap-1 text-xs transition-colors",
                          debugOpen
                            ? "text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        title="Toggle debug panel"
                      >
                        <Bug className="h-3.5 w-3.5" />
                        Debug
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>

          {/* Debug Panel */}
          {debugOpen && (
            <div className="border-t border-border bg-muted/40 px-4 py-3 text-xs">
              <div className="mx-auto max-w-3xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">Debug Panel</h3>
                  <button
                    onClick={() => setDebugOpen(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div>
                    <p className="font-medium text-foreground">Thread ID</p>
                    <p className="break-all font-mono text-muted-foreground">
                      {threadId || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Messages</p>
                    <p className="text-muted-foreground">
                      {stream.messages.length} total (
                      {stream.messages.filter((m) => m.type === "human").length}{" "}
                      human,{" "}
                      {stream.messages.filter((m) => m.type === "ai").length} AI)
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Status</p>
                    <p className="text-muted-foreground">
                      {isLoading
                        ? `Loading${stream.thinkingStep ? ` — ${stream.thinkingStep}` : ""}`
                        : "Idle"}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Follow-ups</p>
                    <p className="text-muted-foreground">
                      {stream.followUpQuestions.length} suggestions
                    </p>
                  </div>
                </div>

                {stream.lastDonePayload != null && (
                  <div>
                    <p className="mb-1 font-medium text-foreground">
                      Last Response Payload
                    </p>
                    <pre className="max-h-48 overflow-auto rounded border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(stream.lastDonePayload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>

        {/* Artifact Panel */}
        <div className="relative flex flex-col border-l border-border bg-card">
          <div className="absolute inset-0 flex min-w-[30vw] flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
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
    </div>
  );
}
