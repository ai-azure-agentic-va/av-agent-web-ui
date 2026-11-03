// Attachments are sent in LangChain's *Python* v1 standard content-block shape
// (snake_case `base64` / `mime_type`), because that is what the backend's
// langchain-openai converts into Azure OpenAI `image_url` / `file` parts. The
// JS-style shape (`mimeType` / `data`) is NOT recognised by the Python side and
// would be forwarded verbatim, which the model API rejects. The filename rides
// in `extras` so it survives in thread state for display; langchain-openai
// drops it for images and uses it as the required `filename` for PDFs.
export type AttachmentBlock = {
  type: "image" | "file";
  base64: string;
  mime_type: string;
  extras?: { filename?: string };
};

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
export const SUPPORTED_FILE_TYPES = [
  ...SUPPORTED_IMAGE_TYPES,
  "application/pdf",
];

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// The backend's context management counts tokens with
// count_tokens_approximately, which charges a PDF by its base64 length
// (~1 token per 3 raw bytes) — a PDF much past this would trip summarization or
// the sliding-window floor on its very first turn. Raise only alongside a
// backend token counter that prices file blocks realistically.
export const MAX_PDF_BYTES = 500 * 1024;
// Next.js buffers request bodies through middleware only up to 10MB; base64
// inflates by 4/3, so keep the raw total comfortably under that.
export const MAX_TOTAL_BYTES = 7 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** Returns a user-facing reason the file can't be attached, or null if OK. */
export function validateAttachment(file: File): string | null {
  if (!SUPPORTED_FILE_TYPES.includes(file.type)) {
    return `${file.name}: only images (JPEG, PNG, GIF, WebP) and PDFs are supported.`;
  }
  const limit =
    file.type === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) {
    return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(limit)}.`;
  }
  return null;
}

/** Approximate raw size of an attachment from its base64 payload. */
export function attachmentBytes(block: AttachmentBlock): number {
  return Math.floor((block.base64.length * 3) / 4);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function fileToContentBlock(file: File): Promise<AttachmentBlock> {
  return {
    type: SUPPORTED_IMAGE_TYPES.includes(file.type) ? "image" : "file",
    base64: await fileToBase64(file),
    mime_type: file.type,
    extras: { filename: file.name },
  };
}

export function isBase64ContentBlock(block: unknown): block is AttachmentBlock {
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
