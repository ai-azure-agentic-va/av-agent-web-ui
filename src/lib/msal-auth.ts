import "server-only";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import { cookies } from "next/headers";
import crypto from "crypto";

const SESSION_COOKIE = "ets_session";
const STATE_COOKIE = "oauth_state";
const SESSION_MAX_AGE = 28800; // 8 hours

function getMsalApp(): ConfidentialClientApplication {
  const config: Configuration = {
    auth: {
      clientId: process.env.ENTRA_CLIENT_ID!,
      authority: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
    },
  };
  return new ConfidentialClientApplication(config);
}

export function getRedirectUri(): string {
  const base = (process.env.AUTH_URL || "http://localhost:8081").replace(/\/$/, "");
  return `${base}/chat/auth/callback`;
}

function getScopes(): string[] {
  const apiScope = process.env.API_SCOPE?.trim();
  if (apiScope) {
    return [apiScope, "openid", "profile"];
  }
  return ["User.Read", "openid", "profile"];
}

export async function getLoginUrl(): Promise<{ url: string; state: string }> {
  const app = getMsalApp();
  const state = crypto.randomBytes(32).toString("hex");
  const url = await app.getAuthCodeUrl({
    scopes: getScopes(),
    redirectUri: getRedirectUri(),
    state,
    prompt: "login",
  });
  return { url, state };
}

export async function handleOAuthCallback(
  code: string,
  returnedState: string,
  storedState: string
): Promise<{ name: string; email: string; oid: string; groups: string[]; accessToken: string; expiresAt: number } | null> {
  if (returnedState !== storedState) return null;
  try {
    const app = getMsalApp();
    const result = await app.acquireTokenByCode({
      code,
      scopes: getScopes(),
      redirectUri: getRedirectUri(),
    });
    const claims = result.idTokenClaims as Record<string, any>;
    return {
      oid: claims.oid,
      name: claims.name || claims.preferred_username || "User",
      email: claims.preferred_username || claims.email || "",
      groups: Array.isArray(claims.groups) ? claims.groups : [],
      accessToken: result.accessToken,
      expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600_000,
    };
  } catch {
    return null;
  }
}

export function signSession(payload: object): string {
  const secret = process.env.AUTH_SECRET!;
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ data, sig })).toString("base64url");
}

export function verifySession(token: string): Record<string, string> | null {
  try {
    const secret = process.env.AUTH_SECRET!;
    const { data, sig } = JSON.parse(Buffer.from(token, "base64url").toString());
    const expected = crypto.createHmac("sha256", secret).update(data).digest("hex");
    if (sig !== expected) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<Record<string, string> | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Checks whether the user belongs to at least one of the configured AD groups
 * using the "groups" claim from the ID token (requires groupMembershipClaims
 * = "SecurityGroup" on the App Registration).
 *
 * Returns { allowed: true } when no groups are configured.
 */
export function checkGroupMembership(
  userGroups: string[]
): { allowed: boolean } {
  const usersGroupId = process.env.AI_VA_USERS_GROUP_ID?.trim();
  const adminsGroupId = process.env.AI_VA_ADMINS_GROUP_ID?.trim();
  const requiredGroups = [usersGroupId, adminsGroupId].filter(Boolean) as string[];

  if (requiredGroups.length === 0) return { allowed: true };

  return { allowed: userGroups.some((g) => requiredGroups.includes(g)) };
}

export { SESSION_COOKIE, STATE_COOKIE, SESSION_MAX_AGE };
