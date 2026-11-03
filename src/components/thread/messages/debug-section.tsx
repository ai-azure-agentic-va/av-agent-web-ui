import { ChevronDown, Bug } from "lucide-react";
import { ReactNode, useState } from "react";
import { DebugPayload } from "@/providers/Stream";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

// Raw text sits in the same block as a tool step's raw input and output.
const RAW_BLOCK =
  "border-border text-foreground scrollbar-thin overflow-auto rounded-[2px] border p-2.5 font-mono text-xs leading-5 break-words whitespace-pre-wrap";

/** A single collapsible debug row (e.g. "Search query (AI Search)"). */
function DebugRow({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className="text-foreground hover:bg-muted focus-visible:ring-ring flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span>{label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-border text-muted-foreground border-t px-4 py-3 text-xs">
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
    return <span className="text-muted-foreground">No details available.</span>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {visible.map(([k, v]) => (
        <div
          key={k}
          className="contents"
        >
          <dt className="text-muted-foreground font-medium">{k}</dt>
          <dd className="text-foreground break-words">{String(v)}</dd>
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
      <p className="text-muted-foreground mb-1 font-medium">{label}</p>
      <pre className={cn(RAW_BLOCK, "max-h-64")}>{text}</pre>
    </div>
  );
}

export function DebugSection({ debug }: { debug: DebugPayload }) {
  const search = debug.search;
  const chunks = debug.chunks ?? [];
  const prompt = debug.prompt;
  const settings = debug.settings;

  return (
    <Card className="mt-1 overflow-hidden text-sm">
      <CardHeader className="gap-2">
        <Bug
          aria-hidden="true"
          className="text-muted-foreground size-4"
        />
        <CardTitle>Debug</CardTitle>
      </CardHeader>

      <div className="divide-border divide-y">
        {search && (
          <DebugRow label="Search query (AI Search)">
            {search.rewritten_query && (
              <p className="text-foreground mb-2 font-medium break-words">
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

        <DebugRow label={`Retrieved chunks (${chunks.length})`}>
          {chunks.length === 0 ? (
            <span className="text-muted-foreground">No chunks retrieved.</span>
          ) : (
            <div className="divide-border divide-y">
              {chunks.map((c, i) => (
                <div
                  key={i}
                  className="py-3 first:pt-0 last:pb-0"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-foreground font-medium">
                      Chunk {c.chunk_number ?? i + 1}
                      {c.title ? `: ${c.title}` : ""}
                    </span>
                    {typeof c.score === "number" && (
                      <span className="text-muted-foreground shrink-0">
                        score {c.score.toFixed(4)}
                      </span>
                    )}
                  </div>
                  {c.source_url && (
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground decoration-signal/60 hover:decoration-signal mb-1 block truncate underline underline-offset-4"
                    >
                      {c.source_url}
                    </a>
                  )}
                  {c.content && (
                    <pre className={cn(RAW_BLOCK, "mb-1 max-h-48")}>
                      {c.content}
                    </pre>
                  )}
                  {c.metadata && Object.keys(c.metadata).length > 0 && (
                    <pre className="text-muted-foreground max-h-40 overflow-auto text-xs break-words whitespace-pre-wrap">
                      {JSON.stringify(c.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </DebugRow>

        {prompt && (
          <DebugRow label="Full LLM prompt">
            {prompt.messages && prompt.messages.length > 0 ? (
              prompt.messages.map((m, i) => (
                <TextBlock
                  key={i}
                  label={capitalize(m.role || "message")}
                  text={m.content}
                />
              ))
            ) : (
              <>
                <TextBlock
                  label="System"
                  text={prompt.system}
                />
                <TextBlock
                  label="User"
                  text={prompt.user}
                />
                <TextBlock
                  label="Grounding"
                  text={prompt.grounding}
                />
                {isEmptyValue(prompt.system) &&
                  isEmptyValue(prompt.user) &&
                  isEmptyValue(prompt.grounding) && (
                    <span className="text-muted-foreground">
                      No prompt details available.
                    </span>
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
    </Card>
  );
}
