import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSkill } from "@/lib/user-skills";
import {
  clearSkills,
  renderWithUrl,
  seedSkills,
} from "../../../../test/skills";
import { SkillList } from "./skill-list";

function rows() {
  return within(screen.getByRole("list"))
    .getAllByRole("button")
    .map((b) => b.textContent);
}

beforeEach(() => {
  clearSkills();
});

describe("SkillList", () => {
  it("invites the first skill when there are none, without a search box", async () => {
    const onNavigate = vi.fn();
    const { url } = renderWithUrl(<SkillList onNavigate={onNavigate} />);

    expect(screen.getByText("No skills yet")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(
      screen.getByText("Your skills are saved in this browser only."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New skill" }));
    await waitFor(() => expect(url().get("skill")).toBe("new"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("lists skills by name with their tags and a count", () => {
    seedSkills(
      { name: "Incident triage" },
      { name: "bridge call notes" },
      { name: "Customer update" },
    );
    renderWithUrl(<SkillList />);

    expect(screen.getByText("Your skills · 3")).toBeTruthy();
    expect(rows()).toEqual([
      "bridge call notes@bridge-call-notes",
      "Customer update@customer-update",
      "Incident triage@incident-triage",
    ]);
  });

  it("opens a skill from its row and marks the open one", async () => {
    const [triage, customer] = seedSkills(
      { name: "Incident triage" },
      { name: "Customer update" },
    );
    const onNavigate = vi.fn();
    const { url } = renderWithUrl(
      <SkillList onNavigate={onNavigate} />,
      `?skill=${triage.id}`,
    );

    const triageRow = screen.getByRole("button", { name: /Incident triage/ });
    expect(triageRow.getAttribute("aria-current")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Customer update/ }));
    await waitFor(() => expect(url().get("skill")).toBe(customer.id));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: /Customer update/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(triageRow.getAttribute("aria-current")).toBeNull();
  });

  it("starts a new skill from the + button", async () => {
    seedSkills({ name: "Customer update" });
    const { url } = renderWithUrl(<SkillList />);
    fireEvent.click(screen.getByRole("button", { name: "New skill" }));
    await waitFor(() => expect(url().get("skill")).toBe("new"));
  });

  it("filters by name, tag or description, and says when nothing matches", () => {
    seedSkills(
      { name: "Incident triage", description: "First look at a P1" },
      { name: "Customer update" },
      { name: "Bridge call notes" },
    );
    renderWithUrl(<SkillList />);
    const search = screen.getByRole("searchbox", { name: "Search skills" });

    fireEvent.change(search, { target: { value: "BRIDGE" } });
    expect(rows()).toEqual(["Bridge call notes@bridge-call-notes"]);

    fireEvent.change(search, { target: { value: "customer-up" } });
    expect(rows()).toEqual(["Customer update@customer-update"]);

    fireEvent.change(search, { target: { value: "p1" } });
    expect(rows()).toEqual(["Incident triage@incident-triage"]);

    fireEvent.change(search, { target: { value: "  vpn " } });
    expect(screen.getByText("No skills match “vpn”")).toBeTruthy();
    // The count is of every skill, not the filtered few.
    expect(screen.getByText("Your skills · 3")).toBeTruthy();
  });

  it("picks up a skill saved elsewhere in the app", () => {
    renderWithUrl(<SkillList />);
    act(() => {
      createSkill({
        name: "Runbook lookup",
        description: "",
        instructions: "Find the runbook.",
      });
    });
    expect(rows()).toEqual(["Runbook lookup@runbook-lookup"]);
  });
});
