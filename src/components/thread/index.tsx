import { v4 as uuidv4 } from "uuid";
import {
  ReactNode,
  RefObject,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStreamContext } from "@/providers/Stream";
import { useClientConfig } from "@/providers/ClientConfig";
import { FormEvent } from "react";
import {
  getContentString,
  extractFollowUps,
  normalizeFollowUpForSubmit,
} from "./utils";
import { Button } from "../ui/button";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import { AssistantMessage, AssistantMessageLoading } from "./messages/ai";
import { HumanMessage } from "./messages/human";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import { AppLogo } from "../icons/app-logo";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  PanelLeftClose,
  PanelLeft,
  SquarePen,
  XIcon,
  Paperclip,
} from "lucide-react";
import { MultimodalPreview } from "./MultimodalPreview";
import { HeaderAccount } from "./header-account";
import { useFileUpload, type FileUpload } from "@/hooks/useFileUpload";
import { SUPPORTED_FILE_TYPES } from "@/lib/multimodal-utils";
import { SessionBoundaryNudge } from "./session-nudge";
import { useQueryState, parseAsBoolean } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Skeleton } from "../ui/skeleton";
import { cardVariants } from "../ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useArtifactOpen, ArtifactContent, ArtifactTitle } from "./artifact";
import { LiveClockContext, TURN_GUTTER } from "./turn-chain";
import {
  PromptLibraryButton,
  PromptLibraryCard,
  PromptLibraryLink,
  STARTER_TILE_COUNT,
  type StarterPrompt,
} from "./prompt-library";
import {
  type UserSkill,
  buildMessageContent,
  useUserSkills,
} from "@/lib/user-skills";
import { SkillView } from "./skills/skill-view";
import { useOpenSkill } from "./skills/state";
import {
  SkillChip,
  SkillPicker,
  SkillPickerButton,
  useSkillMention,
} from "./skills/composer-skill";

