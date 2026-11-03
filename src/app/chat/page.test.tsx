import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/msal-auth";
import type { PublicUser } from "@/lib/public-user";
import { SessionUserProvider } from "@/providers/SessionUser";
import ChatPage from "./page";

// The real module is "server-only" and reads cookies; the page only needs the
// session lookup.
vi.mock("@/lib/msal-auth", () => ({ getSessionUser: vi.fn() }));
// Next's redirect() throws to stop rendering; mimic that.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
// Keep the heavy client tree out of a server-component test.
vi.mock("./chat-ui", () => ({ default: () => null }));

// Shape of the verified `app_session` payload, including server-only fields.
const session: Record<string, string> = {
  name: "Jane Doe",
  email: "jdoe@example.com",
  oid: "oid-1",
  accessToken: "secret-token",
  expiresAt: "9999999999999",
};

type ProviderElement = ReactElement<{ user: PublicUser | null }>;

describe("ChatPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands only the session's name and email to the client, through the provider prop", async () => {
    vi.stubEnv("DISABLE_AUTH", "false");
    vi.mocked(getSessionUser).mockResolvedValue(session);

    const element = (await ChatPage()) as ProviderElement;

    expect(element.type).toBe(SessionUserProvider);
    expect(element.props.user).toEqual({
      name: "Jane Doe",
      email: "jdoe@example.com",
    });
    expect(Object.keys(element.props.user ?? {}).sort()).toEqual([
      "email",
      "name",
    ]);
    expect(JSON.stringify(element.props.user)).not.toContain("secret-token");
  });

  it("passes no user and skips the session lookup when DISABLE_AUTH=true", async () => {
    vi.stubEnv("DISABLE_AUTH", "true");

    const element = (await ChatPage()) as ProviderElement;

    expect(getSessionUser).not.toHaveBeenCalled();
    expect(element.type).toBe(SessionUserProvider);
    expect(element.props.user).toBeNull();
  });

  it("still redirects to sign-in when auth is on and there is no session", async () => {
    vi.stubEnv("DISABLE_AUTH", "false");
    vi.mocked(getSessionUser).mockResolvedValue(null);

    await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/api/auth/login");
  });
});
