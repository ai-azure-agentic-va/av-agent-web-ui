import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import {
  type Message,
  type AIMessage,
  type ToolMessage,
} from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import { useThreads } from "@/providers/Thread";
import {
  STEP_RUNNING_LABELS,
  STEP_DONE_LABELS,
  resolveToolActivity,
  ACTIVITY_LABELS,
} from "@/lib/activity-labels";

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

export type ThinkingStep = {
  key: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  // Label to switch to when the step closes. Set for subagent-derived steps
  // whose done label isn't in the event-keyed STEP_DONE_LABELS map.
  doneLabel?: string;
};

export type ThinkingStepsEntry = {
  steps: ThinkingStep[];
  turnStartedAt: number;
  turnEndedAt: number;
};

type StreamContextType = ReturnType<typeof useStream<StateType>> & {
  sourcesMap: Record<string, Source[]>;
  debugMap: Record<string, DebugPayload>;
  followUpQuestions: string[];
  thinkingStep: string;
  thinkingSteps: ThinkingStep[];
  thinkingStepsMap: Record<string, ThinkingStepsEntry>;
  lastDonePayload: unknown;
  streamingMessageId: string | null;
  stop: () => void;
};

const StreamContext = createContext<StreamContextType | undefined>(undefined);

const DEFAULT_API_URL = "/api";
const DEFAULT_ASSISTANT_ID = "chat";

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

// Flatten an AI message's content into plain text (handles the string and the
// array-of-content-blocks shapes) so we can tell when the agent is producing an
// answer versus only calling tools.
function messageText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === "string"
          ? c
          : c && typeof c === "object" && (c as { type?: string }).type === "text"
            ? ((c as { text?: string }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

// Derive activity steps from one turn's messages, so the user sees each thing
// the agent actually did — for trust and transparency:
//   • one step per tool call (ServiceNow / KB-subagent / any tool), running
//     until its matching tool result arrives (matched by tool_call_id);
//   • a "Generating response…" step while an answer message carries text.
// `live` marks the tail message as still streaming (its generation step pulses);
// pass false for settled/historical turns so every step reads as done.
//
// NOTE: this can only surface what the stream exposes. A single opaque tool call
// (e.g. a subagent doing several internal operations) shows as ONE step until it
// returns — deeper granularity requires the backend to stream those sub-steps as
// custom events, which the event reducer below would then render.
function deriveStepsFromTurn(turn: Message[], live: boolean): ThinkingStep[] {
  const resultIds = new Set(
    turn
      .filter((m) => m.type === "tool")
      .map((m) => (m as ToolMessage).tool_call_id)
      .filter(Boolean),
  );

  const steps: ThinkingStep[] = [];
  turn.forEach((m, idx) => {
    if (m.type !== "ai") return;
    const ai = m as AIMessage;
    const isLastMsg = idx === turn.length - 1;

    // One step per tool call.
    for (const tc of ai.tool_calls ?? []) {
      const activity = resolveToolActivity(tc);
      if (!activity) continue;
      const done = tc.id ? resultIds.has(tc.id) : false;
      steps.push({
        key: `tool:${tc.id ?? `${idx}:${tc.name}`}`,
        label: done ? activity.done : activity.running,
        doneLabel: activity.done,
        startedAt: idx,
        endedAt: done ? idx : undefined,
      });
    }

    // Generation step when this message carries answer text. It's "running"
    // only while live AND it's the tail message (still streaming); otherwise
    // (earlier content, or any settled/historical turn) it reads as done.
    if (messageText(ai.content).trim().length > 0) {
      const running = live && isLastMsg;
      steps.push({
        key: `gen:${ai.id ?? idx}`,
        label: running
          ? ACTIVITY_LABELS.generating.running
          : ACTIVITY_LABELS.generating.done,
        doneLabel: ACTIVITY_LABELS.generating.done,
        startedAt: idx + 0.5,
        endedAt: running ? undefined : idx,
      });
    }
  });
  return steps;
}

// Live steps for the CURRENT (last) turn — messages after the last human msg.
function deriveActivitySteps(messages: Message[]): ThinkingStep[] {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === "human") {
      start = i + 1;
      break;
    }
  }
  return deriveStepsFromTurn(messages.slice(start), true);
}

// Steps for a historical turn, keyed by its answer (AI) message id. Used to
// rebuild the "Thought process" trace when an old thread is opened — the sealed
// live trace only exists for turns run in the current session.
export function deriveActivityStepsForAnswer(
  messages: Message[],
  answerId: string,
): ThinkingStep[] {
  const endIdx = messages.findIndex((m) => m.id === answerId);
  if (endIdx < 0) return [];
  let start = 0;
  for (let i = endIdx - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === "human") {
      start = i + 1;
      break;
    }
  }
  return deriveStepsFromTurn(messages.slice(start, endIdx + 1), false);
}

