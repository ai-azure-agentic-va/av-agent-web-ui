import { describe, expect, it } from "vitest";
import { getInitials, toPublicUser } from "./public-user";

// Shape of the verified `app_session` payload (see handleOAuthCallback in
// msal-auth.ts), including the fields that must stay on the server.
const session: Record<string, string> = {
  name: "Jane Doe",
  email: "jdoe@example.com",
  oid: "oid-1",
  accessToken: "secret-token",
  expiresAt: "9999999999999",
};

describe("toPublicUser", () => {
  it("copies exactly name and email, leaving the token and other fields behind", () => {
    const user = toPublicUser(session);

    expect(user).toEqual({ name: "Jane Doe", email: "jdoe@example.com" });
    expect(Object.keys(user ?? {}).sort()).toEqual(["email", "name"]);
    expect(JSON.stringify(user)).not.toContain("secret-token");
  });

  it("keeps the stored name as-is, including the 'User' fallback", () => {
    expect(toPublicUser({ ...session, name: "User" })?.name).toBe("User");
  });

  it("returns null when there is no session", () => {
    expect(toPublicUser(null)).toBeNull();
  });

  it("returns null when the session has an empty or blank name", () => {
    expect(toPublicUser({ ...session, name: "" })).toBeNull();
    expect(toPublicUser({ ...session, name: "   " })).toBeNull();
  });

  it("defaults a missing email to an empty string", () => {
    const { email: _email, ...withoutEmail } = session;

    expect(toPublicUser(withoutEmail)).toEqual({ name: "Jane Doe", email: "" });
  });
});

describe("getInitials", () => {
  it.each([
    ["Jane Doe", "JD"],
    ["Mary Ann van Buren", "MB"],
    ["jdoe@example.com", "J"],
    ["  jane   doe ", "JD"],
    ["", ""],
    ["   ", ""],
  ])("%j gives %j", (name, initials) => {
    expect(getInitials(name)).toBe(initials);
  });
});
