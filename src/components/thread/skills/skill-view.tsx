import { FormEvent, KeyboardEvent, ReactNode, useRef, useState } from "react";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SKILL_DESCRIPTION_MAX,
  SKILL_INSTRUCTIONS_MAX,
  SKILL_NAME_MAX,
  type UserSkill,
  createSkill,
  deleteSkill,
  findNameClash,
  restoreSkill,
  skillHandle,
  updateSkill,
  useUserSkills,
} from "@/lib/user-skills";
import { APP_NAME } from "@/lib/app-config";
import { MarkdownText } from "../markdown-text";
import { NEW_SKILL, useOpenSkill } from "./state";

// A skill reads like an answer: the name as the page's headline, the
// instructions as answer copy in the same 780px column.
const HEADLINE =
  "text-foreground text-[32px] leading-[1.15] font-semibold tracking-[-0.025em] text-balance break-words sm:text-[40px]";
const KICKER = "text-muted-foreground text-[13px] font-medium";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STORAGE_BLOCKED = {
  description:
    "This browser isn't letting the app store data. Check that site data is allowed, then try again.",
};

/**
 * The skill named in `?skill=`, in the reading column where the conversation
 * otherwise sits: the skill itself, the form to write or edit one, or a note
 * that it isn't in this browser.
 */
