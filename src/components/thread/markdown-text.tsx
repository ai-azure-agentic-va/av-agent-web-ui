"use client";

import "./markdown-styles.css";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { FC, memo, useState, useEffect, useMemo, ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { SyntaxHighlighter } from "@/components/thread/syntax-highlighter";

import { TooltipIconButton } from "@/components/thread/tooltip-icon-button";
import { cn } from "@/lib/utils";
import {
  rehypeLocalizeTimestamps,
  formatLocalTimestamp,
} from "@/lib/localize-timestamps";

import "katex/dist/katex.min.css";

interface CodeHeaderProps {
  language?: string;
  code: string;
}

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-t-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
      <span className="lowercase [&>span]:text-xs">{language}</span>
      <TooltipIconButton
        tooltip="Copy"
        onClick={onCopy}
      >
        {!isCopied && <CopyIcon />}
        {isCopied && <CheckIcon />}
      </TooltipIconButton>
    </div>
  );
};

/**
 * Renders a UTC timestamp (wrapped by the `rehypeLocalizeTimestamps` plugin)
 * in the viewer's local timezone. The original UTC text is shown on first
 * paint / SSR to stay hydration-safe, then swapped to local time after mount
 * so it always matches the browser's zone. Hovering shows the source UTC value.
 */
const LocalTime: FC<{ dateTime?: string; children?: ReactNode }> = ({
  dateTime,
  children,
}) => {
  const original = String(children ?? "");
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    if (!dateTime) return;
    const parsed = new Date(dateTime);
    if (!Number.isNaN(parsed.getTime())) setLocal(formatLocalTimestamp(parsed));
  }, [dateTime]);

  return (
    <time
      dateTime={dateTime}
      title={local ? `Source: ${original}` : undefined}
      className="underline decoration-dotted decoration-1 underline-offset-2"
    >
      {local ?? original}
    </time>
  );
};

