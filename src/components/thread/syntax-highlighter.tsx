import { PrismAsyncLight as SyntaxHighlighterPrism } from "react-syntax-highlighter";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import { coldarkDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { FC } from "react";

// coldark's diff-deletion red sits on the --foreground code block; it is the
// one token colour that needs a per-system value to hold 4.5:1 (see
// --code-deleted). Inline styles accept var().
const codeStyle = {
  ...coldarkDark,
  deleted: { ...coldarkDark.deleted, color: "var(--code-deleted)" },
  important: { ...coldarkDark.important, color: "var(--code-deleted)" },
};

// Register languages you want to support
SyntaxHighlighterPrism.registerLanguage("js", tsx);
SyntaxHighlighterPrism.registerLanguage("jsx", tsx);
SyntaxHighlighterPrism.registerLanguage("ts", tsx);
SyntaxHighlighterPrism.registerLanguage("tsx", tsx);
SyntaxHighlighterPrism.registerLanguage("python", python);

interface SyntaxHighlighterProps {
  children: string;
  language: string;
  className?: string;
}

export const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({
  children,
  language,
  className,
}) => {
  return (
    <SyntaxHighlighterPrism
      language={language}
      style={codeStyle}
      customStyle={{
        margin: 0,
        width: "100%",
        background: "transparent",
        padding: "0.75rem 1rem",
      }}
      className={className}
    >
      {children}
    </SyntaxHighlighterPrism>
  );
};
