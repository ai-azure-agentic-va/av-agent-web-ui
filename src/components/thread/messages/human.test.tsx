import { fireEvent, render, screen } from "@testing-library/react";
import type { Message } from "@langchain/langgraph-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type UserSkill, skillContentBlock } from "@/lib/user-skills";
import { markdownAttachmentBlock } from "@/lib/multimodal-utils";
import { HumanMessage } from "./human";

const submit = vi.fn();
vi.mock("@/providers/Stream", () => ({
  useStreamContext: () => ({
    getMessagesMetadata: () => undefined,
    submit,
    setBranch: vi.fn(),
  }),
}));

const skill: UserSkill = {
  id: "s-1",
  name: "Customer update",
  description: "",
  instructions: "End with when the customer will hear from us again.",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function message(content: Message["content"]): Message {
  return { id: "m-1", type: "human", content } as Message;
}

const withSkill = message([
  { type: "text", text: "Write up where INC0001234 stands" },
  skillContentBlock(skill),
] as Message["content"]);

beforeEach(() => {
  submit.mockClear();
});

describe("a question sent with a skill", () => {
  it("shows only the person's words as the headline, and names the skill under it", () => {
    render(
      <HumanMessage
        message={withSkill}
        isLoading={false}
      />,
    );

    const question = screen.getByText("Write up where INC0001234 stands");
    expect(question.className).toContain("font-semibold");
    expect(screen.getByText("Skill · Customer update")).toBeTruthy();
    expect(screen.queryByText(/hear from us again/)).toBeNull();
    expect(screen.queryByText(/user_skill/)).toBeNull();
  });

  it("keeps the skill when the question is edited and sent again", () => {
    render(
      <HumanMessage
        message={withSkill}
        isLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    // The person edits their own words, never the skill's.
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Write up where INC0001234 stands",
    );

    fireEvent.change(editor, {
      target: { value: "Write up where INC0009999 stands" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    const [values] = submit.mock.lastCall!;
    expect(values.messages[0].content).toEqual([
      { type: "text", text: "Write up where INC0009999 stands" },
      skillContentBlock(skill),
    ]);
  });
});

describe("a question sent with several skills and a Markdown file", () => {
  const triage: UserSkill = { ...skill, id: "s-2", name: "Incident triage" };
  const runbook = markdownAttachmentBlock(
    "vpn-runbook.md",
    "# VPN runbook\n\nRestart the VPN Client service first.",
  );
  const withMore = message([
    { type: "text", text: "Write up where INC0001234 stands" },
    skillContentBlock(skill),
    skillContentBlock(triage),
    runbook,
  ] as Message["content"]);

  it("names every skill, shows the file, and keeps both out of the headline", () => {
    render(
      <HumanMessage
        message={withMore}
        isLoading={false}
      />,
    );

    const question = screen.getByText("Write up where INC0001234 stands");
    expect(question.className).toContain("font-semibold");
    expect(
      screen.getByText("Skills · Customer update, Incident triage"),
    ).toBeTruthy();
    expect(screen.getByText("vpn-runbook.md")).toBeTruthy();
    expect(screen.queryByText(/VPN Client/)).toBeNull();
    expect(screen.queryByText(/attached_file/)).toBeNull();
  });

  it("keeps every skill and the file when the question is edited", () => {
    render(
      <HumanMessage
        message={withMore}
        isLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    expect((editor as HTMLTextAreaElement).value).toBe(
      "Write up where INC0001234 stands",
    );
    fireEvent.change(editor, {
      target: { value: "Write up where INC0009999 stands" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submit.mock.lastCall![0].messages[0].content).toEqual([
      { type: "text", text: "Write up where INC0009999 stands" },
      skillContentBlock(skill),
      skillContentBlock(triage),
      runbook,
    ]);
  });
});

describe("a question without a skill", () => {
  it("shows no skill line, and an edit still sends plain text", () => {
    render(
      <HumanMessage
        message={message("Who approved CHG0000031?")}
        isLoading={false}
      />,
    );
    expect(screen.queryByText(/^Skill ·/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit message" }), {
      target: { value: "Who approved CHG0000032?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submit.mock.lastCall![0].messages[0].content).toBe(
      "Who approved CHG0000032?",
    );
  });
});
