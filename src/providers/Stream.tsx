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
import { parsePartialJson } from "@langchain/core/output_parsers";
import {
  type Message,
  type AIMessage,
  type ToolMessage,
} from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import { useThreads } from "@/providers/Thread";
import {
  STEP_DONE_LABELS,
  resolveToolActivity,
  ACTIVITY_LABELS,
} from "@/lib/activity-labels";
import { deriveDocumentsFromMessages } from "@/components/thread/utils";

// Best-effort: the standard LangGraph contract streams plain messages. These
// extra fields (sources / follow-ups / debug / thinking steps) are only
// populated when the `chat` graph chooses to emit them — either as custom
// stream events (via get_stream_writer) or by writing them into graph state.
export type StateType = {
  messages: Message[];
  ui?: any[];
  context?: Record<string, unknown>;
  follow_up_questions?: string[];
  debug?: DebugPayload;
};

// One document (its chunks collapsed) that AI Search retrieved this turn. The
// backend numbers these 1..n and streams the full retrieved set via the
// `documents` custom event; the UI renders them as "Referenced Sources" and
// links inline [n] citation markers to the matching entry.
export type AnalyzedDocument = {
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
  documentsMap: Record<string, AnalyzedDocument[]>;
  debugMap: Record<string, DebugPayload>;
  followUpQuestions: string[];
  thinkingStep: string;
  thinkingSteps: ThinkingStep[];
  thinkingStepsMap: Record<string, ThinkingStepsEntry>;
  // Expand/collapse state for the LIVE activity disclosure. 
  liveThoughtExpanded: boolean;
  setLiveThoughtExpanded: (expanded: boolean) => void;
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

// Derive activity steps from one turn's messages, for trust and transparency:
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
// Collect an AI message's tool calls from BOTH the structured `tool_calls`
// field AND Anthropic `tool_use` content blocks (deduped by id). The tool-call
// box renders from both; during streaming the call often lives only in the
// content blocks while `tool_calls` is still empty, so reading `tool_calls`
// alone would miss the live activity step even though the box shows the call.
function toolCallsOf(
  ai: AIMessage,
): Array<{ id?: string; name?: string; args?: Record<string, unknown> }> {
  const out: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }> = [];
  const seen = new Set<string>();

  for (const tc of ai.tool_calls ?? []) {
    if (tc.id) seen.add(tc.id);
    out.push({
      id: tc.id,
      name: tc.name,
      args: tc.args as Record<string, unknown>,
    });
  }

  const content = ai.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if ((c as { type?: string }).type !== "tool_use") continue;
      const block = c as { id?: string; name?: string; input?: unknown };
      if (block.id && seen.has(block.id)) continue;
      let args: Record<string, unknown> = {};
      if (block.input && typeof block.input === "object") {
        args = block.input as Record<string, unknown>;
      } else if (typeof block.input === "string") {
        try {
          args = (parsePartialJson(block.input) as Record<string, unknown>) ?? {};
        } catch {
          // Partial JSON mid-stream — args fill in on a later render.
        }
      }
      if (block.id) seen.add(block.id);
      out.push({ id: block.id, name: block.name, args });
    }
  }

  return out;
}

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

    // One step per tool call (from structured tool_calls + tool_use blocks).
    for (const tc of toolCallsOf(ai)) {
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

// Combine event-driven steps (the ONLY live signal for a blocking subagent
// delegation) with message-derived steps, dropping any event step that a
// message-derived step already represents — matched by doneLabel, since both
// describe the same operation. This keeps the live "Searching ServiceNow
// tickets…" indicator while the parent graph blocks, then lets the
// message-derived row supersede it once the delegation's tool call/result land,
// so the sealed/expanded trace never shows a duplicate.
function mergeStepSources(
  eventSteps: ThinkingStep[],
  messageSteps: ThinkingStep[],
): ThinkingStep[] {
  const covered = new Set(messageSteps.map((s) => s.doneLabel ?? s.label));
  const keptEvents = eventSteps.filter(
    (s) => !covered.has(s.doneLabel ?? s.label),
  );
  return [...keptEvents, ...messageSteps];
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
  const [documentsMap, setDocumentsMap] = useState<
    Record<string, AnalyzedDocument[]>
  >({});
  const [debugMap, setDebugMap] = useState<Record<string, DebugPayload>>({});
  const [customFollowUps, setCustomFollowUps] = useState<string[]>([]);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [thinkingStepsMap, setThinkingStepsMap] = useState<Record<string, ThinkingStepsEntry>>({});
  const [liveThoughtExpanded, setLiveThoughtExpanded] = useState(false);
  const [lastDonePayload, setLastDonePayload] = useState<unknown>(null);
  const [errorOverride, setErrorOverride] = useState<Error | undefined>();
  const [stopped, setStopped] = useState(false);

  // Harvested during a run, committed to the keyed maps on finish. The backend
  // streams the FULL retrieved-document set on each `documents` event, so this
  // just holds the latest list (an idempotent replace — no accumulation).
  const pendingDocumentsRef = useRef<AnalyzedDocument[] | null>(null);
  const pendingDebugRef = useRef<DebugPayload | null>(null);
  const runIdRef = useRef<string | null>(null);
  // Mirrors thinkingSteps state; the ref gives onFinish synchronous access to
  // the accumulating array without a stale-closure problem.
  const pendingStepsRef = useRef<ThinkingStep[]>([]);

  const resetTurnState = useCallback(() => {
    setCustomFollowUps([]);
    setThinkingSteps([]);
    pendingStepsRef.current = [];
    setErrorOverride(undefined);
    pendingDocumentsRef.current = null;
    pendingDebugRef.current = null;
    runIdRef.current = null;
  }, []);

  const hasSubmittedRef = useRef(false);
  const turnStartRef = useRef<number>(0);

  const harvestCustomEvent = useCallback((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const body = data as Record<string, unknown>;

    const step =
      asString(body.event) || asString(body.step) || asString(body.type);

    // `documents` carries the FULL set of documents AI Search retrieved this
    // turn (every search's hits, cited or not), already numbered 1..n by the
    // backend. Each event is the whole accumulated list, so we just replace —
    // no merge/accumulation. Rendered later as "Referenced Sources".
    if (step === "documents") {
      if (Array.isArray(body.documents)) {
        pendingDocumentsRef.current = (body.documents as AnalyzedDocument[])
          .slice()
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      }
      return;
    }

    // --- Step timeline reducer ---

    if (step === "servicenow_delegating") {
      const labels = ACTIVITY_LABELS.subagents["servicenow-ticket-agent"];
      const key = "subagent:servicenow-ticket-agent";
      if (labels && !pendingStepsRef.current.some((s) => s.key === key)) {
        const next: ThinkingStep[] = [
          ...pendingStepsRef.current,
          { key, label: labels.running, doneLabel: labels.done, startedAt: 0 },
        ];
        pendingStepsRef.current = next;
        setThinkingSteps(next);
      }
      return;
    }
    // --- End step timeline reducer ---

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
      const documents = pendingDocumentsRef.current;
      const debug =
        pendingDebugRef.current ??
        (state?.values?.debug && typeof state.values.debug === "object"
          ? (state.values.debug as DebugPayload)
          : null);

      if (aiId && documents?.length) {
        setDocumentsMap((prev) => ({ ...prev, [aiId]: documents }));
      }
      if (aiId && debug) {
        setDebugMap((prev) => ({ ...prev, [aiId]: debug }));
      }

      setLastDonePayload({
        run_id: runIdRef.current,
        ...(documents ? { documents } : {}),
        ...(debug ? { debug } : {}),
      });

      // Seal any open thinking step and commit the finished trace to the map.
      // Combine event-driven steps (search) with message-derived activity steps
      // (tool calls + generation) from the current turn.
      const combinedSteps = mergeStepSources(
        pendingStepsRef.current,
        deriveActivitySteps(messages),
      );
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
    () => mergeStepSources(thinkingSteps, activitySteps),
    [thinkingSteps, activitySteps],
  );

  // Derived from the live step array so AssistantMessageLoading still gets a
  // subtitle string without any changes to its props.
  const thinkingStep = mergedThinkingSteps.at(-1)?.label ?? "";

  // Documents for turns opened from history: the live `documents` custom event
  // never replays, but each ai_search ToolMessage persists its retrieved set on
  // `.artifact`, so we rebuild the per-answer map from the persisted messages.
  // Live state (documentsMap, committed in onFinish) is spread last so it wins
  // for the active turn on any shared answer-message id.
  const derivedDocumentsMap = useMemo(
    () => deriveDocumentsFromMessages(stream.messages),
    [stream.messages],
  );
  const mergedDocumentsMap = useMemo(
    () => ({ ...derivedDocumentsMap, ...documentsMap }),
    [derivedDocumentsMap, documentsMap],
  );

  const streamValue = useMemo<StreamContextType>(
    () => ({
      ...stream,
      submit,
      stop,
      error,
      isLoading,
      documentsMap: mergedDocumentsMap,
      debugMap,
      followUpQuestions,
      thinkingStep,
      thinkingSteps: mergedThinkingSteps,
      thinkingStepsMap,
      liveThoughtExpanded,
      setLiveThoughtExpanded,
      lastDonePayload,
      streamingMessageId,
    }),
    [
      stream,
      submit,
      stop,
      error,
      isLoading,
      mergedDocumentsMap,
      debugMap,
      followUpQuestions,
      thinkingStep,
      mergedThinkingSteps,
      thinkingStepsMap,
      liveThoughtExpanded,
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
