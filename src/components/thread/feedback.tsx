"use client";

import { useState, useCallback, useRef } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeedbackProps {
  runId: string | null;
  apiUrl: string;
}

export function MessageFeedback({ runId, apiUrl }: FeedbackProps) {
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const submitFeedback = useCallback(
    async (score: number, feedbackComment?: string) => {
      if (!runId || isSubmitting) return;
      setIsSubmitting(true);
      try {
        const body: Record<string, unknown> = { run_id: runId, score };
        if (feedbackComment?.trim()) body.comment = feedbackComment.trim();
        await fetch(`${apiUrl}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        console.error("Feedback error:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [runId, apiUrl, isSubmitting],
  );

  const handleUp = useCallback(() => {
    if (submitted) return;
    setSubmitted("up");
    submitFeedback(1);
  }, [submitted, submitFeedback]);

  const handleDown = useCallback(() => {
    if (submitted) return;
    setSubmitted("down");
    setShowComment(true);
  }, [submitted]);

  const handleCommentSubmit = useCallback(() => {
    submitFeedback(0, comment);
    setShowComment(false);
  }, [comment, submitFeedback]);

  const handleCommentSkip = useCallback(() => {
    submitFeedback(0);
    setShowComment(false);
  }, [submitFeedback]);

  if (!runId) return null;

  // After submission — show a small icon inline in the toolbar
  if (submitted && !showComment) {
    return submitted === "up" ? (
      <ThumbsUp className="h-3.5 w-3.5 fill-green-500 text-green-500" />
    ) : (
      <ThumbsDown className="h-3.5 w-3.5 fill-red-400 text-red-400" />
    );
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-0.5">
      {!submitted && (
        <>
          <button
            onClick={handleUp}
            disabled={isSubmitting}
            title="Good response"
            className={cn(
              "rounded p-1 text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-green-600 dark:hover:text-green-400",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDown}
            disabled={isSubmitting}
            title="Bad response"
            className={cn(
              "rounded p-1 text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-red-500 dark:hover:text-red-400",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {/* Comment box drops DOWN below the toolbar */}
      {showComment && (
        <div className="absolute top-full left-0 mt-2 z-20 flex w-72 flex-col gap-2 rounded-md border bg-background p-3 shadow-lg">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong? (optional)"
            rows={2}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCommentSubmit();
              }
            }}
            className={cn(
              "w-full resize-none rounded-md border px-3 py-2 text-sm",
              "border-input bg-background text-foreground placeholder:text-muted-foreground",
              "focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring",
            )}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleCommentSubmit}
              disabled={isSubmitting}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "bg-foreground text-background hover:bg-foreground/90",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {isSubmitting ? "Sending…" : "Submit"}
            </button>
            <button
              onClick={handleCommentSkip}
              disabled={isSubmitting}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip
            </button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              ⌘+Enter
            </span>
          </div>
        </div>
      )}
    </div>
  );
}