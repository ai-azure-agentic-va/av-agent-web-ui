import { AnalyzedDocument } from "@/providers/Stream";

/** Render an ISO timestamp as YYYY-MM-DD, or pass through a non-date string. */
function formatModified(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

/**
 * "Documents Analyzed" — every document AI Search retrieved for this answer
 * (chunks collapsed to documents), numbered 1..n by the backend. Inline [n]
 * citation markers in the answer link to the matching entry here. Shown for all
 * retrieved documents, whether or not the answer cited them.
 */
export function DocumentsAnalyzed({
  documents,
}: {
  documents: AnalyzedDocument[];
}) {
  if (!documents || documents.length === 0) return null;

  return (
    <div className="border-border mt-3 border-t pt-3 text-sm">
      <p className="text-foreground mb-1.5 font-semibold">Documents Analyzed:</p>
      <ol className="space-y-1">
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
    </div>
  );
}
