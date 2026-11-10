import { act, renderHook } from "@testing-library/react";
import type { Message } from "@langchain/langgraph-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "ivy:skills:v1";

// The store caches its snapshot at module level, so each test gets a fresh
// copy of the module over a fresh localStorage.
async function load() {
  vi.resetModules();
  return import("./user-skills");
}

const draft = {
  name: "Customer update",
  description: "Where the ticket stands, for the customer",
  instructions: "1. Open the ticket.\n2. Say what happens next.",
};

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("skillHandle", () => {
  it("turns a name into a lower-case hyphenated tag", async () => {
    const { skillHandle } = await load();
    expect(skillHandle("Customer update")).toBe("customer-update");
    expect(skillHandle("  VPN / escalation checklist! ")).toBe(
      "vpn-escalation-checklist",
    );
    expect(skillHandle("Café résumé")).toBe("cafe-resume");
    expect(skillHandle("！？")).toBe("");
  });
});

describe("the skills store", () => {
  it("saves a new skill to localStorage and hands it to subscribers", async () => {
    const { createSkill, useUserSkills } = await load();
    const { result } = renderHook(() => useUserSkills());
    expect(result.current).toEqual([]);

    let created!: ReturnType<typeof createSkill>;
    act(() => {
      created = createSkill({ ...draft, name: "  Customer update  " });
    });

    expect(created.name).toBe("Customer update");
    expect(result.current).toEqual([created]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
      created,
    ]);
  });

  it("reads skills saved earlier, and skips entries it can't use", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "a",
          ...draft,
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
        { id: "b", name: "Half a skill" },
      ]),
    );
    const { useUserSkills } = await load();
    const { result } = renderHook(() => useUserSkills());
    expect(result.current.map((s) => s.id)).toEqual(["a"]);
  });

  it("treats unreadable storage as no skills", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    const { useUserSkills } = await load();
    const { result } = renderHook(() => useUserSkills());
    expect(result.current).toEqual([]);
  });

  it("updates a skill in place and moves its Updated date", async () => {
    const { createSkill, updateSkill, useUserSkills } = await load();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    const created = createSkill(draft);
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));
    const updated = updateSkill(created.id, {
      ...draft,
      instructions: "Keep it to three sentences.",
    });
    vi.useRealTimers();

    expect(updated.createdAt).toBe("2026-11-01T10:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-11-02T10:00:00.000Z");
    const { result } = renderHook(() => useUserSkills());
    expect(result.current).toEqual([updated]);
  });

  it("deletes a skill, and puts it back in its place on undo", async () => {
    const { createSkill, deleteSkill, restoreSkill, useUserSkills } =
      await load();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    const first = createSkill(draft);
    vi.setSystemTime(new Date("2026-11-01T11:00:00.000Z"));
    const second = createSkill({ ...draft, name: "Bridge call notes" });
    vi.useRealTimers();

    const removed = deleteSkill(first.id);
    expect(removed).toEqual(first);
    const { result } = renderHook(() => useUserSkills());
    expect(result.current).toEqual([second]);

    act(() => restoreSkill(first));
    expect(result.current).toEqual([first, second]);
  });

  it("throws when the browser refuses the write, and keeps the old list", async () => {
    const { createSkill, useUserSkills } = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() => createSkill(draft)).toThrow();
    const { result } = renderHook(() => useUserSkills());
    expect(result.current).toEqual([]);
  });

  it("refuses instructions over the limit rather than cutting them", async () => {
    const { SKILL_INSTRUCTIONS_MAX, createSkill, updateSkill, useUserSkills } =
      await load();
    const fits = "x".repeat(SKILL_INSTRUCTIONS_MAX);
    const { result } = renderHook(() => useUserSkills());

    expect(() => createSkill({ ...draft, instructions: `${fits}y` })).toThrow(
      RangeError,
    );
    expect(result.current).toEqual([]);

    // Measured as saved, without the space around them.
    let saved!: ReturnType<typeof createSkill>;
    act(() => {
      saved = createSkill({ ...draft, instructions: `\n ${fits} \n` });
    });
    expect(saved.instructions).toBe(fits);

    expect(() =>
      updateSkill(saved.id, { ...draft, instructions: `${fits}y` }),
    ).toThrow(RangeError);
    expect(result.current).toEqual([saved]);
  });

  it("finds a clash on the same name or the same tag, but not with itself", async () => {
    const { createSkill, findNameClash } = await load();
    const saved = createSkill(draft);

    expect(findNameClash("customer UPDATE")).toEqual(saved);
    expect(findNameClash("Customer-update!")).toEqual(saved);
    expect(findNameClash("Customer update", saved.id)).toBeUndefined();
    expect(findNameClash("Incident triage")).toBeUndefined();
  });

  it("picks up skills saved in another tab", async () => {
    const { useUserSkills } = await load();
    const { result } = renderHook(() => useUserSkills());
    const other = {
      id: "from-other-tab",
      ...draft,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };

    act(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([other]));
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current).toEqual([other]);
  });
});

describe("a skill inside a message", () => {
  it("carries the instructions in a tagged block the UI can recognise", async () => {
    const {
      createSkill,
      getMessageSkillName,
      isSkillBlock,
      skillContentBlock,
    } = await load();
    const skill = createSkill({ ...draft, name: 'Say "hi" & go' });
    const block = skillContentBlock(skill);

    expect(block.type).toBe("text");
    expect(block.text).toContain(draft.instructions);
    expect(isSkillBlock(block)).toBe(true);
    expect(isSkillBlock({ type: "text", text: "Just a question" })).toBe(false);

    const content = [
      { type: "text", text: "Write up INC0001234" },
      block,
    ] as Message["content"];
    expect(getMessageSkillName(content)).toBe('Say "hi" & go');
    expect(getMessageSkillName("plain string content")).toBeNull();
  });

  it("goes after the person's words and before any attachments", async () => {
    const { buildMessageContent, createSkill, skillContentBlock } =
      await load();
    const skill = createSkill(draft);
    const image = {
      type: "image",
      source_type: "base64",
      mime_type: "image/png",
      data: "iVBOR",
    };

    expect(buildMessageContent("Write it up", skill, [image])).toEqual([
      { type: "text", text: "Write it up" },
      skillContentBlock(skill),
      image,
    ]);
    expect(buildMessageContent("Write it up", null)).toEqual([
      { type: "text", text: "Write it up" },
    ]);
    // An attachment-only message has no text block.
    expect(buildMessageContent("", null, [image])).toEqual([image]);
  });

  it("is left out of the person's text everywhere the UI shows it", async () => {
    const { createSkill, skillContentBlock } = await load();
    const { getContentString } = await import("@/components/thread/utils");
    const skill = createSkill(draft);
    const content = [
      { type: "text", text: "Write up INC0001234" },
      skillContentBlock(skill),
    ] as Message["content"];

    expect(getContentString(content)).toBe("Write up INC0001234");
  });
});