export function SkillView({ onUse }: { onUse: (id: string) => void }) {
  const skills = useUserSkills();
  const [openSkill, setOpenSkill] = useOpenSkill();
  if (!openSkill) return null;
  const close = () => void setOpenSkill(null);

  let body: ReactNode;
  if (openSkill === NEW_SKILL) {
    body = (
      <SkillEditor
        key={NEW_SKILL}
        onSaved={(s) => void setOpenSkill(s.id)}
        onCancel={close}
      />
    );
  } else {
    const skill = skills.find((s) => s.id === openSkill);
    body = skill ? (
      <SkillSheet
        key={skill.id}
        skill={skill}
        onUse={onUse}
        onDeleted={close}
      />
    ) : (
      <SkillMissing onClose={close} />
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute inset-0 scrollbar-thin overflow-y-auto px-4">
        <div className="mx-auto w-full max-w-[780px] pt-10 pb-24">{body}</div>
      </div>
    </div>
  );
}

function SkillSheet({
  skill,
  onUse,
  onDeleted,
}: {
  skill: UserSkill;
  onUse: (id: string) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const handle = skillHandle(skill.name);

  // Leaving the form puts focus back on the button that opened it.
  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  if (editing) {
    return (
      <SkillEditor
        skill={skill}
        onSaved={closeEditor}
        onCancel={closeEditor}
      />
    );
  }

  const remove = () => {
    let removed: UserSkill | undefined;
    try {
      removed = deleteSkill(skill.id);
    } catch {
      toast.error("Couldn't delete the skill", STORAGE_BLOCKED);
      return;
    }
    if (!removed) return;
    const restore = removed;
    onDeleted();
    toast("Skill deleted", {
      description: restore.name,
      // Long enough to reach the button; hovering the toast also holds it.
      duration: 10_000,
      action: { label: "Undo", onClick: () => restoreSkill(restore) },
    });
  };

  return (
    <article className="flex flex-col">
      <p className={KICKER}>
        Your skill · Updated {formatDate(skill.updatedAt)}
      </p>
      <h1 className={cn(HEADLINE, "mt-2")}>{skill.name}</h1>
      {handle && (
        <p className="text-muted-foreground mt-1.5 text-[13px]">@{handle}</p>
      )}
      {skill.description && (
        <p className="mt-4 max-w-[62ch] text-[17px] leading-[29px] font-light">
          {skill.description}
        </p>
      )}

      <div className="mt-6 mb-7 flex flex-wrap gap-2">
        <Button
          className="group/use"
          onClick={() => onUse(skill.id)}
        >
          Use in chat
          <ArrowRight
            aria-hidden="true"
            className="transition-transform group-hover/use:translate-x-0.5"
          />
        </Button>
        <Button
          ref={editButtonRef}
          variant="outline"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <Button
          variant="ghost"
          onClick={remove}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>

      <div className="border-border border-t" />
      <div className="mt-5 mb-2.5 flex items-baseline justify-between gap-4">
        <h2 className={KICKER}>Instructions {APP_NAME} follows</h2>
        <span className="text-muted-foreground text-xs">
          {skill.instructions.length.toLocaleString()} characters
        </span>
      </div>
      <MarkdownText>{skill.instructions}</MarkdownText>

      <p
        className={cn(
          cardVariants(),
          "text-muted-foreground mt-6 px-4 py-3.5 text-sm",
        )}
      >
        <span className="text-foreground font-medium">How it works.</span> Use
        in chat adds this skill to your next message. {APP_NAME} follows these
        instructions for that answer only.
      </p>
    </article>
  );
}

function Field({
  id,
  label,
  message,
  invalid,
  aside,
  children,
}: {
  id: string;
  label: ReactNode;
  // The hint, or the error when the field is invalid.
  message?: ReactNode;
  invalid?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-foreground text-[13px] font-medium"
      >
        {label}
      </label>
      {children}
      {(message || aside) && (
        <div className="flex items-baseline justify-between gap-4">
          {message ? (
            <p
              id={`${id}-msg`}
              className={cn(
                "text-[13px]",
                invalid ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {message}
            </p>
          ) : (
            <span />
          )}
          {aside}
        </div>
      )}
    </div>
  );
}

function SkillEditor({
  skill,
  onSaved,
  onCancel,
}: {
  skill?: UserSkill;
  onSaved: (skill: UserSkill) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  // Empty-field errors wait for the first save; a name clash shows at once.
  const [submitted, setSubmitted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  // Fixed ids, not useId: the form is server-rendered for ?skill=new, and
  // only one is ever on the page.
  const ids = {
    name: "skill-name",
    description: "skill-description",
    instructions: "skill-instructions",
  };

  const handle = skillHandle(name);
  const clash = name.trim() ? findNameClash(name, skill?.id) : undefined;
  const nameError = clash
    ? `You already have a skill called ${clash.name}.`
    : submitted && !name.trim()
      ? "Give the skill a name."
      : null;
  const instructionsError =
    submitted && !instructions.trim()
      ? `Write the instructions ${APP_NAME} should follow.`
      : null;

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    setSubmitted(true);
    if (clash || !name.trim()) {
      nameRef.current?.focus();
      return;
    }
    if (!instructions.trim()) {
      instructionsRef.current?.focus();
      return;
    }
    const draft = { name, description, instructions };
    let saved: UserSkill;
    try {
      saved = skill ? updateSkill(skill.id, draft) : createSkill(draft);
    } catch {
      toast.error("Couldn't save the skill", STORAGE_BLOCKED);
      return;
    }
    onSaved(saved);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  return (
    <form
      onSubmit={save}
      onKeyDown={handleKeyDown}
      noValidate
      className="flex flex-col"
    >
      <p className={KICKER}>
        {skill ? `Editing · ${skill.name}` : "Your skills"}
      </p>
      <h1 className={cn(HEADLINE, "mt-2")}>
        {skill ? "Edit skill" : "New skill"}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-[62ch] text-[15px] leading-6">
        Brief {APP_NAME} the way you would brief a colleague: what to look at,
        what to include and how to lay out the answer.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        <Field
          id={ids.name}
          label="Name"
          invalid={!!nameError}
          message={nameError ?? (handle ? `Tagged as @${handle}` : undefined)}
        >
          <Input
            ref={nameRef}
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={SKILL_NAME_MAX}
            autoComplete="off"
            autoFocus
            placeholder="For example, Customer update"
            aria-invalid={!!nameError || undefined}
            aria-describedby={
              nameError || handle ? `${ids.name}-msg` : undefined
            }
          />
        </Field>

        <Field
          id={ids.description}
          label="What it does"
          message="Optional. One line, shown under the name."
        >
          <Input
            id={ids.description}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={SKILL_DESCRIPTION_MAX}
            autoComplete="off"
            placeholder="For example, where a ticket stands, written for the customer"
            aria-describedby={`${ids.description}-msg`}
          />
        </Field>

        <Field
          id={ids.instructions}
          label={`Instructions ${APP_NAME} follows`}
          invalid={!!instructionsError}
          message={
            instructionsError ??
            "Sent with your message when you use the skill. Markdown works."
          }
          aside={
            <span className="text-muted-foreground shrink-0 text-xs">
              {instructions.length.toLocaleString()} /{" "}
              {SKILL_INSTRUCTIONS_MAX.toLocaleString()}
            </span>
          }
        >
          <Textarea
            ref={instructionsRef}
            id={ids.instructions}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={SKILL_INSTRUCTIONS_MAX}
            placeholder={
              "For example:\n1. Open the ticket and its latest work notes.\n2. Say what has been done and what happens next, in plain words.\n3. End with when the customer will hear from us again."
            }
            aria-invalid={!!instructionsError || undefined}
            aria-describedby={`${ids.instructions}-msg`}
            className="max-h-[60vh] min-h-[280px] resize-y scrollbar-thin text-[15px] leading-6"
          />
        </Field>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <Button type="submit">Save skill</Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SkillMissing({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className={HEADLINE}>This skill isn&apos;t here</h1>
      <p className="text-muted-foreground max-w-[62ch] text-[15px] leading-6">
        It may have been deleted. Skills stay in the browser they were written
        in, so one saved on another computer won&apos;t show up here.
      </p>
      <Button
        variant="outline"
        className="mt-2"
        onClick={onClose}
      >
        Back to chat
      </Button>
    </div>
  );
}
