import React from "react";
import { File, FileText, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardVariants } from "@/components/ui/card";
import {
  type AttachmentBlock,
  attachmentBytes,
  formatBytes,
  readMarkdownAttachment,
} from "@/lib/multimodal-utils";
import Image from "next/image";
export interface MultimodalPreviewProps {
  block: AttachmentBlock;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const MultimodalPreview: React.FC<MultimodalPreviewProps> = ({
  block,
  removable = false,
  onRemove,
  className,
  size = "md",
}) => {
  // Markdown file
  if (block.type === "text") {
    const { filename } = readMarkdownAttachment(block);
    const name = filename || "Markdown file";
    // One line, the height of a skill pill beside it: the file's name, cut
    // short with the full name on hover, then its size.
    return (
      <div
        className={cn(
          cardVariants(),
          "relative flex h-8 max-w-[18rem] items-center gap-2 pr-1 pl-2.5",
          !removable && "pr-2.5",
          className,
        )}
      >
        <FileText
          aria-hidden="true"
          className={cn(
            "text-foreground shrink-0",
            size === "sm" ? "size-3.5" : "size-4",
          )}
        />
        <span
          className="text-foreground min-w-0 truncate text-[13px] font-medium"
          title={name}
        >
          {name}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          <span className="sr-only">Markdown, </span>
          {formatBytes(attachmentBytes(block))}
        </span>
        {removable && (
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  const filename = block.extras?.filename;

  // Image block (older threads)
  if (block.type === "image" && block.mime_type.startsWith("image/")) {
    const url = `data:${block.mime_type};base64,${block.base64}`;
    let imgClass: string = "rounded-md object-cover h-16 w-16 text-lg";
    if (size === "sm") imgClass = "rounded-md object-cover h-10 w-10 text-base";
    if (size === "lg") imgClass = "rounded-md object-cover h-24 w-24 text-xl";
    return (
      <div className={cn("relative inline-block", className)}>
        <Image
          src={url}
          alt={filename || "uploaded image"}
          title={filename}
          className={imgClass}
          width={size === "sm" ? 16 : size === "md" ? 32 : 48}
          height={size === "sm" ? 16 : size === "md" ? 32 : 48}
        />
        {removable && (
          <button
            type="button"
            className="bg-foreground text-background hover:bg-signal hover:text-signal-foreground focus-visible:ring-ring absolute top-1 right-1 z-10 rounded-full p-0.5 transition-colors outline-none focus-visible:ring-2"
            onClick={onRemove}
            aria-label={`Remove ${filename || "image"}`}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  // PDF block (older threads)
  if (block.type === "file" && block.mime_type === "application/pdf") {
    const name = filename || "PDF file";
    return (
      <div
        className={cn(
          cardVariants(),
          "relative flex h-8 max-w-[18rem] items-center gap-2 pr-1 pl-2.5",
          !removable && "pr-2.5",
          className,
        )}
      >
        <File
          aria-hidden="true"
          className={cn(
            "text-foreground shrink-0",
            size === "sm" ? "size-3.5" : "size-4",
          )}
        />
        <span
          className="text-foreground min-w-0 truncate text-[13px] font-medium"
          title={name}
        >
          {name}
        </span>
        {removable && (
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
            onClick={onRemove}
            aria-label={`Remove ${filename || "PDF"}`}
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <div
      className={cn(
        cardVariants(),
        "text-muted-foreground flex h-8 max-w-[18rem] items-center gap-2 pr-1 pl-2.5",
        className,
      )}
    >
      <File
        aria-hidden="true"
        className="size-4 shrink-0"
      />
      <span className="truncate text-[13px]">Unsupported file type</span>
      {removable && (
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
          onClick={onRemove}
          aria-label="Remove file"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
};
