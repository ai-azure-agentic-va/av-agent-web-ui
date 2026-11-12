"use client";

import { LogOut } from "lucide-react";
import { Button } from "../ui/button";
import { UserBadge } from "./user-badge";

/**
 * Right-hand group of the chat header: the signed-in user's badge, then Log
 * out. Log out keeps its original rule: it shows whenever SSO is enabled at
 * build time, independent of the runtime session.
 */
export function HeaderAccount({ ssoEnabled }: { ssoEnabled: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <UserBadge />
      {ssoEnabled && (
        <Button
          variant="ghost"
          className="text-foreground hover:text-signal-text h-10 gap-2 px-2.5 text-sm font-normal sm:px-3"
          title="Log out"
          data-testid="logout-button"
          onClick={() => {
            window.location.href = "/api/auth/logout";
          }}
        >
          <LogOut className="h-4 w-4" />
          {/* Icon-only on phones; the label stays available to screen readers. */}
          <span className="sr-only sm:not-sr-only">Log out</span>
        </Button>
      )}
    </div>
  );
}
