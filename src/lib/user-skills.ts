"use client";

import { useSyncExternalStore } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Message } from "@langchain/langgraph-sdk";

/**
 * The person's own skills: named instructions IVY follows for one message
 * when they use the skill in chat.
 *
 * Skills live in this browser's localStorage only. The backend has no store
 * for them and no per-request hook, so each skill in use travels inside the
 * message itself, as one extra text block (see skillContentBlock). The UI
 * hides those blocks wherever it shows the person's text.
 *
 * Mirrored into React via useSyncExternalStore, and kept in step across tabs
 * through the `storage` event.
 */

export type UserSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
};

export type UserSkillDraft = Pick<
  UserSkill,
  "name" | "description" | "instructions"
>;

export const SKILL_NAME_MAX = 60;
export const SKILL_DESCRIPTION_MAX = 200;
export const SKILL_INSTRUCTIONS_MAX = 8000;
// How many skills one message can carry. Each adds up to
// SKILL_INSTRUCTIONS_MAX characters to the message, so keep it small.
export const MAX_SKILLS_PER_MESSAGE = 5;

const STORAGE_KEY = "ivy:skills:v1";

const EMPTY: readonly UserSkill[] = [];
const listeners = new Set<() => void>();

function isUserSkill(v: unknown): v is UserSkill {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.description === "string" &&
    typeof s.instructions === "string" &&
    typeof s.createdAt === "string" &&
    typeof s.updatedAt === "string"
  );
}

function read(): readonly UserSkill[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUserSkill) : EMPTY;
  } catch {
    // Unreadable or blocked storage — treat as no skills rather than crash.
    return EMPTY;
  }
}

// Read lazily on first use, so importing this module never touches storage.
let snapshot: readonly UserSkill[] | null = null;

function notify() {
  for (const listener of listeners) listener();
}

// Throws when the browser refuses the write (quota, storage disabled), so
// the editor can tell the person their skill was not saved.
function write(next: readonly UserSkill[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  snapshot = next;
  notify();
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  snapshot = read();
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): readonly UserSkill[] {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function getServerSnapshot(): readonly UserSkill[] {
  return EMPTY;
}

/** Every skill saved in this browser, in the order they were created. */
export function useUserSkills(): readonly UserSkill[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The same list, read once, for code outside React's render. */
export function getUserSkills(): readonly UserSkill[] {
  return getSnapshot();
}

/**
 * The name as a tag: lower case, ASCII letters and digits joined by hyphens
 * ("Customer update" → "customer-update"). Empty when the name has none.
 */
export function skillHandle(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Another saved skill that this name would be confused with, if any. */
export function findNameClash(
  name: string,
  exceptId?: string,
): UserSkill | undefined {
  const handle = skillHandle(name);
  const plain = name.trim().toLowerCase();
  return getSnapshot().find(
    (s) =>
      s.id !== exceptId &&
      ((handle !== "" && skillHandle(s.name) === handle) ||
        s.name.trim().toLowerCase() === plain),
  );
}

// Instructions over the limit are refused, never cut: what was cut would
// silently stop being part of the skill. The editor says so before saving.
function clean(draft: UserSkillDraft): UserSkillDraft {
  const instructions = draft.instructions.trim();
  if (instructions.length > SKILL_INSTRUCTIONS_MAX) {
    throw new RangeError(
      `Skill instructions are limited to ${SKILL_INSTRUCTIONS_MAX} characters.`,
    );
  }
  return {
    name: draft.name.trim().slice(0, SKILL_NAME_MAX),
    description: draft.description.trim().slice(0, SKILL_DESCRIPTION_MAX),
    instructions,
  };
}

export function createSkill(draft: UserSkillDraft): UserSkill {
  const now = new Date().toISOString();
  const skill: UserSkill = {
    id: uuidv4(),
    ...clean(draft),
    createdAt: now,
    updatedAt: now,
  };
  write([...getSnapshot(), skill]);
  return skill;
}

export function updateSkill(id: string, draft: UserSkillDraft): UserSkill {
  const current = getSnapshot().find((s) => s.id === id);
  if (!current) throw new Error(`No skill with id ${id}`);
  const skill: UserSkill = {
    ...current,
    ...clean(draft),
    updatedAt: new Date().toISOString(),
  };
  write(getSnapshot().map((s) => (s.id === id ? skill : s)));
  return skill;
}

/** Removes the skill and hands it back, so the caller can offer an undo. */
export function deleteSkill(id: string): UserSkill | undefined {
  const skills = getSnapshot();
  const removed = skills.find((s) => s.id === id);
  if (removed) write(skills.filter((s) => s.id !== id));
  return removed;
}

/** Puts a deleted skill back where it was. */
export function restoreSkill(skill: UserSkill): void {
  const skills = getSnapshot();
  if (skills.some((s) => s.id === skill.id)) return;
  const next = [...skills, skill].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  write(next);
}

// ---------------------------------------------------------------------------
// A skill inside a message
// ---------------------------------------------------------------------------
// Each skill rides along as its own text block after the person's words. It
// opens with a tag the UI recognises, so getContentString can leave it out of
// the question headline, the history title, copy and edit.

const SKILL_BLOCK_RE = /^<user_skill name="([^"]*)">/;

type TextBlock = { type: "text"; text: string };

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

export function skillContentBlock(skill: UserSkill): TextBlock {
  return {
    type: "text",
    text: [
      `<user_skill name="${escapeAttr(skill.name)}">`,
      `For this message, use my skill "${skill.name}". These are my own instructions for this kind of task; follow them when you work on my request and compose your answer.`,
      "",
      skill.instructions.trim(),
      "</user_skill>",
    ].join("\n"),
  };
}

/**
 * A typed message's content: the person's words, then the skills they
 * picked, in the order they picked them, then any attachments.
 */
export function buildMessageContent(
  text: string,
  skills: readonly UserSkill[] = [],
  attachments: readonly unknown[] = [],
): Message["content"] {
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...skills.map(skillContentBlock),
    ...attachments,
  ] as Message["content"];
}

export function isSkillBlock(block: unknown): block is TextBlock {
  if (!block || typeof block !== "object") return false;
  const b = block as { type?: unknown; text?: unknown };
  return (
    b.type === "text" &&
    typeof b.text === "string" &&
    SKILL_BLOCK_RE.test(b.text)
  );
}

/** The names of the skills a message was sent with, in order. */
export function getMessageSkillNames(content: Message["content"]): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isSkillBlock).flatMap((block) => {
    const match = SKILL_BLOCK_RE.exec(block.text);
    return match ? [unescapeAttr(match[1])] : [];
  });
}
