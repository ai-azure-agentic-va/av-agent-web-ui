import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "@/lib/app-config";
import { getUserSkills } from "@/lib/user-skills";
import {
  clearSkills,
  hydrationErrors,
  renderWithUrl,
  seedSkills,
} from "../../../../test/skills";
import { SkillView } from "./skill-view";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

const customer = {
  name: "Customer update",
  description: "Where a ticket stands, for the customer.",
  instructions: "1. Open the ticket.\n2. Say **what happens next**.",
};

function field(name: string) {
  return screen.getByLabelText(name) as HTMLInputElement | HTMLTextAreaElement;
}

function fill(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } });
}

const NAME = "Name";
const DESCRIPTION = "What it does";
const INSTRUCTIONS = `Instructions ${APP_NAME} follows`;

beforeEach(() => {
  clearSkills();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.restoreAllMocks();
});

describe("SkillView, writing a new skill", () => {
  it("asks for a name and instructions before saving, and focuses the first gap", () => {
    renderWithUrl(<SkillView onUse={vi.fn()} />, "?skill=new");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "New skill",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));

    expect(field(NAME).getAttribute("aria-invalid")).toBe("true");
    expect(field(INSTRUCTIONS).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Give the skill a name.")).toBeTruthy();
    expect(
      screen.getByText(`Write the instructions ${APP_NAME} should follow.`),
    ).toBeTruthy();
    expect(document.activeElement).toBe(field(NAME));
    expect(getUserSkills()).toEqual([]);
  });

  it("shows the tag a name will get, and a clash with a saved skill as you type", () => {
    seedSkills({ name: "Customer update" });
    renderWithUrl(<SkillView onUse={vi.fn()} />, "?skill=new");

    fill(NAME, "Bridge call notes");
    expect(screen.getByText("Tagged as @bridge-call-notes")).toBeTruthy();

    fill(NAME, "customer UPDATE!");
    expect(
      screen.getByText("You already have a skill called Customer update."),
    ).toBeTruthy();
    expect(field(NAME).getAttribute("aria-invalid")).toBe("true");
  });

  it("saves the skill and opens it", async () => {
    const { url } = renderWithUrl(<SkillView onUse={vi.fn()} />, "?skill=new");
    fill(NAME, "  Customer update ");
    fill(DESCRIPTION, customer.description);
    fill(INSTRUCTIONS, customer.instructions);

    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));

    const [saved] = getUserSkills();
    expect(saved).toMatchObject(customer);
    await waitFor(() => expect(url().get("skill")).toBe(saved.id));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Customer update",
    );
  });

  it("saves with Cmd or Ctrl + Enter", () => {
    renderWithUrl(<SkillView onUse={vi.fn()} />, "?skill=new");
    fill(NAME, "Customer update");
    fill(INSTRUCTIONS, "Keep it short.");

    fireEvent.keyDown(field(INSTRUCTIONS), { key: "Enter", ctrlKey: true });

    expect(getUserSkills().map((s) => s.name)).toEqual(["Customer update"]);
  });

  it("keeps instructions past the limit whole, says how far over they are, and saves once they fit", () => {
    renderWithUrl(<SkillView onUse={vi.fn()} />, "?skill=new");
    fill(NAME, "Customer update");
    // A browser cuts a paste to a maxlength without a word.
    expect(field(INSTRUCTIONS).hasAttribute("maxlength")).toBe(false);

    fill(INSTRUCTIONS, "x".repeat(8_005));

    expect(field(INSTRUCTIONS).value).toHaveLength(8_005);
    expect(field(INSTRUCTIONS).getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText(
        `5 characters over the ${(8_000).toLocaleString()} limit. Shorten the instructions to save the skill.`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `${(8_005).toLocaleString()} / ${(8_000).toLocaleString()}`,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
    expect(getUserSkills()).toEqual([]);
    expect(document.activeElement).toBe(field(INSTRUCTIONS));

    fill(INSTRUCTIONS, "x".repeat(8_001));
    expect(
      screen.getByText(
        `1 character over the ${(8_000).toLocaleString()} limit. Shorten the instructions to save the skill.`,
      ),
    ).toBeTruthy();

    // Counted as saved: the space around the instructions is not.
    fill(INSTRUCTIONS, `\n${"x".repeat(8_000)}\n`);
    expect(field(INSTRUCTIONS).getAttribute("aria-invalid")).toBeNull();
    expect(
      screen.getByText(
        `${(8_000).toLocaleString()} / ${(8_000).toLocaleString()}`,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
    expect(getUserSkills().map((s) => s.instructions)).toEqual([
      "x".repeat(8_000),
    ]);
  });

  it("says so, and keeps the form, when the browser won't store it", () => {
    renderWithUrl(<SkillView onUse={vi.fn()} />, "?skill=new");
    fill(NAME, "Customer update");
    fill(INSTRUCTIONS, "Keep it short.");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't save the skill",
      expect.anything(),
    );
    expect(field(NAME).value).toBe("Customer update");
  });

  it("goes back to the chat on Cancel", async () => {
    const { url } = renderWithUrl(<SkillView onUse={vi.fn()} />, "?skill=new");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(url().get("skill")).toBeNull());
  });
});

