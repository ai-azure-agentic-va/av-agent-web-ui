import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicUser } from "@/lib/public-user";
import { SessionUserProvider } from "@/providers/SessionUser";
import { UserBadge } from "./user-badge";

const jane: PublicUser = { name: "Jane Doe", email: "jdoe@example.com" };

function renderBadge(user: PublicUser | null) {
  return render(
    <SessionUserProvider user={user}>
      <UserBadge />
    </SessionUserProvider>,
  );
}

describe("UserBadge", () => {
  it("shows the initials circle followed by the display name", () => {
    renderBadge(jane);

    const initials = screen.getByTestId("user-badge-initials");
    const name = screen.getByTestId("user-badge-name");
    expect(initials.textContent).toBe("JD");
    expect(name.textContent).toBe("Jane Doe");
    expect(initials.nextElementSibling).toBe(name);
  });

  it("hides the decorative initials from screen readers and is keyboard-focusable", () => {
    renderBadge(jane);

    expect(
      screen.getByTestId("user-badge-initials").getAttribute("aria-hidden"),
    ).toBe("true");
    expect(screen.getByTestId("user-badge").tabIndex).toBe(0);
  });

  it("caps the name at a fixed width and truncates overflow with an ellipsis", () => {
    const longName = "Bartholomew Maximilian Featherstonehaugh-Cholmondeley";
    renderBadge({ ...jane, name: longName });

    const name = screen.getByTestId("user-badge-name");
    expect(name.classList.contains("truncate")).toBe(true);
    expect(name.classList.contains("max-w-48")).toBe(true);
    // The DOM keeps the full name; only CSS clips it.
    expect(name.textContent).toBe(longName);
  });

  it("shows the full name and the email in a tooltip on keyboard focus", async () => {
    renderBadge(jane);

    fireEvent.focus(screen.getByTestId("user-badge"));

    // Radix also renders a visible copy of the content; the role="tooltip"
    // element is the single accessible one.
    const tooltip = await screen.findByRole("tooltip");
    const lines = Array.from(tooltip.querySelectorAll("p")).map(
      (p) => p.textContent,
    );
    expect(lines).toEqual(["Jane Doe", "jdoe@example.com"]);
  });

  it("shows only the name in the tooltip when the email is empty", async () => {
    renderBadge({ ...jane, email: "" });

    fireEvent.focus(screen.getByTestId("user-badge"));

    const tooltip = await screen.findByRole("tooltip");
    const lines = Array.from(tooltip.querySelectorAll("p")).map(
      (p) => p.textContent,
    );
    expect(lines).toEqual(["Jane Doe"]);
  });

  it("renders nothing when nobody is signed in", () => {
    const { container } = renderBadge(null);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("user-badge")).toBeNull();
  });

  it("renders nothing when there is no SessionUserProvider", () => {
    const { container } = render(<UserBadge />);

    expect(container.innerHTML).toBe("");
  });
});
