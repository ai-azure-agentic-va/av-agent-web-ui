import { CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepTool } from "@/providers/Stream";

// Argument keys that usually carry the agent's actual ask, in priority order:
// a sub-agent brief, a search query, a question.
const INPUT_KEYS = [
  "description",
  "query",
  "question",
  "prompt",
  "input",
  "search",
  "q",
  "text",
  "url",
  "path",
  "file_path",
];

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function humanKey(key: string): string {
  return key.replace(/[-_]+/g, " ").toLowerCase();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === "string"
          ? c
          : c && typeof c === "object" && typeof c.text === "string"
            ? c.text
            : "",
      )
      .join(" ");
  }
  return content == null ? "" : JSON.stringify(content);
}

/** What the agent asked the tool for, as one plain sentence when there is one. */
export function summarizeToolInput(
  args: Record<string, unknown>,
): string | null {
  for (const key of INPUT_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const first = Object.values(args).find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return first?.trim() ?? null;
}

/** What came back, in one line: a document count, a few fields, or the first line. */
export function summarizeToolResult(result: StepTool["result"]): string | null {
  if (!result) return null;
  const { artifact } = result;
  if (Array.isArray(artifact) && artifact.length > 0) {
    const isDocs = artifact.every(
      (a) =>
        a &&
        typeof a === "object" &&
        ("title" in a || "url" in a || "file_name" in a),
    );
    return plural(artifact.length, isDocs ? "document" : "item");
  }

  const text = textOf(result.content).trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return plural(parsed.length, "item");
    if (parsed && typeof parsed === "object") {
      const fields = Object.entries(parsed).filter(
        ([, v]) =>
          v === null || ["string", "number", "boolean"].includes(typeof v),
      );
      if (fields.length === 1 && typeof fields[0][1] === "number") {
        return `${fields[0][1]} ${humanKey(fields[0][0])}`;
      }
      if (fields.length > 0) {
        return fields
          .slice(0, 3)
          .map(([k, v]) => `${humanKey(k)}: ${String(v)}`)
          .join(" · ");
      }
      return plural(Object.keys(parsed).length, "field");
    }
    return String(parsed);
  } catch {
    // Plain text: fall through to its first line.
  }
  const firstLine = text.split("\n").find((line) => line.trim());
  return firstLine ? firstLine.replace(/\s+/g, " ").trim() : null;
}

function prettyOutput(content: unknown): string {
  const text = textOf(content);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function RawBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <pre
        tabIndex={0}
        aria-label={label}
        className="border-border text-foreground focus-visible:ring-ring max-h-64 scrollbar-thin overflow-auto rounded-[2px] border p-2.5 font-mono text-xs leading-5 break-words whitespace-pre-wrap outline-none focus-visible:ring-2"
      >
        <code>{text}</code>
      </pre>
    </div>
  );
}

/** A tool step's ask in plain words and a one-line result, under its label. */
export function ToolStepSummary({ tool }: { tool: StepTool }) {
  const input = summarizeToolInput(tool.args);
  const result = summarizeToolResult(tool.result);
  const failed = tool.result?.status === "error";
  if (!input && !result) return null;

  return (
    <div className="mt-0.5 flex min-w-0 flex-col gap-0.5 text-[13px] leading-5">
      {input && (
        <p className="text-muted-foreground line-clamp-2 break-words">
          {input}
        </p>
      )}
      {result && (
        <p
          className={cn(
            "flex min-w-0 items-start gap-1.5",
            failed ? "text-destructive-ink" : "text-muted-foreground",
          )}
        >
          <CornerDownRight
            aria-hidden="true"
            className="mt-[3px] size-3.5 shrink-0"
          />
          <span className="min-w-0 truncate">
            {failed && "Failed: "}
            {result}
          </span>
        </p>
      )}
    </div>
  );
}

/** The raw tool input and output, opened from the step's label. */
export function ToolStepRaw({ id, tool }: { id: string; tool: StepTool }) {
  return (
    <div
      id={id}
      className="flex flex-col gap-2 pt-2 pb-1"
    >
      <RawBlock
        label="Input"
        text={JSON.stringify(tool.args, null, 2)}
      />
      {tool.result && (
        <RawBlock
          label="Output"
          text={prettyOutput(tool.result.content)}
        />
      )}
      {/* What the tool returned alongside its message, e.g. the documents a
          search retrieved: the evidence behind a "4 documents" summary. */}
      {tool.result?.artifact != null && (
        <RawBlock
          label={Array.isArray(tool.result.artifact) ? "Documents" : "Artifact"}
          text={JSON.stringify(tool.result.artifact, null, 2)}
        />
      )}
    </div>
  );
}