const ssoEnabled = process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true";

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
      aria-label="Scroll to latest message"
      title="Scroll to latest message"
      className={cn(
        "border-foreground bg-background hover:bg-foreground hover:text-background h-10 w-10 rounded-full border shadow-[0_4px_12px_rgb(0_0_0/0.12)]",
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
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  onStop?: () => void;
  upload: FileUpload;
  prompts: StarterPrompt[];
  libraryOpen: boolean;
  onLibraryOpenChange: (open: boolean) => void;
  onPickPrompt: (message: string) => void;
  skill: UserSkill | null;
  onPickSkill: (id: string) => void;
  onRemoveSkill: () => void;
};

function ChatInput({
  input,
  setInput,
  handleSubmit,
  stream,
  textareaRef,
  placeholder = `Message ${APP_NAME}...`,
  onStop,
  upload,
  prompts,
  libraryOpen,
  onLibraryOpenChange,
  onPickPrompt,
  skill,
  onPickSkill,
  onRemoveSkill,
}: ChatInputProps) {
  const clientConfig = useClientConfig();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const libraryId = useId();
  const mention = useSkillMention({
    value: input,
    setValue: setInput,
    textareaRef,
    onPick: (s) => onPickSkill(s.id),
  });
  const hasPrompts = prompts.length > 0;
  const showFooter =
    clientConfig.enableFileUpload || hasPrompts || mention.hasSkills;
  return (
    // The library card is the composer's sibling, not its child, so focus in
    // the card doesn't light the composer's halo and the form never sees it.
    <div className="relative">
      <SkillPicker mention={mention} />
      <span
        role="status"
        className="sr-only"
      >
        {mention.status}
      </span>
      {hasPrompts && (
        <PromptLibraryCard
          id={libraryId}
          open={libraryOpen}
          onOpenChange={onLibraryOpenChange}
          prompts={prompts}
          onPick={onPickPrompt}
          anchorRef={composerRef}
        />
      )}
      <div
        ref={composerRef}
        className={cn(
          "border-foreground bg-background corner-step relative border transition-[border-color,box-shadow]",
          // The textarea drops its own outline, so the whole composer carries focus.
          "focus-within:ring-signal/20 focus-within:ring-4",
          upload.dragOver && "border-signal ring-signal/20 ring-4",
        )}
        onDragOver={upload.handleDragOver}
        onDragLeave={upload.handleDragLeave}
        onDrop={upload.handleDrop}
      >
        <form
          onSubmit={handleSubmit}
          className="flex flex-col"
        >
          {(skill || upload.contentBlocks.length > 0) && (
            <div className="flex flex-wrap items-start gap-2 px-3 pt-3">
              {skill && (
                <SkillChip
                  skill={skill}
                  onRemove={onRemoveSkill}
                />
              )}
              {upload.contentBlocks.map((block, idx) => (
                <MultimodalPreview
                  key={idx}
                  block={block}
                  size="md"
                  removable
                  onRemove={() => upload.removeBlock(idx)}
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 p-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={mention.handleChange}
              {...mention.textareaProps}
              onPaste={upload.handlePaste}
              onKeyDown={(e) => {
                // An open skill list takes the arrows, Enter, Tab and Escape.
                if (mention.handleKeyDown(e)) return;
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
              aria-label="Message"
              rows={1}
              // 16px below sm: iOS Safari zooms the page into any smaller field.
              className="placeholder:text-muted-foreground field-sizing-content max-h-[200px] min-h-[44px] flex-1 resize-none scrollbar-thin border-0 bg-transparent px-2 py-2.5 text-base leading-6 focus:ring-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex items-center gap-1 pb-0.5">
              {stream.isLoading ? (
                // The live strap already says the agent is working; this is just
                // the way to stop it.
                <button
                  type="button"
                  onClick={() => {
                    stream.stop();
                    onStop?.();
                  }}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-md",
                    "bg-primary transition-colors outline-none",
                    "hover:bg-signal focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="bg-primary-foreground size-3 rounded-[2px]"
                  />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && upload.contentBlocks.length === 0}
                  aria-label="Send message"
                  title="Send message"
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-md",
                    "bg-signal text-signal-foreground transition-colors outline-none",
                    "hover:bg-signal-ink",
                    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
                    "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
                  )}
                >
                  <ArrowUp className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
          {showFooter && (
            <div className="border-border flex min-h-11 items-center justify-between gap-2 border-t px-2 py-1.5">
              <div className="flex items-center gap-0.5">
                {/* Gated by ENABLE_FILE_UPLOAD; paste / drop are gated in the hook. */}
                {clientConfig.enableFileUpload && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={SUPPORTED_FILE_TYPES.join(",")}
                      multiple
                      hidden
                      onChange={upload.handleFileInput}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach files"
                      title="Attach images or PDFs"
                      className="text-foreground hover:bg-accent focus-visible:ring-ring flex h-8 w-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                  </>
                )}
                {hasPrompts && (
                  <PromptLibraryButton
                    open={libraryOpen}
                    onOpenChange={onLibraryOpenChange}
                    controlsId={libraryId}
                  />
                )}
                {mention.hasSkills && (
                  <SkillPickerButton onClick={mention.start} />
                )}
              </div>
            </div>
          )}
        </form>
      </div>
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
  // live and on reload). Suppressed while this message is the streaming tail,
  // and on anything but an AI answer: a tool result can contain the heading too
  // (a skill or saved conversation the agent read), and its bullets are not
  // suggestions.
  const followUps = useMemo(
    () =>
      isStreamingLast || message.type !== "ai"
        ? []
        : extractFollowUps(getContentString(message.content)),
    [isStreamingLast, message.type, message.content],
  );

  return (
    <>
      <AssistantMessage
        message={message}
        isLoading={isLoading}
        handleRegenerate={handleRegenerate}
      />
      {followUps.length > 0 && (
        <div className={cn("flex flex-col gap-3 pb-2", TURN_GUTTER)}>
          <p className="text-muted-foreground text-[13px] font-medium">
            Want to explore further?
          </p>
          <div className="flex flex-wrap gap-2">
            {followUps.map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onFollowUpClick(q)}
                className="group/fu border-foreground hover:bg-foreground hover:text-background focus-visible:ring-ring inline-flex items-center gap-2 rounded-full border px-4 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                {q}
                <ArrowRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 transition-transform group-hover/fu:translate-x-0.5"
                />
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
  const [debugOpen, setDebugOpen] = useQueryState(
    "debugPanel",
    parseAsBoolean.withDefault(false),
  );

  const [input, setInput] = useState("");
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const [starterPromptsLoading, setStarterPromptsLoading] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const [openSkill, setOpenSkill] = useOpenSkill();

  const stream = useStreamContext();
  const messages = stream.messages;
  const isLoading = stream.isLoading;

  // Latest-value refs so the submit callbacks below can stay referentially
  // STABLE (empty deps). The stream context value gets a new identity on every
  // streamed event, so closing over it directly would give these handlers a new
  // identity per token — silently defeating AssistantTurn's memo (its props
  // comparison would fail for every settled message on every token).
  const streamRef = useRef(stream);
  streamRef.current = stream;
  const inputRef = useRef(input);
  inputRef.current = input;
  const clientConfig = useClientConfig();
  const upload = useFileUpload({ enabled: clientConfig.enableFileUpload });
  const { resetBlocks } = upload;
  const contentBlocksRef = useRef(upload.contentBlocks);
  contentBlocksRef.current = upload.contentBlocks;

  // The skill waiting in the composer for the next typed message. Held by id
  // so an edit to the skill is picked up, and a deleted one simply drops off.
  const skills = useUserSkills();
  const [attachedSkillId, setAttachedSkillId] = useState<string | null>(null);
  const attachedSkill = attachedSkillId
    ? (skills.find((s) => s.id === attachedSkillId) ?? null)
    : null;
  const attachedSkillRef = useRef(attachedSkill);
  attachedSkillRef.current = attachedSkill;

  const lastError = useRef<string | undefined>(undefined);

  // When the current turn started, shared with the live chain in the thread so
  // its clocks don't restart when the first AI message arrives. `seen` is
  // fresh per turn: it remembers which steps have already risen in.
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  useEffect(() => {
    setTurnStartedAt(isLoading ? Date.now() : null);
  }, [isLoading]);
  const turnClock = useMemo(
    () => ({ startedAt: turnStartedAt, seen: new Set<string>() }),
    [turnStartedAt],
  );

  const setThreadId = (id: string | null) => {
    _setThreadId(id);
    closeArtifact();
    void setOpenSkill(null);
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

  const handleSubmit = useCallback(
    (e: FormEvent | null, overrideText?: string) => {
      e?.preventDefault();
      const stream = streamRef.current;
      const text = (overrideText ?? inputRef.current).trim();
      // Staged attachments go out with a typed message only; a follow-up chip
      // click leaves them in the composer for the user's own next message.
      const attachments =
        overrideText === undefined ? contentBlocksRef.current : [];
      if ((text.length === 0 && attachments.length === 0) || stream.isLoading)
        return;
      // So does an attached skill: it travels as its own text block after the
      // person's words, which the UI leaves out wherever it shows their text.
      const skill =
        overrideText === undefined ? attachedSkillRef.current : null;

      const newHumanMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: buildMessageContent(text, skill, attachments),
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

      setLibraryOpen(false);
      // Only clear the composer for a typed message; a follow-up chip click
      // (overrideText) leaves any half-typed input untouched.
      if (overrideText === undefined) {
        setInput("");
        resetBlocks();
        setAttachedSkillId(null);
      }
    },
    [resetBlocks],
  );

  const handleStarterPrompt = useCallback((message: string) => {
    const stream = streamRef.current;
    if (stream.isLoading) return;
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
  }, []);

  // A prompt picked from the library replaces the draft and waits in the
  // composer, caret at the end, for the person to edit it and press Enter.
  // (The welcome screen's Starter tiles send straight away instead.)
  const handlePickPrompt = useCallback((message: string) => {
    setInput(message);
    setLibraryOpen(false);
    requestAnimationFrame(() => {
      const el = chatInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  // "Use in chat" on a skill: back to the conversation the person was in,
  // with the skill on the composer, waiting for them to type.
  const handleUseSkill = useCallback(
    (id: string) => {
      setAttachedSkillId(id);
      void setOpenSkill(null);
      requestAnimationFrame(() => chatInputRef.current?.focus());
    },
    [setOpenSkill],
  );

  // Clicking a follow-up suggestion sends it immediately as a new turn,
  // through the same submit path as the composer (tool-call reconciliation
  // preserved). Normalize any second-person "Do you want to …?" phrasing into
  // the user's actual request first, so the agent doesn't misread it as a
  // meta-question about its own preferences and refuse it.
  const handleFollowUpClick = useCallback(
    (question: string) => {
      handleSubmit(null, normalizeFollowUpForSubmit(question));
    },
    [handleSubmit],
  );

  const handleRegenerate = useCallback(
    (parentCheckpoint: Checkpoint | null | undefined) => {
      const stream = streamRef.current;
      if (stream.isLoading) return;
      stream.submit(undefined, {
        checkpoint: parentCheckpoint,
      });
    },
    [],
  );

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = stream.hasNoAIOrToolMessages;

  return (
    <LiveClockContext.Provider value={turnClock}>
      <div className="bg-background flex h-dvh w-full overflow-hidden">
        {/* Sidebar */}
        <div className="relative hidden lg:flex">
          <motion.div
            className="border-border bg-sidebar absolute z-20 h-full overflow-hidden border-r"
            style={{ width: 280 }}
            // Closed, it is only translated off-screen: keep it out of the tab
            // order and the accessibility tree until it slides back in.
            inert={!chatHistoryOpen}
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
            <header className="border-border bg-background sticky top-0 z-10 flex h-15 items-center justify-between gap-3 border-b px-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
                        aria-label={
                          chatHistoryOpen ? "Close sidebar" : "Open sidebar"
                        }
                        aria-expanded={!!chatHistoryOpen}
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
                      <p>
                        {chatHistoryOpen ? "Close sidebar" : "Open sidebar"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setThreadId(null)}
                  aria-label="New conversation"
                  title="New conversation"
                >
                  <SquarePen className="h-4 w-4" />
                </Button>

                <button
                  type="button"
                  className="focus-visible:ring-ring ml-1.5 flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md outline-none focus-visible:ring-2"
                  onClick={() => setThreadId(null)}
                >
                  <AppLogo
                    width={28}
                    height={28}
                  />
                  <span className="text-foreground truncate text-[19px] font-semibold tracking-[-0.01em]">
                    {APP_NAME}
                  </span>
                </button>
              </div>

              <HeaderAccount ssoEnabled={ssoEnabled} />
            </header>

            {/* A skill opened from the sidebar takes the reading column. The
              conversation is only hidden, so it comes back where it was. */}
            {openSkill && <SkillView onUse={handleUseSkill} />}

            {/* Chat Area */}
            <StickToBottom
              className={cn(
                "relative flex-1 overflow-hidden",
                openSkill && "hidden",
              )}
            >
              <StickyToBottomContent
                className={cn(
                  "absolute inset-0 scrollbar-thin overflow-y-auto px-4",
                  // Centered with an auto margin rather than justify-center, which
                  // would clip the top of the welcome screen on short viewports.
                  !chatStarted && "flex flex-col items-center",
                  chatStarted && "grid grid-rows-[1fr_auto]",
                )}
                contentClassName={cn(
                  // min-w-0: as a grid item this column would otherwise grow to
                  // its widest table or code line and push past a phone screen.
                  "w-full min-w-0 max-w-[780px] mx-auto flex flex-col gap-6",
                  !chatStarted && "my-auto py-8 sm:py-12",
                  chatStarted && "pt-10 pb-24",
                )}
                content={
                  <>
                    {!chatStarted && (
                      <div className="flex w-full flex-col gap-8">
                        {/* The front page: the product's name as the headline and
                          its promise beneath in small type, set flush left like
                          the questions it invites. */}
                        <div className="flex flex-col items-start gap-3">
                          <AppLogo
                            width={40}
                            height={40}
                          />
                          <div className="flex flex-col gap-2">
                            <h1 className="text-foreground max-w-[24ch] text-[32px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance sm:text-[40px]">
                              {APP_NAME}
                            </h1>
                            <p className="text-muted-foreground max-w-[52ch] text-[15px] leading-6 font-normal text-pretty">
                              {APP_TAGLINE}
                            </p>
                          </div>
                        </div>

                        {/* Search Box */}
                        <div className="w-full">
                          <ChatInput
                            input={input}
                            setInput={setInput}
                            handleSubmit={handleSubmit}
                            isLoading={isLoading}
                            stream={stream}
                            textareaRef={chatInputRef}
                            placeholder="Ask about an incident, a ticket or a runbook"
                            upload={upload}
                            prompts={starterPrompts}
                            libraryOpen={libraryOpen}
                            onLibraryOpenChange={setLibraryOpen}
                            onPickPrompt={handlePickPrompt}
                            skill={attachedSkill}
                            onPickSkill={setAttachedSkillId}
                            onRemoveSkill={() => setAttachedSkillId(null)}
                          />
                        </div>

                        {/* Starter Prompts */}
                        {starterPromptsLoading ? (
                          <div
                            className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
                            role="status"
                            aria-label="Loading suggestions"
                          >
                            {Array.from({ length: 4 }).map((_, i) => (
                              <div
                                key={i}
                                className={cn(cardVariants(), "p-4")}
                              >
                                <Skeleton className="h-4 w-2/3" />
                                <Skeleton className="mt-2.5 h-3 w-full" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          starterPrompts.length > 0 && (
                            <div className="flex w-full flex-col gap-5">
                              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                                {starterPrompts
                                  .slice(0, STARTER_TILE_COUNT)
                                  .map((prompt, i) => (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() =>
                                        handleStarterPrompt(prompt.message)
                                      }
                                      disabled={isLoading}
                                      className={cn(
                                        cardVariants({ interactive: true }),
                                        "group/sp flex items-start justify-between gap-4 p-4 text-left disabled:pointer-events-none disabled:opacity-50",
                                      )}
                                    >
                                      <span className="min-w-0">
                                        <span className="text-foreground block text-[15px] font-medium">
                                          {prompt.label || prompt.message}
                                        </span>
                                        {prompt.label && (
                                          <span className="text-muted-foreground mt-1 line-clamp-2 block text-sm font-light">
                                            {prompt.message}
                                          </span>
                                        )}
                                      </span>
                                      <ArrowRight
                                        aria-hidden="true"
                                        className="mt-0.5 size-4 shrink-0 transition-transform group-hover/sp:translate-x-0.5"
                                      />
                                    </button>
                                  ))}
                              </div>
                              {starterPrompts.length > STARTER_TILE_COUNT && (
                                <PromptLibraryLink
                                  count={starterPrompts.length}
                                  open={libraryOpen}
                                  onOpenChange={setLibraryOpen}
                                />
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {chatStarted &&
                      messages
                        .filter(
                          (m) => !m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX),
                        )
                        .map((message, index, shown) =>
                          message.type === "human" ? (
                            <HumanMessage
                              key={message.id || `${message.type}-${index}`}
                              message={message}
                              isLoading={isLoading}
                              hasReply={
                                index < shown.length - 1
                                  ? shown[index + 1]?.type !== "human"
                                  : isLoading
                              }
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

                    {isLoading &&
                      (() => {
                        // Once the current turn has an AI message, the live
                        // activity disclosure renders on top of it (inside
                        // AssistantMessage), so no separate bottom indicator is
                        // needed. Only before that first AI message appears do we
                        // show the lightweight "starting" bubble here.
                        let start = 0;
                        for (let i = messages.length - 1; i >= 0; i -= 1) {
                          if (messages[i]?.type === "human") {
                            start = i + 1;
                            break;
                          }
                        }
                        const hasAiThisTurn = messages
                          .slice(start)
                          .some((m) => m.type === "ai");
                        if (hasAiThisTurn) return null;

                        return <AssistantMessageLoading />;
                      })()}
                  </>
                }
                footer={
                  chatStarted && (
                    // Sticky, not absolute: an absolute child of the scroller
                    // would scroll away with the content it is meant to jump to.
                    <div className="pointer-events-none sticky bottom-6 flex h-0 justify-end overflow-visible">
                      <ScrollToBottom className="animate-in fade-in-0 zoom-in-95 pointer-events-auto -translate-y-full" />
                    </div>
                  )
                }
              />
            </StickToBottom>

            {/* Input Area */}
            {chatStarted && (
              // A short white fade lets the thread scroll under the composer
              // instead of ending on a hard rule.
              <div
                className={cn(
                  "bg-background relative px-4 pt-2 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-white before:to-transparent",
                  openSkill && "hidden",
                )}
              >
                <div className="mx-auto max-w-[780px]">
                  <SessionBoundaryNudge
                    messages={messages}
                    threadId={threadId}
                    onStartFresh={() => setThreadId(null)}
                  />
                  <ChatInput
                    input={input}
                    setInput={setInput}
                    handleSubmit={handleSubmit}
                    isLoading={isLoading}
                    stream={stream}
                    textareaRef={chatInputRef}
                    placeholder="Ask about an incident, a ticket or a runbook"
                    upload={upload}
                    prompts={starterPrompts}
                    libraryOpen={libraryOpen}
                    onLibraryOpenChange={setLibraryOpen}
                    onPickPrompt={handlePickPrompt}
                    skill={attachedSkill}
                    onPickSkill={setAttachedSkillId}
                    onRemoveSkill={() => setAttachedSkillId(null)}
                  />
                </div>
              </div>
            )}

            {/* Debug Panel */}
            {debugOpen && (
              <div className="border-border bg-muted border-t px-4 py-3 text-xs">
                <div className="mx-auto max-w-[780px] space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-foreground font-semibold">
                      Debug Panel
                    </h3>
                    <button
                      type="button"
                      onClick={() => setDebugOpen(false)}
                      aria-label="Close debug panel"
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md p-1 outline-none focus-visible:ring-2"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <p className="text-foreground font-medium">Thread ID</p>
                      <p className="text-muted-foreground break-all">
                        {threadId || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-foreground font-medium">Messages</p>
                      <p className="text-muted-foreground">
                        {stream.messages.length} total (
                        {
                          stream.messages.filter((m) => m.type === "human")
                            .length
                        }{" "}
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
                      <pre className="border-border bg-background text-foreground max-h-48 scrollbar-thin overflow-auto rounded-[2px] border p-2.5 font-mono text-xs leading-5">
                        {JSON.stringify(stream.lastDonePayload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>

          {/* Artifact Panel. Its grid column collapses to zero when closed, so it
            also leaves the tab order and drops its edge border. */}
          <div
            className={cn(
              "border-border bg-card relative flex flex-col",
              artifactOpen && "border-l",
            )}
            inert={!artifactOpen}
          >
            <div className="absolute inset-0 flex min-w-[30vw] flex-col">
              <div className="border-border flex items-center justify-between border-b px-4 py-3">
                <ArtifactTitle className="truncate text-sm font-medium" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Close panel"
                  title="Close panel"
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
    </LiveClockContext.Provider>
  );
}
