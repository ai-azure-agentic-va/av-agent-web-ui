"use client";

import { useSyncExternalStore } from "react";

/**
 * Background-run registry.
 *
 * The LangGraph SDK (with `reconnectOnMount: true`) persists one
 * `lg:stream:<threadId>` sessionStorage entry per resumable run: written when
 * the run is created, removed when its stream finishes cleanly or is stopped.
 * Because runs are submitted with `onDisconnect: "continue"`, navigating to
 * another thread only closes the client SSE — the run keeps executing
 * server-side and the key stays behind, and re-opening the thread makes the
 * SDK auto-rejoin the live stream.
 *
 * That makes those keys the single source of truth for "this thread has a run
 * in flight (or one that finished in the background and hasn't been re-opened
 * yet)". This module mirrors them into React via useSyncExternalStore so the
 * history sidebar can badge running conversations. The SDK offers no write
 * hook, so the stream provider calls notifyBackgroundRuns() after every run
 * lifecycle transition it observes (created / finished / errored / stopped).
 *
 * sessionStorage is per-tab, so indicators are per-tab as well — consistent
 * with the SDK's own reconnect scope.
 */

const PREFIX = "lg:stream:";

const EMPTY: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();

function scan(): ReadonlySet<string> {
  if (typeof window === "undefined") return EMPTY;
  const next = new Set<string>();
  try {
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) next.add(key.slice(PREFIX.length));
    }
  } catch {
    // sessionStorage unavailable (privacy mode) — treat as no background runs.
  }
  return next;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// Seed on module load so a page refresh mid-run shows the indicator
// immediately (the SDK key survives the reload in sessionStorage).
let snapshot: ReadonlySet<string> = typeof window === "undefined" ? EMPTY : scan();

/**
 * Re-scan the SDK's run keys and notify subscribers if the set changed.
 * Cheap and idempotent — call after any run lifecycle event.
 */
export function notifyBackgroundRuns(): void {
  const next = scan();
  if (setsEqual(next, snapshot)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReadonlySet<string> {
  return snapshot;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

/** Thread ids that have a run in flight (or unconsumed) in this tab. */
export function useBackgroundRuns(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
