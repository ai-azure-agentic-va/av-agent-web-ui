import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/public-user";
import { useSessionUser } from "@/providers/SessionUser";
import { AppLogo } from "../icons/app-logo";

// Speaker marks sit in the turn's left gutter: the person's initials open a
// turn at the question, the IVY mark closes it at the answer. Both are 28px
// so the chain's rail runs through their centres.
const MARK = "flex size-7 shrink-0 items-center justify-center";

/** The signed-in person, as in the header badge; a plain glyph without a session. */
export function HumanMark({ className }: { className?: string }) {
  const user = useSessionUser();
  return (
    <span
      aria-hidden="true"
      className={cn(
        MARK,
        "bg-foreground text-background rounded-full text-xs font-medium",
        className,
      )}
    >
      {user ? getInitials(user.name) : <User className="size-3.5" />}
    </span>
  );
}

/**
 * The IVY mark (public/logo.png, a three-leaf plant with a circuit cut out of
 * it). It pulses while the agent is writing the answer, the one live element on
 * screen at that moment.
 */
export function AgentMark({
  responding = false,
  className,
}: {
  responding?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(MARK, responding && "live-dot", className)}
    >
      <AppLogo
        width={28}
        height={28}
      />
    </span>
  );
}
