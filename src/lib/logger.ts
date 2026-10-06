import "server-only";

// Minimal level-gated logger. Verbose lines (scopes, oids, emails, group IDs)
// should only print when LOG_LEVEL=DEBUG so they don't leak into prod logs.
//
// LOG_LEVEL (case-insensitive): DEBUG < INFO < WARN < ERROR. Default INFO.
// A message prints only when its level is >= the configured threshold.

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function threshold(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase() as Level | undefined;
  return raw && raw in ORDER ? ORDER[raw] : ORDER.info;
}

function enabled(level: Level): boolean {
  return ORDER[level] >= threshold();
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (enabled("debug")) console.debug(...args);
  },
  info: (...args: unknown[]) => {
    if (enabled("info")) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (enabled("warn")) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (enabled("error")) console.error(...args);
  },
};
