import { ConversationThread, useThreads } from "@/providers/Thread";
import { useEffect } from "react";
import { getContentString } from "../utils";
import { useQueryState, parseAsBoolean } from "nuqs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare,
  Clock,
} from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";


function ThreadList({
  threads,
  onThreadClick,
}: {
  threads: ConversationThread[];
  onThreadClick?: (threadId: string) => void;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No conversations yet</p>
          <p className="text-xs text-muted-foreground">
            Start a new chat to begin
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 scrollbar-thin">
      {threads.map((t) => {
        let itemText =
          t.title ||
          (typeof t.metadata?.title === "string" ? t.metadata.title : "") ||
          t.thread_id;
        if (
          !t.title &&
          typeof t.values === "object" &&
          t.values &&
          "messages" in t.values &&
          Array.isArray(t.values.messages) &&
          t.values.messages?.length > 0
        ) {
          const firstMessage = t.values.messages[0];
          if (firstMessage?.content !== undefined) {
            itemText = getContentString(firstMessage.content);
          }
        }
        const updatedAt = t.updated_at
          ? new Date(t.updated_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : undefined;
        const isActive = t.thread_id === threadId;

        return (
          <button
            key={t.thread_id}
            onClick={(e) => {
              e.preventDefault();
              onThreadClick?.(t.thread_id);
              if (t.thread_id === threadId) return;
              setThreadId(t.thread_id);
            }}
            className={cn(
              "group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-accent"
            )}
          >
            <MessageSquare
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            />
            <span className="line-clamp-2 flex-1 text-sm">{itemText}</span>
            {updatedAt && (
              <span className="mt-0.5 shrink-0 text-[11px] text-muted-foreground">
                {updatedAt}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div className="flex flex-1 flex-col gap-2 px-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={`skeleton-${i}`} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}



export default function ThreadHistory() {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false)
  );

  const { refreshThreads, threads, threadsLoading } = useThreads();

  useEffect(() => {
    if (typeof window === "undefined") return;
    void refreshThreads().catch(console.error);
  }, [refreshThreads]);

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden h-screen w-[280px] shrink-0 flex-col bg-sidebar lg:flex">
        {/* Header */}
        <div className="flex h-14 items-center border-b border-sidebar-border px-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              Conversation history
            </h2>
          </div>
        </div>

        {/* Thread List */}
        <div className="flex flex-1 flex-col overflow-hidden py-2">
          {threadsLoading ? (
            <ThreadHistoryLoading />
          ) : (
            <ThreadList threads={threads} />
          )}
        </div>

      </div>

      {/* Mobile Sheet */}
      <div className="lg:hidden">
        <Sheet
          open={!!chatHistoryOpen && !isLargeScreen}
          onOpenChange={(open) => {
            if (isLargeScreen) return;
            setChatHistoryOpen(open);
          }}
        >
          <SheetContent side="left" className="flex w-[280px] flex-col p-0">
            <SheetHeader className="border-b border-border px-4 py-3">
              <SheetTitle className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4" />
                Conversation history
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-1 flex-col overflow-hidden py-2">
              {threadsLoading ? (
                <ThreadHistoryLoading />
              ) : (
                <ThreadList
                  threads={threads}
                  onThreadClick={() => setChatHistoryOpen(false)}
                />
              )}
            </div>

          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
