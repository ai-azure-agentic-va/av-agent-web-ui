// Composer attachments are Markdown files only. Each goes to the backend as
// one plain text block, tagged with its file name: the model reads the text
// inline, and no file part is involved (Azure OpenAI only takes PDFs as files).
// The tag lets the UI tell the file apart from the person's own words, so
// getContentString leaves it out of the headline, history title, copy and
// edit, and the message shows it as a file instead.
export type MarkdownAttachmentBlock = { type: "text"; text: string };

// Images and PDFs, as attached before uploads were limited to Markdown. New
// messages never carry them, but older threads do, so they still render.
// They're in LangChain's *Python* v1 standard content-block shape (snake_case
// `base64` / `mime_type`), which the backend's langchain-openai converts into
// Azure OpenAI `image_url` / `file` parts.
export type Base64AttachmentBlock = {
  type: "image" | "file";
  base64: string;
  mime_type: string;
  extras?: { filename?: string };
};

export type AttachmentBlock = MarkdownAttachmentBlock | Base64AttachmentBlock;

// Browsers disagree on a .md file's type ("text/markdown", "text/x-markdown"
// or none at all), so the picker filters by extension and so does the check.
export const ACCEPTED_FILE_EXTENSIONS = [".md"];

export const MAX_ATTACHMENTS = 5;
// The backend's context management counts tokens with
// count_tokens_approximately, about 1 token per 4 characters. Past this a
// message's files would trip summarization or the sliding-window floor on
// their very first turn. Raise only alongside the backend's token budget.
export const MAX_TOTAL_BYTES = 500 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

function isAcceptedName(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Returns a user-facing reason the file can't be attached, or null if OK. */
export function validateAttachment(file: File): string | null {
  if (!isAcceptedName(file.name)) {
    return `${file.name}: only Markdown (.md) files are supported.`;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  if (file.size > MAX_TOTAL_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_TOTAL_BYTES)}.`;
  }
  return null;
}

const MARKDOWN_BLOCK_RE =
  /^<attached_file name="([^"]*)">\n([\s\S]*)\n<\/attached_file>$/;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

export function markdownAttachmentBlock(
  filename: string,
  text: string,
): MarkdownAttachmentBlock {
  return {
    type: "text",
    text: `<attached_file name="${escapeAttr(filename)}">\n${text}\n</attached_file>`,
  };
}

export function isMarkdownAttachmentBlock(
  block: unknown,
): block is MarkdownAttachmentBlock {
  if (!block || typeof block !== "object") return false;
  const b = block as { type?: unknown; text?: unknown };
  return (
    b.type === "text" &&
    typeof b.text === "string" &&
    MARKDOWN_BLOCK_RE.test(b.text)
  );
}

/** The attached file's name and text, as the person picked it. */
export function readMarkdownAttachment(block: MarkdownAttachmentBlock): {
  filename: string;
  text: string;
} {
  const match = MARKDOWN_BLOCK_RE.exec(block.text);
  return match
    ? { filename: unescapeAttr(match[1]), text: match[2] }
    : { filename: "", text: block.text };
}

/** Approximate raw size of an attachment. */
export function attachmentBytes(block: AttachmentBlock): number {
  if (block.type === "text") {
    return new TextEncoder().encode(readMarkdownAttachment(block).text).length;
  }
  return Math.floor((block.base64.length * 3) / 4);
}

export async function fileToContentBlock(
  file: File,
): Promise<MarkdownAttachmentBlock> {
  return markdownAttachmentBlock(file.name, await file.text());
}

export function isBase64ContentBlock(
  block: unknown,
): block is Base64AttachmentBlock {
  if (typeof block !== "object" || block === null) return false;
  const b = block as Record<string, unknown>;
  if (typeof b.base64 !== "string" || typeof b.mime_type !== "string") {
    return false;
  }
  return (
    (b.type === "image" && b.mime_type.startsWith("image/")) ||
    (b.type === "file" && b.mime_type === "application/pdf")
  );
}

/** A file attached to a message: a Markdown file, or an older image or PDF. */
export function isAttachmentBlock(block: unknown): block is AttachmentBlock {
  return isMarkdownAttachmentBlock(block) || isBase64ContentBlock(block);
}
