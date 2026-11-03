import { ToolCall } from "@langchain/core/messages/tool";
import { unknownToPrettyDate } from "../utils";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function ToolCallTable({ toolCall }: { toolCall: ToolCall }) {
  return (
    <div
      className={cn(cardVariants(), "max-w-full min-w-[300px] overflow-hidden")}
    >
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th
              className="bg-muted px-3 py-2 text-left text-[13px] font-semibold"
              colSpan={2}
            >
              {toolCall.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(toolCall.args).map(([key, value]) => {
            let valueStr = "";
            if (["string", "number"].includes(typeof value)) {
              valueStr = value.toString();
            }

            const date = unknownToPrettyDate(value);
            if (date) {
              valueStr = date;
            }

            try {
              valueStr = valueStr || JSON.stringify(value, null);
            } catch {
              // failed to stringify, just assign an empty string
              valueStr = "";
            }

            return (
              <tr
                key={key}
                className="border-t"
              >
                <td className="text-muted-foreground w-1/3 px-3 py-1.5 align-top text-xs font-medium">
                  {key}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs leading-5 break-words">
                  {valueStr}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
