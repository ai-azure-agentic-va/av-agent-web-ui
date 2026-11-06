import { type UserSkill, skillHandle } from "@/lib/user-skills";

/** An "@query" tag in the composer, ending at the caret. */
export type Mention = { start: number; end: number; query: string };

// An @ only starts a tag at the start of the message or after whitespace, so
// an email address or "user@host" never opens the picker.
const MENTION_RE = /(^|\s)@([^\s@]*)$/;

/** The tag the caret sits at the end of, or null. */
export function findMention(value: string, caret: number): Mention | null {
  const match = MENTION_RE.exec(value.slice(0, caret));
  if (!match) return null;
  const query = match[2];
  return { start: caret - query.length - 1, end: caret, query };
}

function rank(skill: UserSkill, q: string): number {
  const name = skill.name.toLowerCase();
  const handle = skillHandle(skill.name);
  if (handle.startsWith(q) || name.startsWith(q)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 1;
  if (handle.includes(q) || name.includes(q)) return 2;
  return -1;
}

/** Skills whose name or tag matches the query, best match first. */
export function matchSkills(
  skills: readonly UserSkill[],
  query: string,
): UserSkill[] {
  const q = query.toLowerCase();
  return skills
    .map((skill) => ({ skill, score: rank(skill, q) }))
    .filter((m) => m.score >= 0)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.skill.name.localeCompare(b.skill.name, undefined, {
          sensitivity: "base",
        }),
    )
    .map((m) => m.skill);
}

/**
 * The message with the tag taken out once its skill is picked, and where the
 * caret goes. The skill rides on the composer as a chip instead, so the tag
 * would only repeat it; a doubled space is closed up.
 */
export function removeMention(
  value: string,
  mention: Mention,
): { value: string; caret: number } {
  const before = value.slice(0, mention.start);
  let after = value.slice(mention.end);
  if (before === "" || /[ \t]$/.test(before))
    after = after.replace(/^[ \t]+/, "");
  return { value: before + after, caret: before.length };
}

/**
 * The message with an @ typed at the caret (with a space before it when it
 * would otherwise join the previous word), and the caret just after it.
 */
export function insertMentionTrigger(
  value: string,
  caret: number,
): { value: string; caret: number } {
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  const lead = before === "" || /\s$/.test(before) ? "@" : " @";
  return { value: before + lead + after, caret: before.length + lead.length };
}
