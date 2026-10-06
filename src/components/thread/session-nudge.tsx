import { useEffect, useState } from "react";
import { Message } from "@langchain/langgraph-sdk";
import { SquarePen, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

/**
 * Session-boundary nudge.
 *
 * A soft, dismissable banner suggesting a fresh chat once a conversation grows
 * long. Long threads get slower and costlier as history accumulates; a clean
 * reset (reusing the existing `setThreadId(null)` action) is the cheapest way to
 * keep responses fast and focused.
 *
 * The trigger is a simple human-turn count (robust and backend-free). Dismissal
 * is per-turn — it only hides the nudge until the next message is sent, so once a
 * conversation is past the threshold the reminder keeps resurfacing on every new
 * turn. It also resets whenever `threadId` changes so it can reappear in a new
 * long chat.
 */

// Chats are expected to run 40+ turns comfortably, so the nudge stays quiet
// through that range and only appears once a conversation is genuinely long.
const DEFAULT_NUDGE_TURNS = 40;

function nudgeThreshold(): number {
  const raw = process.env.NEXT_PUBLIC_SESSION_NUDGE_TURNS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NUDGE_TURNS;
}

export function SessionBoundaryNudge({
  messages,
  threadId,
  onStartFresh,
}: {
  messages: Message[];
  threadId: string | null;
  onStartFresh: () => void;
}) {
  // Human-turn count at which the nudge was last dismissed. `null` means never
  // dismissed in this thread. The nudge reappears as soon as `humanTurns` moves
  // past this value, so dismissing only silences it until the next message.
  const [dismissedAtTurn, setDismissedAtTurn] = useState<number | null>(null);

  // Reset dismissal on conversation switch so the nudge is per-thread.
  useEffect(() => {
    setDismissedAtTurn(null);
  }, [threadId]);

  const humanTurns = messages.filter((m) => m.type === "human").length;
  const dismissed = dismissedAtTurn !== null && humanTurns <= dismissedAtTurn;
  if (dismissed || humanTurns < nudgeThreshold()) return null;

  return (
    <div
      className={cn(
        "border-border bg-muted/40 mb-2 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm",
      )}
    >
      <p className="text-muted-foreground flex-1">
        This conversation is getting long — starting a fresh chat keeps responses
        fast and accurate.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={onStartFresh}
      >
        <SquarePen className="h-3.5 w-3.5" />
        Start fresh
      </Button>
      <button
        type="button"
        onClick={() => setDismissedAtTurn(humanTurns)}
        className="text-muted-foreground hover:text-foreground"
        title="Dismiss"
        aria-label="Dismiss"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
