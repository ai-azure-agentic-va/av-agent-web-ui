import { ChevronDown, ChevronUp, Bug } from "lucide-react";
import { ReactNode, useState } from "react";
import { DebugPayload } from "@/providers/Stream";

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A single collapsible debug row (e.g. "Search Query (AI Search)"). */
function DebugRow({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{label}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

/** Compact key/value list; skips empty values. */
function KeyVals({ rows }: { rows: Array<[string, unknown]> }) {
  const visible = rows.filter(([, v]) => !isEmptyValue(v));
  if (visible.length === 0) {
    return <span className="italic">No details available.</span>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {visible.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-foreground/70">{k}</dt>
          <dd className="break-words text-foreground">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A labelled monospace block for longer text (prompt segments). */
function TextBlock({ label, text }: { label: string; text?: string | null }) {
  if (isEmptyValue(text)) return null;
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 font-medium text-foreground/70">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-foreground">
        {text}
      </pre>
    </div>
  );
}

export function DebugSection({ debug }: { debug: DebugPayload }) {
  const search = debug.search;
  const chunks = debug.chunks ?? [];
  const prompt = debug.prompt;
  const settings = debug.settings;

  return (
    <div className="mt-1 rounded-lg border border-border bg-muted/30 text-sm">
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground">
        <Bug className="h-3.5 w-3.5" />
        Debug
      </div>

      <div className="divide-y divide-border border-t border-border">
        {search && (
          <DebugRow label="Search Query (AI Search)">
            {search.rewritten_query && (
              <p className="mb-2 break-words font-medium text-foreground">
                {search.rewritten_query}
              </p>
            )}
            <KeyVals
              rows={[
                ["Original query", search.original_query],
                ["Tool query", search.tool_query],
                ["Index", search.index],
                ["Hybrid mode", search.hybrid?.mode],
                ["Top K requested", search.top_k_requested],
                ["Top K used", search.top_k_used],
                ["Embedding model", search.embedding_model],
                ["Semantic config", search.semantic_config],
              ]}
            />
          </DebugRow>
        )}

        <DebugRow label={`Retrieved Chunks (${chunks.length})`}>
          {chunks.length === 0 ? (
            <span className="italic">No chunks retrieved.</span>
          ) : (
            <div className="space-y-2">
              {chunks.map((c, i) => (
                <div
                  key={i}
                  className="rounded border border-border bg-muted/40 p-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      Chunk {c.chunk_number ?? i + 1}
                      {c.title ? `: ${c.title}` : ""}
                    </span>
                    {typeof c.score === "number" && (
                      <span className="shrink-0 text-foreground/60">
                        score {c.score.toFixed(4)}
                      </span>
                    )}
                  </div>
                  {c.source_url && (
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mb-1 block truncate text-primary hover:underline"
                    >
                      {c.source_url}
                    </a>
                  )}
                  {c.content && (
                    <pre className="mb-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-1.5 text-foreground">
                      {c.content}
                    </pre>
                  )}
                  {c.metadata && Object.keys(c.metadata).length > 0 && (
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] text-foreground/70">
                      {JSON.stringify(c.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </DebugRow>

        {prompt && (
          <DebugRow label="Full LLM Prompt">
            {prompt.messages && prompt.messages.length > 0 ? (
              prompt.messages.map((m, i) => (
                <TextBlock
                  key={i}
                  label={(m.role || "message").toUpperCase()}
                  text={m.content}
                />
              ))
            ) : (
              <>
                <TextBlock label="System" text={prompt.system} />
                <TextBlock label="User" text={prompt.user} />
                <TextBlock label="Grounding" text={prompt.grounding} />
                {isEmptyValue(prompt.system) &&
                  isEmptyValue(prompt.user) &&
                  isEmptyValue(prompt.grounding) && (
                    <span className="italic">No prompt details available.</span>
                  )}
              </>
            )}
          </DebugRow>
        )}

        {settings && (
          <DebugRow label="Settings">
            <KeyVals rows={Object.entries(settings)} />
          </DebugRow>
        )}
      </div>
    </div>
  );
}
