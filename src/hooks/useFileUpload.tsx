import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  AttachmentBlock,
  MAX_ATTACHMENTS,
  MAX_TOTAL_BYTES,
  attachmentBytes,
  fileToContentBlock,
  formatBytes,
  validateAttachment,
} from "@/lib/multimodal-utils";

function hasFiles(e: DragEvent | globalThis.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Staged composer attachments (images / PDFs) as backend-ready content blocks,
 * fed by the file picker, clipboard paste, and drag-and-drop. With
 * `enabled: false`, paste and drop fall through to their default behaviour.
 */
export function useFileUpload({ enabled = true }: { enabled?: boolean } = {}) {
  const [contentBlocks, setContentBlocks] = useState<AttachmentBlock[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // Limit checks must see every earlier pick, including files still being read
  // and blocks whose state update hasn't re-rendered yet — otherwise two quick
  // adds both pass against the same stale total. So the staged list is mirrored
  // synchronously (all writes go through commit) and in-flight reads are
  // reserved in pendingRef until they land.
  const blocksRef = useRef<AttachmentBlock[]>([]);
  const pendingRef = useRef({ count: 0, bytes: 0 });

  const commit = useCallback((next: AttachmentBlock[]) => {
    blocksRef.current = next;
    setContentBlocks(next);
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const errors: string[] = [];
      const accepted: File[] = [];
      let count = blocksRef.current.length + pendingRef.current.count;
      let total =
        blocksRef.current.reduce((n, b) => n + attachmentBytes(b), 0) +
        pendingRef.current.bytes;

      for (const file of files) {
        const error = validateAttachment(file);
        if (error) {
          errors.push(error);
        } else if (count >= MAX_ATTACHMENTS) {
          errors.push(
            `${file.name}: up to ${MAX_ATTACHMENTS} attachments per message.`,
          );
        } else if (total + file.size > MAX_TOTAL_BYTES) {
          errors.push(
            `${file.name}: attachments are limited to ${formatBytes(MAX_TOTAL_BYTES)} per message.`,
          );
        } else {
          accepted.push(file);
          count += 1;
          total += file.size;
        }
      }

      if (errors.length > 0) {
        toast.error(
          errors.length === 1
            ? "Couldn't attach file"
            : `Couldn't attach ${errors.length} files`,
          {
            description: (
              <ul className="list-disc pl-4">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ),
            richColors: true,
            closeButton: true,
          },
        );
      }
      if (accepted.length === 0) return;

      const reserved = {
        count: accepted.length,
        bytes: accepted.reduce((n, f) => n + f.size, 0),
      };
      pendingRef.current.count += reserved.count;
      pendingRef.current.bytes += reserved.bytes;
      try {
        const blocks = await Promise.all(accepted.map(fileToContentBlock));
        commit([...blocksRef.current, ...blocks]);
      } catch {
        toast.error("Couldn't read the selected file. Please try again.");
      } finally {
        // Released in the same tick as commit, so no check sees both or neither.
        pendingRef.current.count -= reserved.count;
        pendingRef.current.bytes -= reserved.bytes;
      }
    },
    [commit],
  );

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      void addFiles(Array.from(e.target.files ?? []));
      // Reset so picking the same file again still fires onChange.
      e.target.value = "";
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      // Office apps put an image rendering alongside copied text; only treat
      // the paste as an attachment when there is no text to paste.
      if (!enabled || e.clipboardData.types.includes("text/plain")) return;
      const files = Array.from(e.clipboardData.files);
      if (files.length === 0) return;
      e.preventDefault();
      void addFiles(files);
    },
    [enabled, addFiles],
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      setDragOver(true);
    },
    [enabled],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      setDragOver(false);
      void addFiles(Array.from(e.dataTransfer.files));
    },
    [enabled, addFiles],
  );

  // A file dropped outside the composer would otherwise make the browser
  // navigate away to it, discarding the chat.
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const removeBlock = useCallback(
    (idx: number) => commit(blocksRef.current.filter((_, i) => i !== idx)),
    [commit],
  );

  const resetBlocks = useCallback(() => commit([]), [commit]);

  return {
    contentBlocks,
    dragOver,
    handleFileInput,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeBlock,
    resetBlocks,
  };
}

export type FileUpload = ReturnType<typeof useFileUpload>;
