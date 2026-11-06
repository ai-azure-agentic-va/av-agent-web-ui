import {
  ChangeEvent,
  KeyboardEvent,
  RefObject,
  useEffect,
  useId,
  useState,
} from "react";
import { ScrollText, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardHeader, CardTitle, cardVariants } from "@/components/ui/card";
import { type UserSkill, skillHandle, useUserSkills } from "@/lib/user-skills";
import {
  findMention,
  insertMentionTrigger,
  matchSkills,
  removeMention,
} from "./mention";

const optionId = (listId: string, index: number) => `${listId}-option-${index}`;

/**
 * Typing "@" in the composer: follows the caret, lists the skills matching
 * the tag it sits on, and on a pick takes the tag out of the message and
 * hands the skill to the composer as its chip. One skill per message, so a
 * second pick replaces the first.
 */
export function useSkillMention({
  value,
  setValue,
  textareaRef,
  onPick,
}: {
  value: string;
  setValue: (value: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onPick: (skill: UserSkill) => void;
}) {
  const skills = useUserSkills();
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  // Escape closes the list for this tag only; a new tag opens it again.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // The highlighted option, reset whenever the tag changes.
  const [active, setActiveState] = useState({ key: "", index: 0 });

  const mention =
    caret === null ? null : findMention(value, Math.min(caret, value.length));
  const options = mention ? matchSkills(skills, mention.query) : [];
  const open =
    focused && !!mention && mention.start !== dismissedAt && options.length > 0;
  const key = mention ? `${mention.start}:${mention.query}` : "";
  const activeIndex =
    active.key === key ? Math.min(active.index, options.length - 1) : 0;
  const setActive = (index: number) => setActiveState({ key, index });

  const track = (el: HTMLTextAreaElement) => {
    const at = el.selectionStart === el.selectionEnd ? el.selectionEnd : null;
    setCaret(at);
    // Typing and caret moves only happen in a focused field. Counting them as
    // focus covers a field focused before hydration, which never sends one.
    setFocused(true);
    if (at === null || !findMention(el.value, at)) setDismissedAt(null);
  };

  const focusAt = (position: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef?.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(position, position);
    });
  };

  const pick = (skill: UserSkill) => {
    if (!mention) return;
    const next = removeMention(value, mention);
    setValue(next.value);
    setCaret(next.caret);
    onPick(skill);
    focusAt(next.caret);
  };

  // The footer button: types the @ for the person, where they left the caret.
  const start = () => {
    const at = Math.min(caret ?? value.length, value.length);
    const next = insertMentionTrigger(value, at);
    setValue(next.value);
    setCaret(next.caret);
    setDismissedAt(null);
    focusAt(next.caret);
  };

  /** Handles the list's keys; returns true when the key was used. */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !mention || e.nativeEvent.isComposing) return false;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((activeIndex + 1) % options.length);
        return true;
      case "ArrowUp":
        e.preventDefault();
        setActive((activeIndex - 1 + options.length) % options.length);
        return true;
      case "Enter":
      case "Tab":
        if (e.shiftKey) return false;
        e.preventDefault();
        pick(options[activeIndex]);
        return true;
      case "Escape":
        e.preventDefault();
        setDismissedAt(mention.start);
        return true;
      default:
        return false;
    }
  };

  return {
    hasSkills: skills.length > 0,
    open,
    options,
    activeIndex,
    listId,
    setActive,
    pick,
    start,
    handleKeyDown,
    handleChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      track(e.target);
    },
    textareaProps: {
      onSelect: (e: { currentTarget: HTMLTextAreaElement }) =>
        track(e.currentTarget),
      onFocus: (e: { currentTarget: HTMLTextAreaElement }) => {
        setFocused(true);
        track(e.currentTarget);
      },
      onBlur: () => setFocused(false),
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open ? optionId(listId, activeIndex) : undefined,
    },
    // Read out by the composer's live region.
    status: open
      ? `${options.length} ${options.length === 1 ? "skill" : "skills"} found. Use the up and down arrows to choose, then Enter.`
      : "",
  };
}

export type SkillMention = ReturnType<typeof useSkillMention>;

/** The list of matching skills, floating just above the composer. */
export function SkillPicker({ mention }: { mention: SkillMention }) {
  const { open, options, activeIndex, listId, setActive, pick } = mention;

  useEffect(() => {
    if (!open) return;
    document
      .getElementById(optionId(listId, activeIndex))
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, listId, activeIndex]);

  if (!open) return null;
  return (
    <div
      className={cn(
        cardVariants({ tone: "float" }),
        "absolute bottom-full left-0 z-30 mb-2 w-[min(100%,360px)] overflow-hidden",
      )}
    >
      <CardHeader>
        <CardTitle as="p">Use a skill</CardTitle>
      </CardHeader>
      <ul
        id={listId}
        role="listbox"
        aria-label="Skills"
        className="max-h-64 scrollbar-thin overflow-y-auto p-1.5"
      >
        {options.map((skill, i) => {
          const handle = skillHandle(skill.name);
          return (
            <li
              key={skill.id}
              id={optionId(listId, i)}
              role="option"
              aria-selected={i === activeIndex}
              // Keep focus (and the caret) in the composer.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== activeIndex && setActive(i)}
              onClick={() => pick(skill)}
              className={cn(
                "flex cursor-pointer flex-col rounded-md px-3 py-2",
                i === activeIndex && "bg-muted",
              )}
            >
              <span className="truncate text-sm">{skill.name}</span>
              {(handle || skill.description) && (
                <span className="text-muted-foreground truncate text-xs">
                  {[handle && `@${handle}`, skill.description]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The skill this message will be sent with, on the composer. */
export function SkillChip({
  skill,
  onRemove,
}: {
  skill: UserSkill;
  onRemove: () => void;
}) {
  return (
    <span className="border-foreground inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-0.5 pl-3 text-[13px] font-medium">
      <ScrollText
        aria-hidden="true"
        className="size-3.5 shrink-0"
      />
      <span className="truncate">
        <span className="sr-only">Skill: </span>
        {skill.name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove skill ${skill.name}`}
        title="Remove skill"
        className="hover:bg-accent focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

/** The composer footer's way into the picker, for people who don't type @. */
export function SkillPickerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Use a skill"
      title="Use a skill (type @)"
      className="text-foreground hover:bg-accent focus-visible:ring-ring flex h-8 w-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
    >
      <ScrollText className="h-4 w-4" />
    </button>
  );
}
