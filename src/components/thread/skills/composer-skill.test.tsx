import { useRef, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SKILLS_PER_MESSAGE, type UserSkill } from "@/lib/user-skills";
import { clearSkills, seedSkills } from "../../../../test/skills";
import {
  SkillChip,
  SkillPicker,
  SkillPickerButton,
  useSkillMention,
} from "./composer-skill";

// A stand-in for the chat composer: the same wiring ChatInput uses, without
// the stream, uploads and prompt library around it.
function Composer({
  onPick = () => {},
  onSubmit = () => {},
}: {
  onPick?: (skill: UserSkill) => void;
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState("");
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mention = useSkillMention({
    value,
    setValue,
    textareaRef: ref,
    attached: skills.map((s) => s.id),
    onPick: (s) => {
      setSkills((prev) => [...prev, s]);
      onPick(s);
    },
  });
  return (
    <div>
      <SkillPicker mention={mention} />
      <span role="status">{mention.status}</span>
      {skills.map((skill) => (
        <SkillChip
          key={skill.id}
          skill={skill}
          onRemove={() =>
            setSkills((prev) => prev.filter((s) => s.id !== skill.id))
          }
        />
      ))}
      <textarea
        ref={ref}
        aria-label="Message"
        value={value}
        onChange={mention.handleChange}
        {...mention.textareaProps}
        onKeyDown={(e) => {
          if (mention.handleKeyDown(e)) return;
          if (e.key === "Enter" && !e.shiftKey) onSubmit();
        }}
      />
      {mention.hasSkills && (
        <SkillPickerButton
          onClick={mention.start}
          disabledReason={
            mention.canAdd ? undefined : mention.unavailableReason
          }
        />
      )}
    </div>
  );
}

function textarea() {
  return screen.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;
}

// Focus the composer and type: the caret lands at the end, as it would.
function type(value: string) {
  const el = textarea();
  act(() => el.focus());
  fireEvent.change(el, { target: { value } });
}

function optionNames() {
  return screen
    .queryAllByRole("option")
    .map((o) => o.firstElementChild?.textContent);
}

beforeEach(() => {
  clearSkills();
});

describe("typing @ in the composer", () => {
  it("does nothing when the person has no skills", () => {
    render(<Composer />);
    type("@");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use a skill" })).toBeNull();
  });

  it("lists every skill by name, highlights the first and says so", () => {
    seedSkills({ name: "Incident triage" }, { name: "Customer update" });
    render(<Composer />);
    type("@");

    const list = screen.getByRole("listbox", { name: "Skills" });
    expect(optionNames()).toEqual(["Customer update", "Incident triage"]);
    const [first] = screen.getAllByRole("option");
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(textarea().getAttribute("aria-controls")).toBe(list.id);
    expect(textarea().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(screen.getByRole("status").textContent).toMatch(/^2 skills found/);
  });

  it("opens even when the composer took focus before the page was ready", () => {
    // A click during a slow load focuses the field before React is
    // listening, so no focus event ever reaches the hook.
    seedSkills({ name: "Customer update" });
    render(<Composer />);
    fireEvent.change(textarea(), { target: { value: "@" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("narrows the list as the tag is typed", () => {
    seedSkills({ name: "Incident triage" }, { name: "Customer update" });
    render(<Composer />);
    type("Write up @cus");
    expect(optionNames()).toEqual(["Customer update"]);
  });

  it("picks the highlighted skill on Enter, takes the tag out and doesn't send", () => {
    const [customer] = seedSkills({ name: "Customer update" });
    const onPick = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Composer
        onPick={onPick}
        onSubmit={onSubmit}
      />,
    );
    type("Write up @cus");

    fireEvent.keyDown(textarea(), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(customer);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea().value).toBe("Write up ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove skill Customer update" }),
    ).toBeTruthy();
  });

  it("moves through the list with the arrow keys, wrapping at the ends", () => {
    seedSkills(
      { name: "Bridge call notes" },
      { name: "Customer update" },
      { name: "Incident triage" },
    );
    const onPick = vi.fn();
    render(<Composer onPick={onPick} />);
    type("@");

    fireEvent.keyDown(textarea(), { key: "ArrowUp" });
    expect(
      screen.getByRole("option", { selected: true }).textContent,
    ).toContain("Incident triage");

    fireEvent.keyDown(textarea(), { key: "ArrowDown" });
    fireEvent.keyDown(textarea(), { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { selected: true }).textContent,
    ).toContain("Customer update");

    fireEvent.keyDown(textarea(), { key: "Tab" });
    expect(onPick.mock.lastCall?.[0].name).toBe("Customer update");
  });

  it("picks a skill on click", () => {
    seedSkills({ name: "Customer update" }, { name: "Incident triage" });
    const onPick = vi.fn();
    render(<Composer onPick={onPick} />);
    type("@");

    const option = screen.getByRole("option", { name: /Incident triage/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(onPick.mock.lastCall?.[0].name).toBe("Incident triage");
    expect(textarea().value).toBe("");
  });

  it("closes on Escape for that tag only, and opens again for a new one", () => {
    seedSkills({ name: "Customer update" });
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    type("@cus");

    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    type("@cust");
    expect(screen.queryByRole("listbox")).toBeNull();

    // With the list closed, Enter is the composer's again.
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    type("@cust and @");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("leaves Shift+Enter to the composer for a new line", () => {
    seedSkills({ name: "Customer update" });
    const onPick = vi.fn();
    render(<Composer onPick={onPick} />);
    type("@");

    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("ignores an @ inside a word and a tag nothing matches", () => {
    seedSkills({ name: "Customer update" });
    render(<Composer />);
    type("mail jdoe@example");
    expect(screen.queryByRole("listbox")).toBeNull();
    type("@zzz");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("closes when the composer loses focus", () => {
    seedSkills({ name: "Customer update" });
    render(<Composer />);
    type("@");
    act(() => textarea().blur());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("types the @ for the person from the footer button", async () => {
    seedSkills({ name: "Customer update" });
    render(<Composer />);
    type("Write up");
    act(() => textarea().blur());

    fireEvent.click(screen.getByRole("button", { name: "Use a skill" }));

    expect(textarea().value).toBe("Write up @");
    expect(await screen.findByRole("listbox")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(textarea()));
  });

  it("lets the person take the chip off again", () => {
    seedSkills({ name: "Customer update" });
    render(<Composer />);
    type("@");
    fireEvent.keyDown(textarea(), { key: "Enter" });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove skill Customer update" }),
    );
    expect(
      screen.queryByRole("button", { name: "Remove skill Customer update" }),
    ).toBeNull();
  });

  it("adds a second skill next to the first, and stops listing the first", () => {
    seedSkills({ name: "Customer update" }, { name: "Incident triage" });
    const onPick = vi.fn();
    render(<Composer onPick={onPick} />);
    type("Write up @cus");
    fireEvent.keyDown(textarea(), { key: "Enter" });

    type("Write up @");
    expect(optionNames()).toEqual(["Incident triage"]);
    fireEvent.keyDown(textarea(), { key: "Enter" });

    expect(onPick.mock.calls.map(([s]) => s.name)).toEqual([
      "Customer update",
      "Incident triage",
    ]);
    expect(
      screen.getByRole("button", { name: "Remove skill Customer update" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove skill Incident triage" }),
    ).toBeTruthy();
    // Every skill is on the message, so there is nothing left to offer.
    type("Write up @");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Use a skill" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it(`stops at ${MAX_SKILLS_PER_MESSAGE} skills and says why`, () => {
    seedSkills(
      ...Array.from({ length: MAX_SKILLS_PER_MESSAGE + 1 }, (_, i) => ({
        name: `Skill ${i + 1}`,
      })),
    );
    render(<Composer />);
    for (let i = 0; i < MAX_SKILLS_PER_MESSAGE; i += 1) {
      type("@");
      fireEvent.keyDown(textarea(), { key: "Enter" });
    }
    expect(
      screen.getAllByRole("button", { name: /^Remove skill/ }),
    ).toHaveLength(MAX_SKILLS_PER_MESSAGE);

    type("@");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(
      `up to ${MAX_SKILLS_PER_MESSAGE} skills`,
    );
    const button = screen.getByRole("button", {
      name: "Use a skill",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(`Up to ${MAX_SKILLS_PER_MESSAGE} skills`);

    // Escape puts the note away; taking a skill off brings the list back.
    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove skill Skill 1" }),
    );
    type("Next @");
    expect(optionNames()).toEqual(["Skill 1", "Skill 6"]);
  });
});