// Whether the given AI message is the last AI message of its turn (the answer),
// i.e. the message that should host the trace disclosure.
export function isTurnAnswer(messages: Message[], aiId: string): boolean {
  const idx = messages.findIndex((m) => m.id === aiId);
  if (idx < 0 || messages[idx].type !== "ai") return false;
  for (let i = idx + 1; i < messages.length; i += 1) {
    const t = messages[i]?.type;
    if (t === "human") return true; // next turn started → this was the answer
    if (t === "ai") return false; // a later AI message in the same turn exists
  }
  return true; // nothing after → last AI message
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
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [thinkingStepsMap, setThinkingStepsMap] = useState<Record<string, ThinkingStepsEntry>>({});
  const [lastDonePayload, setLastDonePayload] = useState<unknown>(null);
  const [errorOverride, setErrorOverride] = useState<Error | undefined>();
  const [stopped, setStopped] = useState(false);

  // Harvested during a run, committed to the keyed maps on finish.
  const pendingSourcesRef = useRef<Source[] | null>(null);
  const pendingDebugRef = useRef<DebugPayload | null>(null);
  const runIdRef = useRef<string | null>(null);
  // Set once `sources_final` arrives, so the finish handler treats the pending
  // sources as an authoritative replacement (an empty list clears the panel)
  // rather than falling back to the accumulated / state sources.
  const sourcesFinalRef = useRef<boolean>(false);
  // Mirrors thinkingSteps state; the ref gives onFinish synchronous access to
  // the accumulating array without a stale-closure problem.
  const pendingStepsRef = useRef<ThinkingStep[]>([]);

  const resetTurnState = useCallback(() => {
    setCustomFollowUps([]);
    setThinkingSteps([]);
    pendingStepsRef.current = [];
    setErrorOverride(undefined);
    pendingSourcesRef.current = null;
    pendingDebugRef.current = null;
    runIdRef.current = null;
    sourcesFinalRef.current = false;
  }, []);

  const hasSubmittedRef = useRef(false);
  const turnStartRef = useRef<number>(0);

  const harvestCustomEvent = useCallback((data: unknown) => {
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

    // --- Step timeline reducer ---
    // Each recognised event either opens a new step or closes an existing one.
    // pendingStepsRef is the source of truth; setThinkingSteps keeps the state
    // in sync so React re-renders on every change.
    const now = Date.now();
    if (step === "search_start") {
      // Close any open step, then open a new search step.
      pendingStepsRef.current = [
        ...pendingStepsRef.current.map((s) =>
          s.endedAt === undefined
            ? { ...s, label: STEP_DONE_LABELS[s.key] ?? s.label, endedAt: now }
            : s,
        ),
        { key: "search", label: STEP_RUNNING_LABELS["search"], startedAt: now },
      ];
      setThinkingSteps([...pendingStepsRef.current]);
    } else if (step === "search_complete") {
      // Close the last open search step (don't open a new one).
      let closed = false;
      pendingStepsRef.current = pendingStepsRef.current.map((s) => {
        if (!closed && s.key === "search" && s.endedAt === undefined) {
          closed = true;
          return { ...s, label: STEP_DONE_LABELS["search"] ?? s.label, endedAt: now };
        }
        return s;
      });
      setThinkingSteps([...pendingStepsRef.current]);
    }
    // ServiceNow (and other subagent delegations) are surfaced from `task` tool
    // calls via deriveActivitySteps, not custom events — see below.
    // --- End step timeline reducer ---

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
      const is401 = raw.includes("401") || (err as any)?.status === 401;
      const isSessionExpiry = is401 && hasSubmittedRef.current;
      if (isSessionExpiry) {
        window.location.href = "/api/auth/logout";
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
      // Prefer the ID tracked from stream.messages (what AssistantMessage
      // renders) over extracting from state.values, which can lag or differ.
      const aiId = lastSeenAiIdRef.current ?? lastAiMessageId(messages);
      console.debug("[Stream onFinish]", {
        aiId,
        pendingSteps: pendingStepsRef.current.length,
        fromState: lastAiMessageId(messages),
      });

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

      // Seal any open thinking step and commit the finished trace to the map.
      // Combine event-driven steps (search) with message-derived activity steps
      // (tool calls + generation) from the current turn.
      const combinedSteps = [
        ...pendingStepsRef.current,
        ...deriveActivitySteps(messages),
      ];
      if (combinedSteps.length && aiId) {
        const now = Date.now();
        const sealedSteps = combinedSteps.map((s) =>
          s.endedAt === undefined
            ? {
                ...s,
                label: s.doneLabel ?? STEP_DONE_LABELS[s.key] ?? s.label,
                endedAt: now,
              }
            : s,
        );
        setThinkingStepsMap((prev) => ({
          ...prev,
          [aiId]: {
            steps: sealedSteps,
            turnStartedAt: turnStartRef.current,
            turnEndedAt: now,
          },
        }));
      }
      pendingStepsRef.current = [];
      setThinkingSteps([]);

      void refreshThreads().catch(console.error);
    },
  });

  // Wrap submit so each new turn starts from a clean best-effort state.
  const submit = useCallback<typeof stream.submit>(
    (values, options) => {
      hasSubmittedRef.current = true;
      turnStartRef.current = Date.now();
      setStopped(false);
      resetTurnState();
      return stream.submit(values, options);
    },
    [stream, resetTurnState],
  );

  // Wrap stop to also cancel the run on the backend. The SDK's stop() only
  // closes the client-side SSE connection; without the cancel call the backend
  // keeps processing the graph until it finishes naturally.
  // setStopped(true) runs synchronously so isLoading flips to false immediately
  // in the context without waiting for the SDK's async state update.
  const stop = useCallback(async () => {
    setStopped(true);
    stream.stop();
    const currentRunId = runIdRef.current;
    const currentThreadId = threadId;
    if (currentRunId && currentThreadId) {
      fetch(
        `${apiUrl}/threads/${currentThreadId}/runs/${currentRunId}/cancel?wait=false&action=interrupt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      ).catch(console.error);
    }
  }, [stream, apiUrl, threadId]);

  // Follow-ups: prefer what the graph streamed this turn, else read from state.
  const followUpQuestions = useMemo<string[]>(() => {
    if (customFollowUps.length) return customFollowUps;
    const fromState = stream.values?.follow_up_questions;
    return Array.isArray(fromState)
      ? fromState.filter((q): q is string => typeof q === "string")
      : [];
  }, [customFollowUps, stream.values]);

  // Tracks the last AI message ID visible in stream.messages — the same source
  // AssistantMessage reads from. Updated on every render so onFinish can use it
  // as a reliable map key even when state.values.messages lags or differs.
  const lastSeenAiIdRef = useRef<string | null>(null);
  for (let i = stream.messages.length - 1; i >= 0; i--) {
    const m = stream.messages[i];
    if (m?.type === "ai" && m.id) {
      lastSeenAiIdRef.current = m.id;
      break;
    }
  }

  // When the SDK's isLoading naturally clears (run finished or errored), reset
  // stopped so it doesn't interfere with future turns.
  useEffect(() => {
    if (!stream.isLoading) setStopped(false);
  }, [stream.isLoading]);

  // Override isLoading so stop() takes effect immediately in the UI without
  // waiting for the SDK's async state to catch up.
  const isLoading = stream.isLoading && !stopped;

  // The actively-streaming message is the LAST message in the thread (not just
  // the last AI message). Once a new turn starts, the optimistic human message
  // is appended after the previous AI message, so `lastAiMessageId` would point
  // back at the already-completed AI message and incorrectly flag it as
  // streaming — making it briefly drop markdown rendering until the new AI
  // message arrives. Requiring the AI message to be last avoids that flicker.
  const streamingMessageId = useMemo<string | null>(() => {
    if (!isLoading) return null;
    const last = stream.messages[stream.messages.length - 1];
    return last?.type === "ai" && last.id ? last.id : null;
  }, [isLoading, stream.messages]);

  const error = errorOverride ?? (stream.error as Error | undefined);

  // Live view of the trace: event-driven steps (search) plus message-derived
  // activity steps (each tool call + the generation phase) for the current turn.
  // While loading this drives the activity checklist; after finish index.tsx
  // hides it and the sealed copy in thinkingStepsMap powers "Thought for Ns".
  const activitySteps = useMemo(
    () => deriveActivitySteps(stream.messages),
    [stream.messages],
  );
  const mergedThinkingSteps = useMemo(
    () => [...thinkingSteps, ...activitySteps],
    [thinkingSteps, activitySteps],
  );

  // Derived from the live step array so AssistantMessageLoading still gets a
  // subtitle string without any changes to its props.
  const thinkingStep = mergedThinkingSteps.at(-1)?.label ?? "";

  const streamValue = useMemo<StreamContextType>(
    () => ({
      ...stream,
      submit,
      stop,
      error,
      isLoading,
      sourcesMap,
      debugMap,
      followUpQuestions,
      thinkingStep,
      thinkingSteps: mergedThinkingSteps,
      thinkingStepsMap,
      lastDonePayload,
      streamingMessageId,
    }),
    [
      stream,
      submit,
      stop,
      error,
      isLoading,
      sourcesMap,
      debugMap,
      followUpQuestions,
      thinkingStep,
      mergedThinkingSteps,
      thinkingStepsMap,
      lastDonePayload,
      streamingMessageId,
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
