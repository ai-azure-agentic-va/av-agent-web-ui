import { useQueryState } from "nuqs";
import { type Message } from "@langchain/langgraph-sdk";
import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
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
  return (value || DEFAULT_API_URL).replace(/\/$/, "");
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [apiUrlParam] = useQueryState("apiUrl");
  const apiUrl = normalizeApiUrl(
    apiUrlParam || process.env.NEXT_PUBLIC_API_URL,
  );
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const getThreads = useCallback(async (): Promise<ConversationThread[]> => {
    const response = await fetch(`${apiUrl}/threads/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 100 }),
    });

    if (!response.ok) {
      throw new Error(`Unable to load conversation history (${response.status}).`);
    }

    return response.json();
  }, [apiUrl]);

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
