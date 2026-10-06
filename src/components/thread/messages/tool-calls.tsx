import { AIMessage, ToolMessage } from "@langchain/langgraph-sdk";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle2,
  Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function isComplexValue(value: any): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function ToolCallCard({
  name,
  id,
  args,
  defaultExpanded = false,
}: {
  name: string;
  id?: string;
  args: Record<string, any>;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasArgs = Object.keys(args).length > 0;

  return (
    <div className="overflow-hidden rounded-xl border-2 border-amber-500/30 bg-amber-50/50 shadow-sm transition-all hover:shadow-md hover:border-amber-500/50 dark:bg-amber-950/20 dark:border-amber-500/20 dark:hover:border-amber-500/40">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-amber-100/50 dark:hover:bg-amber-900/20"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
          <Wrench className="h-4 w-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Tool Call
            </span>
          </div>
          <span className="truncate font-medium text-foreground">{name}</span>
          {id && (
            <span className="truncate text-xs text-muted-foreground">
              {id}
            </span>
          )}
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && hasArgs && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-amber-500/20 bg-amber-50/30 px-4 py-3 dark:bg-amber-950/10">
              <div className="space-y-3">
                {Object.entries(args).map(([key, value], idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {key}
                    </span>
                    {isComplexValue(value) ? (
                      <pre className="overflow-x-auto rounded-lg bg-white/80 dark:bg-black/20 p-2.5 text-xs border border-amber-200/50 dark:border-amber-800/30">
                        <code className="text-foreground">
                          {JSON.stringify(value, null, 2)}
                        </code>
                      </pre>
                    ) : (
                      <span className="text-sm text-foreground">
                        {String(value)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ToolCalls({
  toolCalls,
}: {
  toolCalls: AIMessage["tool_calls"];
}) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {toolCalls.map((tc, idx) => (
        <ToolCallCard
          key={idx}
          name={tc.name || "Unknown Tool"}
          id={tc.id}
          args={tc.args as Record<string, any>}
          defaultExpanded={toolCalls.length === 1}
        />
      ))}
    </div>
  );
}

export function ToolResult({ message }: { message: ToolMessage }) {
  const [isExpanded, setIsExpanded] = useState(false);

  let parsedContent: any;
  let isJsonContent = false;

  try {
    if (typeof message.content === "string") {
      parsedContent = JSON.parse(message.content);
      isJsonContent = isComplexValue(parsedContent);
    }
  } catch {
    parsedContent = message.content;
  }

  const contentStr = isJsonContent
    ? JSON.stringify(parsedContent, null, 2)
    : String(message.content);
  const contentLines = contentStr.split("\n");
  const shouldTruncate = contentLines.length > 6 || contentStr.length > 400;
  const displayedContent =
    shouldTruncate && !isExpanded
      ? contentStr.length > 400
        ? contentStr.slice(0, 400) + "..."
        : contentLines.slice(0, 6).join("\n") + "\n..."
      : contentStr;

  return (
    <div className="overflow-hidden rounded-xl border-2 border-emerald-500/30 bg-emerald-50/50 shadow-sm dark:bg-emerald-950/20 dark:border-emerald-500/20">
      <div className="flex items-center gap-3 border-b border-emerald-500/20 bg-emerald-100/50 px-4 py-2.5 dark:bg-emerald-900/20">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Tool Result
          </span>
          <span className="text-sm font-medium text-foreground">
            {message.name || "Completed"}
          </span>
        </div>
      </div>

      <div className="relative">
        <div className="p-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={isExpanded ? "expanded" : "collapsed"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {isJsonContent && !Array.isArray(parsedContent) ? (
                <div className="space-y-3">
                  {Object.entries(
                    isExpanded ? parsedContent : Object.fromEntries(
                      Object.entries(parsedContent).slice(0, 5)
                    )
                  ).map(([key, value], idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {key}
                      </span>
                      {isComplexValue(value) ? (
                        <pre className="overflow-x-auto rounded-lg bg-white/80 dark:bg-black/20 p-2.5 text-xs border border-emerald-200/50 dark:border-emerald-800/30">
                          <code className="text-foreground">
                            {JSON.stringify(value, null, 2)}
                          </code>
                        </pre>
                      ) : (
                        <span className="text-sm text-foreground">
                          {String(value)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : isJsonContent && Array.isArray(parsedContent) ? (
                <div className="space-y-2">
                  {(isExpanded ? parsedContent : parsedContent.slice(0, 3)).map(
                    (item, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg bg-white/80 dark:bg-black/20 p-2.5 text-xs border border-emerald-200/50 dark:border-emerald-800/30"
                      >
                        <pre className="overflow-x-auto">
                          <code className="text-foreground">
                            {JSON.stringify(item, null, 2)}
                          </code>
                        </pre>
                      </div>
                    )
                  )}
                  {!isExpanded && parsedContent.length > 3 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      + {parsedContent.length - 3} more items
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <pre className="flex-1 overflow-x-auto text-sm">
                    <code className="text-foreground">{displayedContent}</code>
                  </pre>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {((shouldTruncate && !isJsonContent) ||
          (isJsonContent &&
            ((Array.isArray(parsedContent) && parsedContent.length > 3) ||
              (!Array.isArray(parsedContent) &&
                Object.keys(parsedContent).length > 5)))) && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 border-t border-emerald-500/20 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 transition-colors hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20"
            )}
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show more
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
