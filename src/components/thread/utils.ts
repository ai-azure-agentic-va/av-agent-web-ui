import type { Message, ToolMessage } from "@langchain/langgraph-sdk";
import type { AnalyzedDocument } from "@/providers/Stream";

/**
 * Extracts a string summary from a message's content, supporting multimodal (text, image, file, etc.).
 * - If text is present, returns the joined text.
 * - If not, returns a label for the first non-text modality (e.g., 'Image', 'Other').
 * - If unknown, returns 'Multimodal message'.
 */
export function getContentString(content: Message["content"]): string {
  if (typeof content === "string") return content;
  const texts = content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text);
  return texts.join(" ");
}

// Matches the backend's canonical follow-up heading ("## Want to explore further?").
const FOLLOW_UP_HEADING_RE =
  /^[ \t]{0,3}(?:#{1,6}[ \t]+)?\*{0,2}[ \t]*want to explore further[\s*?:.]*$/i;
const MD_HEADING_RE = /^#{1,6}\s/;
const MD_BULLET_RE = /^(?:[-*+]|\d+[.)])\s+(.+)$/;

/** Parse the "Want to explore further?" bullets out of an assistant message. */
export function extractFollowUps(content: string): string[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => FOLLOW_UP_HEADING_RE.test(l.trim()));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && out.length < 3; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (MD_HEADING_RE.test(line)) break;
    const bullet = line.match(MD_BULLET_RE);
    if (!bullet) {
      if (out.length) break;
      continue;
    }
    const q = bullet[1]
      .trim()
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/^["“'](.*)["”']$/, "$1")
      .trim();
    if (q) out.push(q);
  }
  return out;
}

// A follow-up chip is worded as a question the assistant poses to the user
// ("Do you want to add …?"). Older answers (and any stray generation) phrase it
// in the second person, so sending it verbatim makes the agent read the "you"
// as itself, treat it as a meta-question about ITS OWN preferences, and refuse
// as out of scope. Strip that leading interrogative wrapper so the click
// submits the user's actual request. Ordered longest-first so "do you want me
// to" wins over "do you want".
const FOLLOW_UP_WRAPPER_RE =
  /^(?:do you want me to|do you want to|do you want|would you like me to|would you like to|would you like|do you need me to|do you need to|would you like for me to|want me to|shall i|should i|can i|may i)\b[\s,:-]*/i;

/**
 * Normalize a clicked follow-up suggestion into the request the user actually
 * means before it is submitted as their next turn. If the suggestion opens with
 * a second-person wrapper ("Do you want to …?"), drop it, drop the now-dangling
 * trailing "?", and re-capitalize so the sent message reads as a clean request
 * ("Add …"). Suggestions already phrased in the user's voice are returned
 * unchanged (the wrapper never matches), so this is a no-op for the fixed
 * backend prompt and a safety net for pre-existing threads.
 */
