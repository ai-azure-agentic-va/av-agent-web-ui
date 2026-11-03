import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function isComplexValue(value: any): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function isUrl(value: any): boolean {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return value.startsWith("http://") || value.startsWith("https://");
  } catch {
    return false;
  }
}

function renderInterruptStateItem(value: any): React.ReactNode {
  if (isComplexValue(value)) {
    return (
      <code className="bg-muted rounded-[2px] px-1.5 py-0.5 font-mono text-xs leading-5 whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </code>
    );
  } else if (isUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground decoration-signal/60 hover:decoration-signal break-all underline underline-offset-4"
      >
        {value}
      </a>
    );
  } else {
    return String(value);
  }
}

export function GenericInterruptView({
  interrupt,
}: {
  interrupt: Record<string, any> | Record<string, any>[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const contentStr = JSON.stringify(interrupt, null, 2);
  const contentLines = contentStr.split("\n");
  const shouldTruncate = contentLines.length > 4 || contentStr.length > 500;

  // Function to truncate long string values (but preserve URLs)
  const truncateValue = (value: any): any => {
    if (typeof value === "string" && value.length > 100) {
      // Don't truncate URLs so they remain clickable
      if (isUrl(value)) {
        return value;
      }
      return value.substring(0, 100) + "...";
    }

    if (Array.isArray(value) && !isExpanded) {
      return value.slice(0, 2).map(truncateValue);
    }

    if (isComplexValue(value) && !isExpanded) {
      const strValue = JSON.stringify(value, null, 2);
      if (strValue.length > 100) {
        // Return plain text for truncated content instead of a JSON object
        return `Truncated ${strValue.length} characters...`;
      }
    }

    return value;
  };

  // Process entries based on expanded state
  const processEntries = () => {
    if (Array.isArray(interrupt)) {
      return isExpanded ? interrupt : interrupt.slice(0, 5);
    } else {
      const entries = Object.entries(interrupt);
      if (!isExpanded && shouldTruncate) {
        // When collapsed, process each value to potentially truncate it
        return entries.map(([key, value]) => [key, truncateValue(value)]);
      }
      return entries;
    }
  };

  const displayEntries = processEntries();

  return (
    // Black outline: the agent is waiting on the person.
    <Card
      tone="attention"
      className="overflow-hidden"
    >
      <CardHeader>
        <CardTitle>Human interrupt</CardTitle>
      </CardHeader>
      <motion.div
        className="min-w-full"
        initial={false}
        animate={{ height: "auto" }}
        transition={{ duration: 0.3 }}
      >
        <div className="py-1">
          <AnimatePresence
            mode="wait"
            initial={false}
          >
            <motion.div
              key={isExpanded ? "expanded" : "collapsed"}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
              style={{
                maxHeight: isExpanded ? "none" : "500px",
                overflow: "auto",
              }}
            >
              <table className="divide-border min-w-full divide-y">
                <tbody className="divide-border divide-y">
                  {displayEntries.map((item, argIdx) => {
                    const [key, value] = Array.isArray(interrupt)
                      ? [argIdx.toString(), item]
                      : (item as [string, any]);
                    return (
                      <tr key={argIdx}>
                        <td className="text-foreground py-2.5 pr-4 pl-4 align-top text-sm font-medium whitespace-nowrap">
                          {key}
                        </td>
                        <td className="text-muted-foreground py-2.5 pr-4 text-sm">
                          {renderInterruptStateItem(value)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </motion.div>
          </AnimatePresence>
        </div>
        {(shouldTruncate ||
          (Array.isArray(interrupt) && interrupt.length > 5)) && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 border-t text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
          >
            {isExpanded ? "Show less" : "Show more"}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 transition-transform",
                isExpanded && "rotate-180",
              )}
            />
          </button>
        )}
      </motion.div>
    </Card>
  );
}
