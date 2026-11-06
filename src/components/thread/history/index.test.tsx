import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationThread } from "@/providers/Thread";
import {
  clearSkills,
  hydrationErrors,
  renderWithUrl,
  seedSkills,
} from "../../../../test/skills";
import ThreadHistory from "./index";

const threads = [
  {
    thread_id: "t-1",
    title: "VPN drops after an update",
    updated_at: "2026-11-01T10:00:00.000Z",
  },
  {
    thread_id: "t-2",
    title: "Who approved CHG0000031?",
    updated_at: "2026-11-02T09:00:00.000Z",
  },
] as ConversationThread[];

vi.mock("@/providers/Thread", () => ({
  useThreads: () => ({
    threads,
    threadsLoading: false,
    threadsError: false,
    refreshThreads: () => Promise.resolve(),
  }),
}));
// Desktop: the sidebar renders as the rail, and the mobile sheet stays shut.
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("@/lib/background-runs", () => ({
  useBackgroundRuns: () => new Set<string>(),
}));

function tab(name: string) {
  return screen.getByRole("tab", { name });
}

beforeEach(() => {
  clearSkills();
});

describe("the sidebar switch", () => {
  it("opens on Conversations, with only the selected tab in the tab order", () => {
    renderWithUrl(<ThreadHistory />);

    expect(tab("Conversations").getAttribute("aria-selected")).toBe("true");
    expect(tab("Conversations").tabIndex).toBe(0);
    expect(tab("Skills").getAttribute("aria-selected")).toBe("false");
    expect(tab("Skills").tabIndex).toBe(-1);

    const panel = screen.getByRole("tabpanel", { name: "Conversations" });
    expect(tab("Conversations").getAttribute("aria-controls")).toBe(panel.id);
    expect(
      within(panel).getByRole("button", { name: /VPN drops after an update/ }),
    ).toBeTruthy();
  });

  it("shows the skills and keeps the choice in the URL", async () => {
    seedSkills({ name: "Customer update" });
    const { url } = renderWithUrl(<ThreadHistory />);

    fireEvent.click(tab("Skills"));

    const panel = screen.getByRole("tabpanel", { name: "Skills" });
    expect(within(panel).getByText("Customer update")).toBeTruthy();
    expect(within(panel).queryByText("VPN drops after an update")).toBeNull();
    await waitFor(() => expect(url().get("sidebar")).toBe("skills"));
  });

  it("reopens on Skills when the URL says so", () => {
    renderWithUrl(<ThreadHistory />, "?sidebar=skills");
    expect(tab("Skills").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("No skills yet")).toBeTruthy();
  });

  it("moves between the tabs with the arrow keys, wrapping round", () => {
    renderWithUrl(<ThreadHistory />);

    fireEvent.keyDown(tab("Conversations"), { key: "ArrowRight" });
    expect(tab("Skills").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Skills"));

    fireEvent.keyDown(tab("Skills"), { key: "ArrowRight" });
    expect(tab("Conversations").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tab("Conversations"), { key: "ArrowLeft" });
    expect(tab("Skills").getAttribute("aria-selected")).toBe("true");
  });
});

describe("opening a conversation while a skill is open", () => {
  it("closes the skill and opens the conversation", async () => {
    const { url } = renderWithUrl(<ThreadHistory />, "?skill=s-1&threadId=t-2");

    fireEvent.click(
      screen.getByRole("button", { name: /VPN drops after an update/ }),
    );

    await waitFor(() => {
      expect(url().get("threadId")).toBe("t-1");
      expect(url().get("skill")).toBeNull();
    });
  });

  it("closes the skill even when it's the conversation already open", async () => {
    const { url } = renderWithUrl(<ThreadHistory />, "?skill=s-1&threadId=t-2");

    fireEvent.click(
      screen.getByRole("button", { name: /Who approved CHG0000031\?/ }),
    );

    await waitFor(() => expect(url().get("skill")).toBeNull());
    expect(url().get("threadId")).toBe("t-2");
  });
});

describe("server rendering", () => {
  it("hydrates without a mismatch on either tab", async () => {
    expect(await hydrationErrors(<ThreadHistory />)).toEqual([]);
    expect(await hydrationErrors(<ThreadHistory />, "?sidebar=skills")).toEqual(
      [],
    );
  });

  it("ties each tab to its panel with ids that don't depend on render order", () => {
    renderWithUrl(<ThreadHistory />, "?sidebar=skills");
    expect(tab("Skills").id).toBe("sidebar-tab-skills");
    expect(tab("Skills").getAttribute("aria-controls")).toBe("sidebar-panel");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "sidebar-tab-skills",
    );
  });
});