describe("SkillView, server rendering", () => {
  it("hydrates the new-skill form without a mismatch", async () => {
    expect(
      await hydrationErrors(<SkillView onUse={vi.fn()} />, "?skill=new"),
    ).toEqual([]);
  });
});

describe("SkillView, reading a skill", () => {
  it("shows the skill like an answer: kicker, name, tag, description, instructions", () => {
    const [skill] = seedSkills(customer);
    renderWithUrl(<SkillView onUse={vi.fn()} />, `?skill=${skill.id}`);

    expect(screen.getByText(/^Your skill · Updated/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Customer update",
    );
    expect(screen.getByText("@customer-update")).toBeTruthy();
    expect(screen.getByText(customer.description)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: `Instructions ${APP_NAME} follows` }),
    ).toBeTruthy();
    // Markdown: a numbered list with bold text.
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Open the ticket.", "Say what happens next."]);
    expect(screen.getByText("what happens next").tagName).toBe("STRONG");
    expect(
      screen.getByText(`${customer.instructions.length} characters`),
    ).toBeTruthy();
  });

  it("hands the skill to the chat on Use in chat", () => {
    const [skill] = seedSkills(customer);
    const onUse = vi.fn();
    renderWithUrl(<SkillView onUse={onUse} />, `?skill=${skill.id}`);

    fireEvent.click(screen.getByRole("button", { name: "Use in chat" }));
    expect(onUse).toHaveBeenCalledWith(skill.id);
  });

  it("edits in place, then returns focus to Edit", async () => {
    const [skill] = seedSkills(customer);
    const { url } = renderWithUrl(
      <SkillView onUse={vi.fn()} />,
      `?skill=${skill.id}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Edit skill",
    );
    expect(field(NAME).value).toBe(customer.name);
    // Its own name is not a clash.
    expect(field(NAME).getAttribute("aria-invalid")).toBeNull();

    fill(INSTRUCTIONS, "Three sentences at most.");
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));

    expect(getUserSkills()[0].instructions).toBe("Three sentences at most.");
    expect(screen.getByText("Three sentences at most.")).toBeTruthy();
    await waitFor(() => expect(url().get("skill")).toBe(skill.id));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit" }),
      ),
    );
  });

  it("throws away an edit on Cancel", () => {
    const [skill] = seedSkills(customer);
    renderWithUrl(<SkillView onUse={vi.fn()} />, `?skill=${skill.id}`);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fill(NAME, "Something else");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Customer update",
    );
    expect(getUserSkills()[0].name).toBe("Customer update");
  });

  it("deletes the skill, closes it, and offers Undo", async () => {
    const [skill] = seedSkills(customer);
    const { url } = renderWithUrl(
      <SkillView onUse={vi.fn()} />,
      `?skill=${skill.id}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(getUserSkills()).toEqual([]);
    await waitFor(() => expect(url().get("skill")).toBeNull());
    expect(toast).toHaveBeenCalledWith(
      "Skill deleted",
      expect.objectContaining({ description: "Customer update" }),
    );

    // The Undo handler takes no notice of the click event it is given.
    const options = vi.mocked(toast).mock.lastCall?.[1] as unknown as {
      action: { onClick: () => void };
    };
    act(() => options.action.onClick());
    expect(getUserSkills()).toEqual([skill]);
  });

  it("explains a skill that isn't in this browser, with a way back", async () => {
    const { url } = renderWithUrl(
      <SkillView onUse={vi.fn()} />,
      "?skill=not-here",
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "This skill isn't here",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    await waitFor(() => expect(url().get("skill")).toBeNull());
  });

  it("renders nothing without a skill in the URL", () => {
    const { container } = renderWithUrl(<SkillView onUse={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
