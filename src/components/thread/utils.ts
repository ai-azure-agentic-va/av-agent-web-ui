import type { Message } from "@langchain/langgraph-sdk";

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

/**
 * Turn inline `[n]` citation markers in the answer into clickable links to the
 * corresponding source URL, so a user can click the citation in the text. Markers
 * with no matching source (or no URL) are left as plain text.
 */
export function linkifyCitations(
  content: string,
  sources?: { index?: number; url?: string }[],
): string {
  if (!content || !sources || sources.length === 0) return content;
  const urlByIndex = new Map<number, string>();
  sources.forEach((s, i) => {
    const idx = s.index ?? i + 1;
    if (s.url) urlByIndex.set(idx, s.url);
  });
  if (urlByIndex.size === 0) return content;
  return content.replace(/\[(\d{1,2})\]/g, (match, num) => {
    const url = urlByIndex.get(Number(num));
    // Escaped inner brackets so the link text renders as literal "[n]".
    return url ? `[\\[${num}\\]](${url})` : match;
  });
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
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
