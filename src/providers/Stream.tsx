import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Message } from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import { v4 as uuidv4 } from "uuid";
import { getContentString } from "@/components/thread/utils";
import { useThreads } from "@/providers/Thread";
import { settingsRequestFields } from "@/lib/settings";

export type StateType = { messages: Message[]; ui?: any[] };

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

// Mirrors the backend `done.debug` block (api/main.py `_build_debug_payload`):
// search/chunks/prompt/settings. Rendered as collapsible rows under sources.
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

type StreamSubmitInput = {
  messages?: Message[] | Message;
  context?: Record<string, unknown>;
  [key: string]: unknown;
};

type StreamSubmitOptions = {
  optimisticValues?: (prev: StateType) => StateType;
  [key: string]: unknown;
};

type ParentAgentStreamContext = {
  messages: Message[];
  values: StateType;
  isLoading: boolean;
  error: Error | undefined;
  interrupt: undefined;
  submit: (
    input?: StreamSubmitInput,
    options?: StreamSubmitOptions,
  ) => Promise<void>;
  stop: () => void;
  setBranch: (_branch: string) => void;
  getMessagesMetadata: (_message: Message) => {
    firstSeenState: {
      values: StateType;
      parent_checkpoint: null;
    };
    branch: undefined;
    branchOptions: undefined;
  };
  sourcesMap: Record<string, Source[]>;
  debugMap: Record<string, DebugPayload>;
  followUpQuestions: string[];
  thinkingStep: string;
  lastDonePayload: unknown;
};

type StreamContextType = ParentAgentStreamContext & Record<string, any>;

const StreamContext = createContext<StreamContextType | undefined>(undefined);

const DEFAULT_API_URL = "/api";

const THINKING_STEP_LABELS: Record<string, string> = {
  rewriting_query: "Rewriting query...",
  query_rewritten: "Analyzing query",
  search_start: "Searching knowledge base...",
  search_complete: "Found relevant sources",
  refining_search: "Refining search results...",
  retry_search_complete: "Additional sources found",
  generating: "Generating response...",
};

function normalizeApiUrl(value: string | undefined): string {
  return (value || DEFAULT_API_URL).replace(/\/$/, "");
}

function normalizeMessages(messages?: Message[] | Message): Message[] {
  if (!messages) return [];
  return Array.isArray(messages) ? messages : [messages];
}

function lastHumanMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === "human") return messages[i];
  }
  return undefined;
}

function withoutLastAssistantMessage(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === "ai") {
      return [...messages.slice(0, i), ...messages.slice(i + 1)];
    }
  }
  return messages;
}

function parseSseEvent(rawEvent: string): { event: string; data: unknown } {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of rawEvent.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const dataText = dataLines.join("\n").trim();
  if (!dataText) return { event, data: {} };

  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: dataText };
  }
}

function answerFromDonePayload(payload: unknown): {
  requestId?: string;
  answer: string;
  sources?: Source[];
  followUpQuestions?: string[];
  debug?: DebugPayload;
} {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    return {
      requestId:
        typeof body.request_id === "string" ? body.request_id : undefined,
      answer: typeof body.answer === "string" ? body.answer : "",
      sources: Array.isArray(body.sources)
        ? (body.sources as Source[])
        : undefined,
      followUpQuestions: Array.isArray(body.follow_up_questions)
        ? body.follow_up_questions.filter(
            (q): q is string => typeof q === "string",
          )
        : undefined,
      debug:
        body.debug && typeof body.debug === "object"
          ? (body.debug as DebugPayload)
          : undefined,
    };
  }
  return { answer: "" };
}

