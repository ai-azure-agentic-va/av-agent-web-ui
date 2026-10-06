import { useQueryState } from "nuqs";
import { Client, type Message } from "@langchain/langgraph-sdk";
import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useMemo,
  useState,
  Dispatch,
  SetStateAction,
} from "react";

export type ConversationThread = {
  thread_id: string;
  session_id?: string;
  internal_thread_id?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  title?: string;
  run_count?: number;
  latest_request_id?: string;
  metadata?: Record<string, unknown>;
  values?: {
    messages?: Array<{
      id?: string;
      type?: string;
      content?: Message["content"];
    }>;
  } | null;
};

interface ThreadContextType {
  getThreads: () => Promise<ConversationThread[]>;
  refreshThreads: () => Promise<void>;
  threads: ConversationThread[];
  setThreads: Dispatch<SetStateAction<ConversationThread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);

const DEFAULT_API_URL = "/api";

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

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [apiUrlParam] = useQueryState("apiUrl");
  const apiUrl = normalizeApiUrl(
    apiUrlParam || process.env.NEXT_PUBLIC_API_URL,
  );
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  // Hit the standard LangGraph contract (POST /threads/search) through the SDK
  // client, which routes via the Next.js /api proxy to the backend.
  const client = useMemo(() => new Client({ apiUrl }), [apiUrl]);

  const getThreads = useCallback(async (): Promise<ConversationThread[]> => {
    try {
      const threads = await client.threads.search({
        limit: 100,
        sortBy: "updated_at",
        sortOrder: "desc",
      });
      return threads as ConversationThread[];
    } catch {
      // Backend not reachable / endpoint unavailable — non-fatal, render empty.
      return [];
    }
  }, [client]);

  const refreshThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      setThreads(await getThreads());
    } finally {
      setThreadsLoading(false);
    }
  }, [getThreads]);

  const value = {
    getThreads,
    refreshThreads,
    threads,
    setThreads,
    threadsLoading,
    setThreadsLoading,
  };

  return (
    <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadProvider");
  }
  return context;
}
