import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { AnalyzedDocument } from "@/providers/Stream";

/** Render an ISO timestamp as YYYY-MM-DD, or pass through a non-date string. */
function formatModified(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

/**
 * "Referenced Sources" — the CUMULATIVE set of documents AI Search has surfaced
 * across the conversation up to this answer (append-only, chunks collapsed to
 * documents), numbered 1..n by the backend. Inline [n] citation markers in the
 * answer link to the matching entry here.
 *
 * COLLAPSED BY DEFAULT: the list is append-only and can grow to hundreds of links
 * over a long conversation, so it opens closed with just a "Referenced Sources (N)"
 * header the user can expand. Each answer's panel owns its expand state locally.
 */
export function DocumentsAnalyzed({
  documents,
}: {
  documents: AnalyzedDocument[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (!documents || documents.length === 0) return null;

  return (
    <div className="border-border mt-3 border-t pt-3 text-sm">
      <button
        type="button"
        aria-expanded={expanded}
        // Toggle on pointer-down, not click: while the answer streams,
        // StickToBottom auto-scrolls the list, which can move this button between
        // mousedown and mouseup so the derived `click` is unreliable (mirrors
        // ThoughtDisclosure). Keyboard handled separately below.
        onPointerDown={(e) => {
          e.preventDefault();
          setExpanded((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="text-foreground hover:text-primary flex items-center gap-1.5 font-semibold transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />
        Referenced Sources ({documents.length})
      </button>
      {expanded && (
        <ol className="mt-2 space-y-1">
          {documents.map((doc, i) => {
            const idx = doc.index ?? i + 1;
            const label = doc.title || doc.file_name || `Document ${idx}`;
            const modified = formatModified(doc.updated_at);
            return (
              <li
                key={`${idx}-${i}`}
                className="text-foreground"
              >
                <span className="text-muted-foreground mr-1 font-mono">
                  [{idx}]
                </span>
                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary break-all hover:underline"
                  >
                    {label}
                  </a>
                ) : (
                  <span className="break-all font-medium">{label}</span>
                )}
                {modified && (
                  <span className="text-muted-foreground ml-1">
                    (Last modified: {modified})
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
