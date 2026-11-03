import { useStreamContext } from "@/providers/Stream";
import { Message } from "@langchain/langgraph-sdk";
import { useState } from "react";
import { getContentString } from "../utils";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { BranchSwitcher, CommandBar } from "./shared";
import { MultimodalPreview } from "@/components/thread/MultimodalPreview";
import { isBase64ContentBlock } from "@/lib/multimodal-utils";
import { HumanMark } from "../speaker";
import { TURN_GUTTER } from "../turn-chain";

// A question short enough to read at a glance is set as the turn's headline;
// pasted logs and multi-paragraph questions stay at reading size.
const HEADLINE_MAX_CHARS = 180;

function EditableContent({
  value,
  setValue,
  onSubmit,
}: {
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      aria-label="Edit message"
      autoFocus
      className="min-h-[96px] resize-none text-base"
    />
  );
}

export function HumanMessage({
  message,
  isLoading,
  hasReply = false,
}: {
  message: Message;
  isLoading: boolean;
  // An answer (or the live chain) follows, so the rail runs on down to it.
  hasReply?: boolean;
}) {
  const thread = useStreamContext();
  const meta = thread.getMessagesMetadata(message);
  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;

  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const contentString = getContentString(message.content);
  const isHeadline =
    contentString.length <= HEADLINE_MAX_CHARS && !contentString.includes("\n");

  const handleSubmitEdit = () => {
    setIsEditing(false);

    // Editing only rewrites the text; carry the original attachments over so
    // the re-run still sees them.
    const attachments = Array.isArray(message.content)
      ? message.content.filter(isBase64ContentBlock)
      : [];
    const newMessage: Message = {
      type: "human",
      content:
        attachments.length > 0
          ? ([
              ...(value.trim() ? [{ type: "text", text: value }] : []),
              ...attachments,
            ] as Message["content"])
          : value,
    };
    thread.submit(
      { messages: [newMessage] },
      {
        checkpoint: parentCheckpoint,
        // streamMode is intentionally omitted (the SDK unions the modes it
        // already tracks; forcing ["values"] would add full-state snapshots per
        // super-step). streamResumable comes from the provider's
        // reconnectOnMount default.
        streamSubgraphs: true,
        optimisticValues: (prev) => {
          const values = meta?.firstSeenState?.values;
          if (!values) return prev;

          return {
            ...values,
            messages: [...(values.messages ?? []), newMessage],
          };
        },
      },
    );
  };

  const actions = (
    <div
      className={cn(
        "text-foreground -ml-1.5 flex items-center gap-2 transition-opacity",
        "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        // No hover on touch screens: keep the actions reachable there. On
        // narrow screens they hold their own row under the question, so show
        // them rather than leave a blank row beside the rail.
        "max-sm:opacity-100 [@media(hover:none)]:opacity-100",
        // On wide screens the hover actions sit beside the headline instead of
        // holding open a blank row under it.
        !isEditing &&
          "sm:absolute sm:top-0 sm:right-0 sm:ml-0 [@media(hover:none)]:static",
        isEditing && "opacity-100",
      )}
    >
      <BranchSwitcher
        branch={meta?.branch}
        branchOptions={meta?.branchOptions}
        onSelect={(branch) => thread.setBranch(branch)}
        isLoading={isLoading}
      />
      <CommandBar
        isLoading={isLoading}
        content={contentString}
        isEditing={isEditing}
        setIsEditing={(c) => {
          if (c) {
            setValue(contentString);
          }
          setIsEditing(c);
        }}
        handleSubmitEdit={handleSubmitEdit}
        isHumanMessage={true}
      />
    </div>
  );

  return (
    <div
      className={cn(
        // Each question opens a new turn: a hairline and air above it, except
        // for the first one in the thread.
        "message-animate group not-first:border-border flex w-full flex-col gap-2 not-first:mt-4 not-first:border-t not-first:pt-10",
      )}
    >
      <div className={cn("relative flex flex-col gap-2", TURN_GUTTER)}>
        {/* The person's mark opens the turn; the rail leaves it for the
            answer, through the 24px gap between messages. */}
        <HumanMark className="absolute top-px left-0" />
        {hasReply && (
          <span
            aria-hidden="true"
            className="bg-rail absolute top-[33px] -bottom-6 left-[13px] w-0.5"
          />
        )}
        {isEditing ? (
          <>
            <EditableContent
              value={value}
              setValue={setValue}
              onSubmit={handleSubmitEdit}
            />
            {actions}
          </>
        ) : (
          <div className="relative flex flex-col gap-3 sm:pr-28">
            {/* Render images and files */}
            {Array.isArray(message.content) &&
              message.content.some(isBase64ContentBlock) && (
                <div className="flex flex-wrap items-end gap-2">
                  {message.content.reduce<React.ReactNode[]>(
                    (acc, block, idx) => {
                      if (isBase64ContentBlock(block)) {
                        acc.push(
                          <MultimodalPreview
                            key={idx}
                            block={block}
                            size="md"
                          />,
                        );
                      }
                      return acc;
                    },
                    [],
                  )}
                </div>
              )}

            {/* Text content */}
            {contentString && (
              <p
                className={cn(
                  "max-w-[62ch] break-words whitespace-pre-wrap",
                  isHeadline
                    ? "text-[22px] leading-[30px] font-semibold tracking-[-0.015em] text-balance"
                    : "text-[17px] leading-7 font-medium",
                )}
              >
                <span className="sr-only">You: </span>
                {contentString}
              </p>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
