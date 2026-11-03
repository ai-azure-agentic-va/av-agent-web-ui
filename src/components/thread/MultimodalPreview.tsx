import React from "react";
import { File, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardVariants } from "@/components/ui/card";
import type { AttachmentBlock } from "@/lib/multimodal-utils";
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
  const filename = block.extras?.filename;

  // Image block
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
            className="bg-foreground text-background hover:bg-signal focus-visible:ring-ring absolute top-1 right-1 z-10 rounded-full p-0.5 transition-colors outline-none focus-visible:ring-2"
            onClick={onRemove}
            aria-label={`Remove ${filename || "image"}`}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  // PDF block
  if (block.type === "file" && block.mime_type === "application/pdf") {
    return (
      <div
        className={cn(
          cardVariants(),
          "relative flex max-w-[16rem] items-start gap-2 py-2 pr-2 pl-3",
          className,
        )}
      >
        <div className="flex flex-shrink-0 flex-col items-start justify-start">
          <File
            className={cn("text-signal", size === "sm" ? "h-5 w-5" : "h-7 w-7")}
          />
        </div>
        <span className="text-foreground min-w-0 flex-1 text-sm break-all whitespace-pre-wrap">
          {filename || "PDF file"}
        </span>
        {removable && (
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring ml-1 self-start rounded-md p-1 transition-colors outline-none focus-visible:ring-2"
            onClick={onRemove}
            aria-label={`Remove ${filename || "PDF"}`}
          >
            <XIcon className="h-4 w-4" />
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
        "text-muted-foreground flex max-w-[16rem] items-center gap-2 py-2 pr-2 pl-3",
        className,
      )}
    >
      <File className="h-5 w-5 flex-shrink-0" />
      <span className="truncate text-sm">Unsupported file type</span>
      {removable && (
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring ml-1 rounded-md p-1 transition-colors outline-none focus-visible:ring-2"
          onClick={onRemove}
          aria-label="Remove file"
        >
          <XIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
