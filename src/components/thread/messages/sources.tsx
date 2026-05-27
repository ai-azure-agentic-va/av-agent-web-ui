import { ExternalLink, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Source } from "@/providers/Stream";

export function SourcesList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-1 rounded-lg border border-border bg-muted/30 text-sm">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {sources.length} source{sources.length !== 1 ? "s" : ""}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {open && (
        <div className="divide-y divide-border border-t border-border">
          {sources.map((s, i) => {
            const label =
              s.title || s.file_name || `Source ${(s.index ?? i) + 1}`;
            return (
              <div key={i} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 truncate font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{label}</span>
                      </a>
                    ) : (
                      <span className="block truncate font-medium text-foreground">
                        {label}
                      </span>
                    )}
                    {s.breadcrumb && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {s.breadcrumb}
                      </p>
                    )}
                    {s.updated_at && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Updated{" "}
                        {new Date(s.updated_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                  {s.index !== undefined && (
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      [{s.index}]
                    </span>
                  )}
                </div>
                {s.preview && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                    {s.preview}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
