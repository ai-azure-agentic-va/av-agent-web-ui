"use client";

import { useState, useCallback, useRef, useSyncExternalStore } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { TooltipIconButton } from "./tooltip-icon-button";

interface FeedbackProps {
  runId: string | null;
}

// The comment box accepts both ⌘ and Ctrl + Enter; the hint names the one this
// platform uses. Resolved after hydration so the server render stays stable.
const subscribeNoop = () => () => {};
function useSubmitShortcutLabel() {
  return useSyncExternalStore(
    subscribeNoop,
    () =>
      /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ Enter" : "Ctrl Enter",
    () => null,
  );
}

export function MessageFeedback({ runId }: FeedbackProps) {
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const shortcutLabel = useSubmitShortcutLabel();

  const submitFeedback = useCallback(
    async (score: number, feedbackComment?: string) => {
      if (!runId || isSubmitting) return;
      setIsSubmitting(true);
      try {
        const body: Record<string, unknown> = { run_id: runId, score };
        if (feedbackComment?.trim()) body.comment = feedbackComment.trim();
        // Always go through the same-origin Next.js proxy (/api/*), which
        // injects the user's bearer token server-side. Never call the backend
        // directly from the browser — it has no Authorization header.
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Feedback request failed: ${res.status}`);
      } catch (err) {
        console.error("Feedback error:", err);
        // Don't leave a "sent" state on screen for feedback that never landed.
        setSubmitted(null);
        toast.error("Couldn't send your feedback. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [runId, isSubmitting],
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
    return (
      <span
        role="status"
        title="Thanks for your feedback"
        className="flex size-8 items-center justify-center"
      >
        {submitted === "up" ? (
          <ThumbsUp className="fill-foreground text-foreground size-4" />
        ) : (
          <ThumbsDown className="fill-signal text-signal size-4" />
        )}
        <span className="sr-only">Thanks for your feedback</span>
      </span>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-2"
    >
      {!submitted && (
        <>
          <TooltipIconButton
            tooltip="Good response"
            onClick={handleUp}
            disabled={isSubmitting}
            className="text-muted-foreground hover:text-foreground"
          >
            <ThumbsUp />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="Bad response"
            onClick={handleDown}
            disabled={isSubmitting}
            className="text-muted-foreground hover:text-signal-text"
          >
            <ThumbsDown />
          </TooltipIconButton>
        </>
      )}

      {/* Comment box drops DOWN below the toolbar */}
      {showComment && (
        <div
          className={cn(
            cardVariants({ tone: "float" }),
            "absolute top-full left-0 z-20 mt-2 flex w-80 flex-col gap-3 p-4",
          )}
        >
          <label
            htmlFor={`feedback-comment-${runId}`}
            className="text-[15px] leading-6 font-semibold"
          >
            What went wrong?
          </label>
          <textarea
            id={`feedback-comment-${runId}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional details"
            rows={2}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCommentSubmit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                handleCommentSkip();
              }
            }}
            className={cn(
              "w-full resize-none rounded-md border px-3 py-2 text-base",
              "border-input bg-background text-foreground placeholder:text-muted-foreground",
              "focus-visible:border-foreground focus-visible:ring-signal/20 outline-none focus-visible:ring-4",
            )}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleCommentSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Sending…" : "Submit"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCommentSkip}
              disabled={isSubmitting}
              className="text-muted-foreground"
            >
              Skip
            </Button>
            {shortcutLabel && (
              <kbd className="text-muted-foreground ml-auto text-xs">
                {shortcutLabel}
              </kbd>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
