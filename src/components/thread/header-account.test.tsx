import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@/lib/public-user";
import { SessionUserProvider } from "@/providers/SessionUser";
import { HeaderAccount } from "./header-account";

const jane: PublicUser = { name: "Jane Doe", email: "jdoe@example.com" };

function renderHeaderAccount(user: PublicUser | null, ssoEnabled: boolean) {
  return render(
    <SessionUserProvider user={user}>
      <HeaderAccount ssoEnabled={ssoEnabled} />
    </SessionUserProvider>,
  );
}

describe("HeaderAccount", () => {
  it("shows the user badge immediately to the left of Log out, in the same group", () => {
    renderHeaderAccount(jane, true);

    const badge = screen.getByTestId("user-badge");
    const logout = screen.getByTestId("logout-button");
    expect(badge.nextElementSibling).toBe(logout);
    expect(badge.parentElement).toBe(logout.parentElement);
  });

  it("navigates to /api/auth/logout when Log out is clicked", () => {
    // jsdom does not implement navigation, so observe the assignment instead.
    const location = { href: "" };
    vi.stubGlobal("location", location);
    renderHeaderAccount(jane, true);

    fireEvent.click(screen.getByTestId("logout-button"));

    expect(location.href).toBe("/api/auth/logout");
  });

  it("shows only Log out when nobody is signed in", () => {
    renderHeaderAccount(null, true);

    expect(screen.queryByTestId("user-badge")).toBeNull();
    expect(screen.getByTestId("logout-button").textContent).toBe("Log out");
  });

  it("keeps Log out hidden when SSO is disabled, as before", () => {
    renderHeaderAccount(jane, false);

    expect(screen.queryByTestId("logout-button")).toBeNull();
    expect(screen.getByTestId("user-badge")).toBeTruthy();
  });
});
