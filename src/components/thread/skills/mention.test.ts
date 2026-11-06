import { describe, expect, it } from "vitest";
import type { UserSkill } from "@/lib/user-skills";
import {
  findMention,
  insertMentionTrigger,
  matchSkills,
  removeMention,
} from "./mention";

function skill(name: string): UserSkill {
  return {
    id: name,
    name,
    description: "",
    instructions: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

describe("findMention", () => {
  it("finds a bare @ at the start of the message", () => {
    expect(findMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("finds the tag the caret is at the end of, after a space", () => {
    const value = "Write up @cus";
    expect(findMention(value, value.length)).toEqual({
      start: 9,
      end: 13,
      query: "cus",
    });
  });

  it("finds a tag after a line break", () => {
    expect(findMention("Line one\n@run", 13)?.query).toBe("run");
  });

  it("reads only up to the caret, so a tag mid-message still counts", () => {
    expect(findMention("@cus and more", 4)?.query).toBe("cus");
  });

  it("ignores an @ inside a word, like an email address", () => {
    const value = "mail jdoe@example";
    expect(findMention(value, value.length)).toBeNull();
  });

  it("closes once the tag is followed by a space", () => {
    expect(findMention("@cus ", 5)).toBeNull();
  });
});

describe("matchSkills", () => {
  const skills = [
    skill("Incident triage"),
    skill("Customer update"),
    skill("Bridge call notes"),
    skill("Update the runbook"),
  ];

  it("lists every skill by name for a bare @", () => {
    expect(matchSkills(skills, "").map((s) => s.name)).toEqual([
      "Bridge call notes",
      "Customer update",
      "Incident triage",
      "Update the runbook",
    ]);
  });

  it("puts a name or tag that starts with the query first, then a word that does", () => {
    expect(matchSkills(skills, "up").map((s) => s.name)).toEqual([
      "Update the runbook",
      "Customer update",
    ]);
  });

  it("matches the hyphenated tag and anywhere in the name", () => {
    expect(matchSkills(skills, "customer-up").map((s) => s.name)).toEqual([
      "Customer update",
    ]);
    expect(matchSkills(skills, "iag").map((s) => s.name)).toEqual([
      "Incident triage",
    ]);
  });

  it("is case-insensitive and returns nothing for no match", () => {
    expect(matchSkills(skills, "BRIDGE").map((s) => s.name)).toEqual([
      "Bridge call notes",
    ]);
    expect(matchSkills(skills, "zzz")).toEqual([]);
  });
});

describe("removeMention", () => {
  it("takes the tag out and closes up the doubled space", () => {
    const value = "Write up @cus INC0001234";
    const mention = findMention(value, 13)!;
    expect(removeMention(value, mention)).toEqual({
      value: "Write up INC0001234",
      caret: 9,
    });
  });

  it("leaves no leading space when the tag opened the message", () => {
    const value = "@cus write it up";
    expect(removeMention(value, findMention(value, 4)!)).toEqual({
      value: "write it up",
      caret: 0,
    });
  });

  it("keeps a line break before the tag", () => {
    const value = "Line one\n@cus";
    expect(removeMention(value, findMention(value, 13)!)).toEqual({
      value: "Line one\n",
      caret: 9,
    });
  });
});

describe("insertMentionTrigger", () => {
  it("types an @ into an empty message", () => {
    expect(insertMentionTrigger("", 0)).toEqual({ value: "@", caret: 1 });
  });

  it("adds a space first when the @ would join the word before it", () => {
    expect(insertMentionTrigger("hello", 5)).toEqual({
      value: "hello @",
      caret: 7,
    });
    expect(insertMentionTrigger("ab", 1)).toEqual({ value: "a @b", caret: 3 });
  });

  it("doesn't double a space that is already there", () => {
    expect(insertMentionTrigger("hello ", 6)).toEqual({
      value: "hello @",
      caret: 7,
    });
  });
});
