import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type Message } from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import { useThreads } from "@/providers/Thread";

// Best-effort: the standard LangGraph contract streams plain messages. These
// extra fields (sources / follow-ups / debug / thinking steps) are only
// populated when the `chat` graph chooses to emit them — either as custom
// stream events (via get_stream_writer) or by writing them into graph state.
export type StateType = {
  messages: Message[];
  ui?: any[];
  context?: Record<string, unknown>;
  follow_up_questions?: string[];
  sources?: Source[];
  debug?: DebugPayload;
};

export type Source = {
  index?: number;
  title?: string;
  url?: string;
  source_type?: string;
  file_name?: string;
  breadcrumb?: string;
  page_number?: number;
  score?: number;
  reranker_score?: number;
  preview?: string;
  updated_at?: string;
};

export type DebugSearch = {
  original_query?: string;
  rewritten_query?: string;
  tool_query?: string | null;
  index?: string;
  endpoint?: string;
  search_endpoint?: string;
  embedding_model?: string;
  semantic_config?: string;
  top_k_requested?: number;
  top_k_used?: number;
  hybrid?: {
    mode?: string;
    use_hybrid?: boolean;
    use_semantic?: boolean;
    use_vector?: boolean;
  };
};

export type DebugChunk = {
  chunk_number?: number;
  content?: string | null;
  score?: number | null;
  title?: string | null;
  source_url?: string;
  metadata?: Record<string, unknown>;
};

export type DebugPromptMessage = {
  role?: string;
  content?: string;
};

export type DebugPrompt = {
  system?: string | null;
  user?: string;
  grounding?: string | null;
  messages?: DebugPromptMessage[];
};

export type DebugPayload = {
  search?: DebugSearch;
  chunks?: DebugChunk[];
  prompt?: DebugPrompt;
  settings?: Record<string, unknown>;
};

type StreamContextType = ReturnType<typeof useStream<StateType>> & {
  sourcesMap: Record<string, Source[]>;
  debugMap: Record<string, DebugPayload>;
  followUpQuestions: string[];
  thinkingStep: string;
  lastDonePayload: unknown;
  streamingMessageId: string | null;
  sessionExpired: boolean;
};

const StreamContext = createContext<StreamContextType | undefined>(undefined);

const DEFAULT_API_URL = "/api";
const DEFAULT_ASSISTANT_ID = "chat";

const THINKING_STEP_LABELS: Record<string, string> = {
  rewriting_query: "Rewriting query...",
  query_rewritten: "Analyzing query",
  search_start: "Searching knowledge base...",
  search_complete: "Found relevant sources",
  refining_search: "Refining search results...",
  retry_search_complete: "Additional sources found",
  generating: "Generating response...",
};

