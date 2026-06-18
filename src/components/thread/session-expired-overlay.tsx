import { LogIn } from "lucide-react";

/**
 * Renders the expired-session banner. The caller (thread/index.tsx) owns the
 * `sessionExpired` boolean from useStreamContext() and only mounts this
 * component when it's true — keeping this a dumb presentational component
 * avoids a second context subscription for the same value.
 *
 * The single available action is re-authenticating via /api/auth/logout,
 * which clears the stale cookie and round-trips through Entra logout back to
 * /chat (chat/page.tsx then redirects to /api/auth/login since there's no
 * valid session left). Intentionally manual — no auto-redirect; the user
 * stays in control of when they leave the page.
 */
export function SessionExpiredOverlay() {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span>Your session has expired. Please log in again to continue.</span>
      <a
        href="/api/auth/logout"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-900 px-3 py-1.5 font-medium text-amber-50 transition-colors hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-300"
      >
        <LogIn className="h-3.5 w-3.5" />
        Log in again
      </a>
    </div>
  );
}