const defaultComponents: any = {
  h1: ({ className, ...props }: { className?: string }) => (
    <h1
      className={cn(
        "mb-8 scroll-m-20 text-4xl font-extrabold tracking-tight last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: { className?: string }) => (
    <h2
      className={cn(
        "mt-8 mb-4 scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: { className?: string }) => (
    <h3
      className={cn(
        "mt-6 mb-4 scroll-m-20 text-2xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: { className?: string }) => (
    <h4
      className={cn(
        "mt-6 mb-4 scroll-m-20 text-xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }: { className?: string }) => (
    <h5
      className={cn(
        "my-4 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }: { className?: string }) => (
    <h6
      className={cn("my-4 font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }: { className?: string }) => (
    <p
      className={cn("mt-5 mb-5 leading-7 first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }: { className?: string }) => (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-primary font-medium underline underline-offset-4",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }: { className?: string }) => (
    <blockquote
      className={cn("border-l-2 pl-6 italic", className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }: { className?: string }) => (
    <ul
      className={cn("my-5 ml-6 list-disc [&>li]:mt-2", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }: { className?: string }) => (
    <ol
      className={cn("my-5 ml-6 list-decimal [&>li]:mt-2", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }: { className?: string }) => (
    <hr
      className={cn("my-5 border-b", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }: { className?: string }) => (
    <table
      className={cn(
        "my-5 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }: { className?: string }) => (
    <th
      className={cn(
        "bg-muted px-4 py-2 text-left font-bold first:rounded-tl-lg last:rounded-tr-lg [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: { className?: string }) => (
    <td
      className={cn(
        "border-b border-l px-4 py-2 text-left last:border-r [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }: { className?: string }) => (
    <tr
      className={cn(
        "m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...props}
    />
  ),
  sup: ({ className, ...props }: { className?: string }) => (
    <sup
      className={cn("[&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  time: LocalTime,
  pre: ({ className, ...props }: { className?: string }) => (
    <pre
      className={cn(
        "max-w-4xl overflow-x-auto rounded-lg bg-black text-white",
        className,
      )}
      {...props}
    />
  ),
  code: ({
    className,
    children,
    ...props
  }: {
    className?: string;
    children: React.ReactNode;
  }) => {
    const match = /language-(\w+)/.exec(className || "");

    if (match) {
      const language = match[1];
      const code = String(children).replace(/\n$/, "");

      return (
        <>
          <CodeHeader
            language={language}
            code={code}
          />
          <SyntaxHighlighter
            language={language}
            className={className}
          >
            {code}
          </SyntaxHighlighter>
        </>
      );
    }

    return (
      <code
        className={cn("rounded font-semibold", className)}
        {...props}
      >
        {children}
      </code>
    );
  },
};

const MarkdownTextImpl: FC<{ children: string }> = ({ children }) => {
  const blocks = useMemo(() => splitMarkdownBlocks(children), [children]);
  return (
    <div className="markdown-content">
      {blocks.map((block, i) => (
        // Index keys are stable here: blocks only append (or the tail grows)
        // while an answer streams, so earlier entries keep their key/content.
        <MarkdownBlock
          key={i}
          content={block}
        />
      ))}
    </div>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

// ---------------------------------------------------------------------------
// Block-level memoization for streaming markdown
// ---------------------------------------------------------------------------
// Re-parsing the WHOLE answer through remark/rehype on every streamed update is
// O(n) per token — O(n²) over a stream — which makes long answers stutter. The
// source is instead split into stable top-level blocks (blank-line separated,
// fence-aware) and each block renders as its own memoized <ReactMarkdown>:
// while streaming only the growing tail block re-parses, and settled messages
// parse each block exactly once. react-markdown emits its elements without a
// wrapper node, so the flattened DOM under `.markdown-content` is identical to
// single-pass rendering (first:/last: margin selectors keep working).

// Plugin arrays are hoisted so every block render passes identical references.
// The math pipeline (remark-math + KaTeX) is only included when a block can
// actually contain math — most blocks have no `$` and skip that cost entirely.
const BASE_REMARK_PLUGINS = [remarkGfm];
const MATH_REMARK_PLUGINS = [remarkGfm, remarkMath];
const BASE_REHYPE_PLUGINS = [rehypeLocalizeTimestamps];
const MATH_REHYPE_PLUGINS = [rehypeKatex, rehypeLocalizeTimestamps];

const MarkdownBlock = memo(function MarkdownBlock({
  content,
}: {
  content: string;
}) {
  const hasMath = content.includes("$");
  return (
    <ReactMarkdown
      remarkPlugins={hasMath ? MATH_REMARK_PLUGINS : BASE_REMARK_PLUGINS}
      rehypePlugins={hasMath ? MATH_REHYPE_PLUGINS : BASE_REHYPE_PLUGINS}
      components={defaultComponents}
    >
      {content}
    </ReactMarkdown>
  );
});

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const INDENT_CONTINUATION_RE = /^\s{2,}\S/;

/**
 * Split markdown into independently renderable blocks. Correctness rule: a
 * MERGE never changes CommonMark output (the joined text parses the same as it
 * did in the full document) but a bad SPLIT can — so splitting is conservative:
 *
 *  • split only at blank lines OUTSIDE fenced code (``` / ~~~) and `$$` math,
 *    where both stay part of one raw block until closed (an unclosed fence at
 *    the stream tail keeps the remainder as one block — same semantics as the
 *    full-document parse);
 *  • re-merge continuation blocks — a chunk starting with a list marker whose
 *    predecessor ends list-ish (loose lists keep their <p> wrapping and ordered
 *    numbering), or a chunk starting indented (lazy continuations, indented
 *    code) — so those constructs render exactly as before.
 */
function splitMarkdownBlocks(source: string): string[] {
  const rawBlocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceChar = "";
  let inMath = false;

  for (const line of source.split("\n")) {
    if (inFence) {
      current.push(line);
      const fence = line.match(FENCE_RE);
      if (fence && fence[1][0] === fenceChar) inFence = false;
      continue;
    }
    if (inMath) {
      current.push(line);
      if ((line.match(/\$\$/g)?.length ?? 0) % 2 === 1) inMath = false;
      continue;
    }
    const fence = line.match(FENCE_RE);
    if (fence) {
      inFence = true;
      fenceChar = fence[1][0];
      current.push(line);
      continue;
    }
    if (line.trim() === "") {
      if (current.length) {
        rawBlocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
    // An odd number of `$$` on a line opens (block) math that may span blank
    // lines until the closing `$$`. False positives (a lone literal "$$") only
    // merge blocks — which is always safe — never corrupt output.
    if ((line.match(/\$\$/g)?.length ?? 0) % 2 === 1) inMath = true;
  }
  if (current.length) rawBlocks.push(current.join("\n"));

  const blocks: string[] = [];
  for (const block of rawBlocks) {
    const prev = blocks[blocks.length - 1];
    let mergeWithPrev = false;
    if (prev !== undefined) {
      if (INDENT_CONTINUATION_RE.test(block)) {
        mergeWithPrev = true;
      } else if (LIST_ITEM_RE.test(block)) {
        const prevLastLine = prev.slice(prev.lastIndexOf("\n") + 1);
        mergeWithPrev =
          LIST_ITEM_RE.test(prevLastLine) ||
          INDENT_CONTINUATION_RE.test(prevLastLine);
      }
    }
    if (mergeWithPrev) {
      blocks[blocks.length - 1] = `${prev}\n\n${block}`;
    } else {
      blocks.push(block);
    }
  }
  return blocks;
}
