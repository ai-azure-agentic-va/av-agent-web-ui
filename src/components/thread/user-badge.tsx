"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getInitials } from "@/lib/public-user";
import { useSessionUser } from "@/providers/SessionUser";

/**
 * The signed-in user's initials and display name, shown in the chat header to
 * the left of Log out. Renders nothing when nobody is signed in.
 *
 * The trigger is focusable so keyboard users can open the tooltip (full name and
 * email). The initials circle is decorative; screen readers read the name.
 */
export function UserBadge() {
  const user = useSessionUser();
  if (!user) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          data-testid="user-badge"
          className="focus-visible:ring-ring flex min-w-0 items-center gap-2.5 rounded-md px-1 outline-none focus-visible:ring-2"
        >
          <span
            aria-hidden="true"
            data-testid="user-badge-initials"
            className="bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
          >
            {getInitials(user.name)}
          </span>
          <span
            data-testid="user-badge-name"
            className="text-foreground hidden max-w-48 truncate text-sm sm:block"
          >
            {user.name}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{user.name}</p>
        {user.email && <p>{user.email}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