function normalizeApiUrl(value: string | undefined | null): string {
  const raw = (value || DEFAULT_API_URL).replace(/\/$/, "");
  // The LangGraph SDK builds request URLs with `new URL()`, which requires an
  // ABSOLUTE URL. A relative value like "/api" (the same-origin Next.js proxy)
  // must be resolved against the current origin at runtime: at build time we
  // don't know the deployed host, and both UI apps share one baked image.
  if (raw.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${raw}`;
  }
  return raw;
}

// Turn raw backend/LLM errors into user-friendly text. Rate-limit (HTTP 429 /
// Azure OpenAI "too_many_requests") is the common one — show an actionable
// retry hint instead of the raw JSON error.
function friendlyError(raw: string): string {
  const lower = (raw || "").toLowerCase();
  if (
    lower.includes("429") ||
    lower.includes("too_many_requests") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit")
  ) {
    return "The assistant is busy right now (rate limit reached). Please wait a few seconds and try again.";
  }
  return raw || "The backend returned an error.";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function lastAiMessageId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.type === "ai" && m.id) return m.id;
  }
  return null;
}

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const apiUrl = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);
  const assistantId =
    process.env.NEXT_PUBLIC_ASSISTANT_ID || DEFAULT_ASSISTANT_ID;
  const [threadId, setThreadId] = useQueryState("threadId");
  const { refreshThreads } = useThreads();

  // Best-effort custom UI state. Populated only when the graph emits matching
  // custom stream events / state; otherwise stays empty.
  const [sourcesMap, setSourcesMap] = useState<Record<string, Source[]>>({});
  const [debugMap, setDebugMap] = useState<Record<string, DebugPayload>>({});
  const [customFollowUps, setCustomFollowUps] = useState<string[]>([]);
  const [thinkingStep, setThinkingStep] = useState<string>("");
  const [lastDonePayload, setLastDonePayload] = useState<unknown>(null);
  const [errorOverride, setErrorOverride] = useState<Error | undefined>();
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);

  // Harvested during a run, committed to the keyed maps on finish.
  const pendingSourcesRef = useRef<Source[] | null>(null);
  const pendingDebugRef = useRef<DebugPayload | null>(null);
  const runIdRef = useRef<string | null>(null);
  // Set once `sources_final` arrives, so the finish handler treats the pending
  // sources as an authoritative replacement (an empty list clears the panel)
  // rather than falling back to the accumulated / state sources.
  const sourcesFinalRef = useRef<boolean>(false);

  const resetTurnState = useCallback(() => {
    setCustomFollowUps([]);
    setThinkingStep("");
    setErrorOverride(undefined);
    pendingSourcesRef.current = null;
    pendingDebugRef.current = null;
    runIdRef.current = null;
    sourcesFinalRef.current = false;
  }, []);

  const hasSubmittedRef = useRef(false);

  const harvestCustomEvent = useCallback((data: unknown) => {
    // A plain string is treated as a thinking-step label.
    if (typeof data === "string") {
      setThinkingStep(THINKING_STEP_LABELS[data] || data);
      return;
    }
    if (!data || typeof data !== "object") return;
    const body = data as Record<string, unknown>;

    const step =
      asString(body.event) || asString(body.step) || asString(body.type);

    // `sources_final` is the authoritative replacement emitted after the agent
    // finishes: it holds ONLY the inline-cited sources. Per the replace
    // contract, swap out the incrementally accumulated `search_complete` set
    // for this list verbatim — including an empty list, which clears the panel.
    // It is not a thinking step, so don't surface it as a status label.
    if (step === "sources_final") {
      if (Array.isArray(body.sources)) {
        pendingSourcesRef.current = (body.sources as Source[])
          .slice()
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        sourcesFinalRef.current = true;
      }
      return;
    }

    if (step) setThinkingStep(THINKING_STEP_LABELS[step] || step);

    if (Array.isArray(body.sources)) {
      // Accumulate across events by merging on the backend-guaranteed `index`,
      // so a later (e.g. retry/refine) event that carries a partial list updates
      // matching entries in place instead of clobbering earlier sources.
      const byIndex = new Map<number, Source>();
      for (const s of pendingSourcesRef.current ?? []) {
        if (typeof s.index === "number") byIndex.set(s.index, s);
      }
      for (const s of body.sources as Source[]) {
        if (typeof s.index === "number") byIndex.set(s.index, s);
      }
      pendingSourcesRef.current = [...byIndex.values()].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      );
    }
    if (body.debug && typeof body.debug === "object") {
      pendingDebugRef.current = body.debug as DebugPayload;
    }
    if (Array.isArray(body.follow_up_questions)) {
      setCustomFollowUps(
        body.follow_up_questions.filter(
          (q): q is string => typeof q === "string",
        ),
      );
    }
  }, []);

  const stream = useStream<StateType>({
    apiUrl,
    assistantId,
    threadId: threadId ?? null,
    messagesKey: "messages",
    // Required so the spread of `stream` below can read `history` without
    // throwing — newer SDK versions default this to `false`. It also enables
    // loading prior messages when an existing thread is opened.
    fetchStateHistory: true,
    onThreadId: (id) => {
      void setThreadId(id);
    },
    onCreated: (run) => {
      runIdRef.current = run.run_id;
    },
    onMetadataEvent: (data) => {
      const id = (data as { run_id?: string })?.run_id;
      if (id) runIdRef.current = id;
    },
    onCustomEvent: (data) => harvestCustomEvent(data),
    onError: (err) => {
      const raw = err instanceof Error ? err.message : String(err ?? "");
      if (
        (raw.includes("401") || (err as any)?.status === 401) &&
        hasSubmittedRef.current
      ) {
        setSessionExpired(true);
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Unable to reach the backend.";
      setErrorOverride(new Error(friendlyError(message)));
    },
    onFinish: (state) => {
      const messages = (state?.values?.messages ?? []) as Message[];
      const aiId = lastAiMessageId(messages);

      // When `sources_final` arrived it is authoritative: use the pending list
      // verbatim (an empty list means the answer cited nothing → no panel).
      // Otherwise fall back to whatever accumulated, then to graph state.
      const sources = sourcesFinalRef.current
        ? pendingSourcesRef.current
        : (pendingSourcesRef.current ??
          (Array.isArray(state?.values?.sources)
            ? (state.values.sources as Source[])
            : null));
      const debug =
        pendingDebugRef.current ??
        (state?.values?.debug && typeof state.values.debug === "object"
          ? (state.values.debug as DebugPayload)
          : null);

      if (aiId && sources?.length) {
        setSourcesMap((prev) => ({ ...prev, [aiId]: sources }));
      }
      if (aiId && debug) {
        setDebugMap((prev) => ({ ...prev, [aiId]: debug }));
      }

      setLastDonePayload({
        run_id: runIdRef.current,
        ...(sources ? { sources } : {}),
        ...(debug ? { debug } : {}),
      });
      setThinkingStep("");
      void refreshThreads().catch(console.error);
    },
  });

  // Wrap submit so each new turn starts from a clean best-effort state.
  const submit = useCallback<typeof stream.submit>(
    (values, options) => {
      hasSubmittedRef.current = true;
      resetTurnState();
      return stream.submit(values, options);
    },
    [stream, resetTurnState],
  );

  // Follow-ups: prefer what the graph streamed this turn, else read from state.
  const followUpQuestions = useMemo<string[]>(() => {
    if (customFollowUps.length) return customFollowUps;
    const fromState = stream.values?.follow_up_questions;
    return Array.isArray(fromState)
      ? fromState.filter((q): q is string => typeof q === "string")
      : [];
  }, [customFollowUps, stream.values]);

  // The last AI message is the one actively streaming while a run is in flight.
  const streamingMessageId = useMemo<string | null>(
    () => (stream.isLoading ? lastAiMessageId(stream.messages) : null),
    [stream.isLoading, stream.messages],
  );

  const error = errorOverride ?? (stream.error as Error | undefined);

  const streamValue = useMemo<StreamContextType>(
    () => ({
      ...stream,
      submit,
      error,
      sourcesMap,
      debugMap,
      followUpQuestions,
      thinkingStep,
      lastDonePayload,
      streamingMessageId,
      sessionExpired,
    }),
    [
      stream,
      submit,
      error,
      sourcesMap,
      debugMap,
      followUpQuestions,
      thinkingStep,
      lastDonePayload,
      streamingMessageId,
      sessionExpired,
    ],
  );

  return (
    <StreamContext.Provider value={streamValue}>
      {children}
    </StreamContext.Provider>
  );
};

export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }
  return context;
};

export default StreamContext;