export function normalizeFollowUpForSubmit(question: string): string {
  const q = question.trim();
  const stripped = q.replace(FOLLOW_UP_WRAPPER_RE, "").trim();
  // No wrapper matched → send the original verbatim.
  if (stripped === q) return q;
  const core = stripped.replace(/\s*\?+\s*$/, "").trim();
  // Wrapper was the whole message (e.g. "Do you want to?") → nothing meaningful
  // survives; fall back to the original rather than sending a bare "?".
  if (core.length === 0) return q;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

/**
 * Turn inline `[n]` citation markers in the answer into clickable links to the
 * matching document in the "Referenced Sources" list (by its backend-assigned
 * `index`). Markers with no matching document (or no URL) are left as plain text.
 */
export function linkifyCitations(
  content: string,
  documents?: { index?: number; url?: string }[],
): string {
  if (!content || !documents || documents.length === 0) return content;
  const urlByIndex = new Map<number, string>();
  documents.forEach((d, i) => {
    const idx = d.index ?? i + 1;
    if (d.url) urlByIndex.set(idx, d.url);
  });
  if (urlByIndex.size === 0) return content;
  // Match any marker number; an `[n]` with no matching document is left as plain
  // text rather than dropped, so any model/backend mismatch degrades gracefully.
  return content.replace(/\[(\d{1,3})\]/g, (match, num) => {
    const url = urlByIndex.get(Number(num));
    if (!url) return match;
    // SharePoint/OneDrive URLs contain spaces (e.g. "/Shared Documents/") and
    // parentheses, which BREAK a bare markdown destination `(url)` — CommonMark
    // aborts the link and leaves the raw `[[n]](url)` in the text. Wrap the
    // destination in <> (an angle-bracket destination may contain spaces and
    // parens) and %20-encode spaces for a clean href; escape the only chars
    // that would break the <> form itself.
    const safeUrl = url.replace(/[<>]/g, encodeURIComponent).replace(/ /g, "%20");
    // Escaped inner brackets so the link text renders as literal "[n]".
    return `[\\[${num}\\]](<${safeUrl}>)`;
  });
}

// The backend registers the KB search tool under this name; its ToolMessage
// carries the turn's retrieved documents on `.artifact` (see ai_search_tool).
const AI_SEARCH_TOOL_NAME = "ai_search_tool";

/** Read the documents list off a ToolMessage artifact, tolerating either the
 * bare-array shape the tool returns or a `{ documents: [...] }` wrapper. Returns
 * an empty array for anything unexpected (e.g. historical messages predating the
 * artifact, whose `.artifact` is undefined). */
function documentsFromArtifact(artifact: unknown): AnalyzedDocument[] {
  if (Array.isArray(artifact)) return artifact as AnalyzedDocument[];
  if (
    artifact &&
    typeof artifact === "object" &&
    Array.isArray((artifact as { documents?: unknown }).documents)
  ) {
    return (artifact as { documents: AnalyzedDocument[] }).documents;
  }
  return [];
}

/**
 * Rebuild the per-answer documents map from PERSISTED messages — the durable
 * source for threads opened from history, where the live `documents` custom
 * stream event never replays. `ai_search_tool` persists its retrieved-document
 * set on the ToolMessage `.artifact`, so we walk each turn (a `human` message
 * starts a new one), union that turn's tool artifacts deduped by the backend's
 * turn-stable `index`, and key the result under the turn's answer (its last
 * text-bearing AI) message id — the same key the live path and ai.tsx use, so
 * history renders identically to a live turn. Turns without a KB search yield no
 * entry.
 */
export function deriveDocumentsFromMessages(
  messages: Message[],
): Record<string, AnalyzedDocument[]> {
  const out: Record<string, AnalyzedDocument[]> = {};
  // Current turn's documents (deduped by index) + the id of the turn's latest AI
  // message. The answer is the last AI message of the turn, so this keeps moving
  // to the newest AI id; tool artifacts accrue regardless of intra-turn order.
  let byIndex = new Map<number, AnalyzedDocument>();
  let answerId: string | null = null;

  const flush = () => {
    if (answerId && byIndex.size > 0) {
      out[answerId] = [...byIndex.values()].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      );
    }
    byIndex = new Map();
    answerId = null;
  };

  for (const m of messages) {
    if (m.type === "human") {
      flush();
      continue;
    }
    if (m.type === "ai") {
      // Key docs to the ANSWER — the last AI message that carries text. A
      // tool-call-only AI message (empty content, which appears mid-turn while a
      // live turn streams) must NEVER become the host, or "Referenced Sources"
      // would flash under the in-flight tool-call bubble before the answer
      // streams, then jump. A settled turn's answer always carries text, so this
      // keys identically to the live path for history.
      if (m.id && getContentString(m.content).trim() !== "") answerId = m.id;
      continue;
    }
    if (m.type === "tool" && (m as ToolMessage).name === AI_SEARCH_TOOL_NAME) {
      for (const doc of documentsFromArtifact((m as ToolMessage).artifact)) {
        const idx = doc.index;
        // First payload for an index wins; the backend records a document once
        // per turn, so repeats across a turn's searches are identical anyway.
        if (typeof idx === "number" && !byIndex.has(idx)) byIndex.set(idx, doc);
      }
    }
  }
  flush(); // last turn has no trailing `human` to trigger the flush above
  return out;
}

/** Remove the "Want to explore further?" section so it can render as chips instead. */
export function stripFollowUpSection(content: string): string {
  if (!content) return content;
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => FOLLOW_UP_HEADING_RE.test(l.trim()));
  if (start === -1) return content;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end].trim();
    if (!line) {
      end += 1;
      continue;
    }
    // Stop at the next heading or any non-bullet content (e.g. "Cited Sources").
    if (MD_HEADING_RE.test(line) || !MD_BULLET_RE.test(line)) break;
    end += 1;
  }
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