async function readParentAgentStream(
  response: Response,
  callbacks?: {
    onToken?: (token: string) => void;
    onThinkingStep?: (step: string) => void;
  },
): Promise<{
  requestId?: string;
  answer: string;
  sources?: Source[];
  followUpQuestions?: string[];
  debug?: DebugPayload;
  rawPayload?: unknown;
}> {
  if (!response.body) {
    const body = await response.json();
    return { ...answerFromDonePayload(body), rawPayload: body };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: unknown;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const parsed = parseSseEvent(rawEvent.trim());

      if (parsed.event === "token" || parsed.event === "text") {
        const data = parsed.data as Record<string, unknown>;
        const token =
          typeof parsed.data === "string"
            ? parsed.data
            : typeof data?.token === "string"
              ? data.token
              : null;
        if (token) callbacks?.onToken?.(token);
      }

      if (parsed.event === "thinking" || parsed.event === "event") {
        const data = parsed.data as Record<string, unknown>;
        const step =
          (typeof data?.event === "string" ? data.event : "") ||
          (typeof data?.step === "string" ? data.step : "");
        if (step) {
          callbacks?.onThinkingStep?.(THINKING_STEP_LABELS[step] || step);
        }
      }

      if (parsed.event === "done") {
        donePayload = parsed.data;
      }

      if (parsed.event === "error") {
        const errorBody =
          parsed.data && typeof parsed.data === "object"
            ? (parsed.data as Record<string, unknown>)
            : {};
        throw new Error(
          typeof errorBody.detail === "string"
            ? errorBody.detail
            : "The backend returned an error.",
        );
      }
    }
  }

  if (!donePayload && buffer.trim()) {
    const parsed = parseSseEvent(buffer.trim());
    if (parsed.event === "done") donePayload = parsed.data;
  }

  return { ...answerFromDonePayload(donePayload), rawPayload: donePayload };
}

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const apiUrl = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);
  const [threadId, setThreadId] = useQueryState("threadId");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [sourcesMap, setSourcesMap] = useState<Record<string, Source[]>>({});
  const [debugMap, setDebugMap] = useState<Record<string, DebugPayload>>({});
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [thinkingStep, setThinkingStep] = useState<string>("");
  const [lastDonePayload, setLastDonePayload] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingLocalThreadRef = useRef<string | null>(null);
  const { refreshThreads } = useThreads();

  const values = useMemo<StateType>(() => ({ messages, ui: [] }), [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setThinkingStep("");
  }, []);

  useEffect(() => {
    if (!threadId) {
      pendingLocalThreadRef.current = null;
      setMessages([]);
      setError(undefined);
      setFollowUpQuestions([]);
      setThinkingStep("");
      return;
    }

    if (pendingLocalThreadRef.current === threadId) return;

    const controller = new AbortController();
    const activeThreadId = threadId;

    async function loadThread() {
      try {
        const response = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(activeThreadId)}`,
          { signal: controller.signal },
        );
        if (response.status === 404) {
          setMessages([]);
          return;
        }
        if (!response.ok) {
          throw new Error(
            `Unable to load conversation thread (${response.status}).`,
          );
        }
        const body = await response.json();
        const loadedMessages = Array.isArray(body?.values?.messages)
          ? body.values.messages
          : [];
        setMessages(loadedMessages);
        setError(undefined);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(
            err instanceof Error
              ? err
              : new Error("Unable to load the conversation thread."),
          );
        }
      }
    }

    void loadThread();
    return () => controller.abort();
  }, [apiUrl, threadId]);

  const submit = useCallback(
    async (input?: StreamSubmitInput, options?: StreamSubmitOptions) => {
      if (isLoading) return;

      const explicitMessages = normalizeMessages(input?.messages);
      const previousHumanMessage = lastHumanMessage(messages);
      const submittedMessages =
        explicitMessages.length > 0
          ? explicitMessages
          : previousHumanMessage
            ? [previousHumanMessage]
            : [];
      const humanMessage = lastHumanMessage(submittedMessages);
      const messageText = humanMessage
        ? getContentString(humanMessage.content).trim()
        : "";

      if (!messageText) return;

      const sessionId = threadId || uuidv4();
      if (!threadId) {
        pendingLocalThreadRef.current = sessionId;
        void setThreadId(sessionId);
      }

      const previousValues: StateType = { messages, ui: [] };
      const optimisticMessages =
        options?.optimisticValues?.(previousValues).messages ??
        (explicitMessages.length > 0
          ? [...messages, ...explicitMessages]
          : withoutLastAssistantMessage(messages));

      setMessages(optimisticMessages);
      setError(undefined);
      setIsLoading(true);
      setFollowUpQuestions([]);
      setThinkingStep("Preparing...");

      const controller = new AbortController();
      abortRef.current = controller;

      const streamingMessageId = uuidv4();
      let streamingMessageAdded = false;
      let accumulatedContent = "";

      try {
        const response = await fetch(`${apiUrl}/chat/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            message: messageText,
            session_id: sessionId,
            metadata: { source: "agent-web-ui" },
            ...settingsRequestFields(),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let detail = `Backend request failed with status ${response.status}.`;
          try {
            const body = await response.json();
            if (typeof body?.detail === "string") detail = body.detail;
            if (typeof body?.error === "string") detail = body.error;
          } catch {
            // keep status-based message
          }
          throw new Error(detail);
        }

        const result = await readParentAgentStream(response, {
          onToken: (token) => {
            accumulatedContent += token;
            if (!streamingMessageAdded) {
              streamingMessageAdded = true;
              setMessages((current) => [
                ...current,
                { id: streamingMessageId, type: "ai", content: accumulatedContent },
              ]);
            } else {
              setMessages((current) => {
                const idx = current.findIndex(
                  (m) => m.id === streamingMessageId,
                );
                if (idx === -1) return current;
                const updated = [...current];
                updated[idx] = { ...updated[idx], content: accumulatedContent };
                return updated;
              });
            }
          },
          onThinkingStep: (step) => {
            setThinkingStep(step);
          },
        });

        const finalContent =
          result.answer ||
          accumulatedContent ||
          "I could not find enough information to answer that request.";

        setLastDonePayload(result.rawPayload ?? null);

        if (streamingMessageAdded) {
          setMessages((current) => {
            const idx = current.findIndex((m) => m.id === streamingMessageId);
            if (idx === -1) return current;
            const updated = [...current];
            updated[idx] = { ...updated[idx], content: finalContent };
            return updated;
          });
        } else {
          setMessages((current) => [
            ...current,
            { id: streamingMessageId, type: "ai", content: finalContent },
          ]);
        }

        if (result.sources?.length) {
          setSourcesMap((prev) => ({
            ...prev,
            [streamingMessageId]: result.sources!,
          }));
        }
        if (result.debug) {
          setDebugMap((prev) => ({
            ...prev,
            [streamingMessageId]: result.debug!,
          }));
        }
        if (result.followUpQuestions?.length) {
          setFollowUpQuestions(result.followUpQuestions);
        }

        pendingLocalThreadRef.current = null;
        void refreshThreads().catch(console.error);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const nextError =
            err instanceof Error
              ? err
              : new Error("Unable to reach the backend.");
          setError(nextError);
        }
      } finally {
        abortRef.current = null;
        setIsLoading(false);
        setThinkingStep("");
      }
    },
    [apiUrl, isLoading, messages, refreshThreads, setThreadId, threadId],
  );

  const getMessagesMetadata = useCallback(
    (_message: Message) => ({
      firstSeenState: {
        values,
        parent_checkpoint: null,
      },
      branch: undefined,
      branchOptions: undefined,
    }),
    [values],
  );

  const streamValue = useMemo<StreamContextType>(
    () => ({
      messages,
      values,
      isLoading,
      error,
      interrupt: undefined,
      submit,
      stop,
      setBranch: () => undefined,
      getMessagesMetadata,
      sourcesMap,
      debugMap,
      followUpQuestions,
      thinkingStep,
      lastDonePayload,
    }),
    [
      debugMap,
      error,
      followUpQuestions,
      getMessagesMetadata,
      isLoading,
      lastDonePayload,
      messages,
      sourcesMap,
      stop,
      submit,
      thinkingStep,
      values,
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
