import { Source } from "@/providers/Stream";

function formatModified(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD, matching the legacy format
}

/**
 * Inline "Cited Sources:" list rendered from the backend `sources` data —
 * always visible (not a collapsible dropdown), mirroring the legacy answer
 * format: `[n] filename (Last modified: YYYY-MM-DD)`.
 */
export function CitedSources({ sources }: { sources: Source[] }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="text-sm">
      <p className="text-foreground font-semibold">Cited Sources:</p>
      <ul className="mt-1 space-y-0.5">
        {sources.map((s, i) => {
          const idx = s.index ?? i + 1;
          const label = s.file_name || s.title || `Source ${idx}`;
          const modified = formatModified(s.updated_at);
          return (
            <li
              key={`${idx}-${i}`}
              className="text-foreground"
            >
              <span className="text-muted-foreground">[{idx}]</span>{" "}
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {label}
                </a>
              ) : (
                <span className="font-medium">{label}</span>
              )}
              {modified && (
                <span className="text-muted-foreground">
                  {" "}
                  (Last modified: {modified})
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
