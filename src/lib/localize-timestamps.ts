/**
 * Localize the ServiceNow-style UTC timestamps that the backend bakes into
 * assistant answers into the viewer's own timezone.
 *
 * The backend's `_utc_timestamp` (servicenow/tools.py) renders incident times
 * like `2026-05-10 17:00:00 UTC` and appends a literal "UTC" suffix so the zone
 * travels with the value into the answer text. Those strings arrive here as
 * plain markdown, so we can't know the user's zone server-side.
 *
 * This module is a react-markdown rehype plugin: it scans text nodes for the
 * UTC pattern and wraps each match in a `<time dateTime="…Z">` element. The
 * conversion to local time then happens on the CLIENT in the `<LocalTime>`
 * component (markdown-components.tsx) so it always reflects the browser's
 * timezone and stays hydration-safe (SSR renders the original; local time is
 * applied after mount).
 */

// Matches "YYYY-MM-DD HH:MM[:SS] UTC" — space or `T` separator, optional
// seconds, case-insensitive "UTC". Kept strict so we never rewrite ordinary
// numbers or ISO strings that already carry an offset.
export const UTC_TIMESTAMP_RE =
  /\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*UTC\b/gi;

/** Build a parseable ISO-8601 UTC string from the captured date/time parts. */
export function toUtcIso(dateStr: string, timeStr: string): string {
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr; // ensure seconds
  return `${dateStr}T${time}Z`;
}

/**
 * Format an instant in the viewer's local timezone as "YYYY-MM-DD HH:MM:SS TZ"
 * — mirrors the backend's numeric layout, just localized (e.g. "… EDT").
 * `timeZone` is exposed for deterministic tests; production omits it so the
 * browser's own zone is used.
 */
export function formatLocalTimestamp(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // en-CA + hour12:false can emit "24" for midnight in some engines — normalize.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
}

// --- rehype plugin ---------------------------------------------------------

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

/**
 * Split a text value into a mix of text nodes and `<time>` element nodes, one
 * per UTC timestamp found. Returns a single text node unchanged when there are
 * no matches.
 */
export function splitTextForTimestamps(value: string): HastNode[] {
  UTC_TIMESTAMP_RE.lastIndex = 0;
  const out: HastNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = UTC_TIMESTAMP_RE.exec(value)) !== null) {
    const [full, dateStr, timeStr] = match;
    if (match.index > last) {
      out.push({ type: "text", value: value.slice(last, match.index) });
    }
    out.push({
      type: "element",
      tagName: "time",
      properties: { dateTime: toUtcIso(dateStr, timeStr) },
      children: [{ type: "text", value: full }],
    });
    last = match.index + full.length;
  }
  if (out.length === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

// Never rewrite timestamps inside code / preformatted blocks (raw payloads,
// examples) or an existing <time>.
const SKIP_TAGS = new Set(["code", "pre", "time"]);

function walk(node: HastNode, insideSkip: boolean): void {
  if (!node.children || node.children.length === 0) return;
  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && !insideSkip) {
      next.push(...splitTextForTimestamps(child.value ?? ""));
      continue;
    }
    if (child.type === "element") {
      const skip =
        insideSkip || (child.tagName ? SKIP_TAGS.has(child.tagName) : false);
      walk(child, skip);
    }
    next.push(child);
  }
  node.children = next;
}

/** react-markdown rehype plugin — see module docstring. */
export function rehypeLocalizeTimestamps() {
  return (tree: HastNode) => walk(tree, false);
}
