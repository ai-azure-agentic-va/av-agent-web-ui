import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { AnalyzedDocument } from "@/providers/Stream";

/** Render an ISO timestamp as YYYY-MM-DD, or pass through a non-date string. */
function formatModified(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

function docLabel(doc: AnalyzedDocument, idx: number): string {
  return doc.title || doc.file_name || `Document ${idx}`;
}

/**
 * The answer's source credit: a black strap that closes the answer, led by the
 * documents this answer actually cites, over the CUMULATIVE set AI Search has
 * surfaced across the conversation (append-only, numbered 1..n by the backend).
 * Inline [n] markers in the answer use the same red numerals as the credit.
 *
 * COLLAPSED BY DEFAULT: the full list can grow to hundreds of links over a long
 * conversation, so it opens only on request. Each answer owns its expand state.
 */
export function DocumentsAnalyzed({
  documents,
  cited = [],
}: {
  documents: AnalyzedDocument[];
  cited?: number[];
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  if (!documents || documents.length === 0) return null;

  const byIndex = new Map(documents.map((d, i) => [d.index ?? i + 1, d]));
  const citedSet = new Set(cited);
  const lead = cited.slice(0, 3).flatMap((n) => {
    const doc = byIndex.get(n);
    return doc ? [{ n, doc }] : [];
  });

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        // Toggle on pointer-down, not click: while the answer streams,
        // StickToBottom auto-scrolls the list, which can move this button between
        // mousedown and mouseup so the derived `click` is unreliable (mirrors the
        // trace disclosure). Keyboard handled separately below.
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
        className="bg-primary text-primary-foreground corner-step focus-visible:ring-ring flex min-h-9 w-full items-stretch overflow-hidden text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <span className="bg-ink-raised flex shrink-0 items-center px-3 font-semibold">
          Sources
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-5 px-3">
          {lead.length > 0 ? (
            lead.map(({ n, doc }, i) => (
              <span
                key={n}
                className={cn(
                  "min-w-0 items-center gap-1.5",
                  // Phones show the first credit only; the count says the rest.
                  i === 0 ? "flex" : "hidden md:flex",
                )}
              >
                <span className="text-cite-on-ink text-xs font-medium">
                  {n}
                </span>
                <span className="max-w-[15rem] truncate">
                  {docLabel(doc, n)}
                </span>
              </span>
            ))
          ) : (
            <span>Referenced sources</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 px-3 text-xs">
          <span>
            {documents.length}
            <span className="sr-only"> sources</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded && (
        <ol
          id={panelId}
          className="divide-border border-border divide-y border-b text-sm"
        >
          {documents.map((doc, i) => {
            const idx = doc.index ?? i + 1;
            const label = docLabel(doc, idx);
            const modified = formatModified(doc.updated_at);
            const isCited = citedSet.has(idx);
            return (
              <li
                key={`${idx}-${i}`}
                className="grid grid-cols-[2.25rem_1fr] gap-x-2 py-2.5"
              >
                <span
                  className={cn(
                    "pt-0.5 text-right text-xs font-medium",
                    isCited ? "text-cite" : "text-muted-foreground",
                  )}
                >
                  {idx}
                </span>
                <span className="min-w-0">
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground decoration-cite/50 hover:decoration-cite focus-visible:ring-ring rounded-[2px] break-words underline decoration-1 underline-offset-4 transition-colors outline-none focus-visible:ring-2"
                    >
                      {label}
                    </a>
                  ) : (
                    <span className="break-words">{label}</span>
                  )}
                  {modified && (
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      Updated {modified}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
