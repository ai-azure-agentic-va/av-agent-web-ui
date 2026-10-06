import "server-only";
import {
  AccountInfo,
  ConfidentialClientApplication,
  Configuration,
} from "@azure/msal-node";
import { cookies } from "next/headers";
import crypto from "crypto";
import { logger } from "@/lib/logger";

const SESSION_COOKIE = "app_session";
const STATE_COOKIE = "oauth_state";
const SESSION_MAX_AGE = 28800; // 8 hours

// A user's group membership entry. `id` is the Entra group object ID; `name`
// is the display name (only available when resolved via Graph — the token's
// `groups` claim carries IDs only, so `name` is "" on that path).
export type UserGroup = { id: string; name: string };

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGuid(value: string): boolean {
  return GUID_RE.test(value.trim());
}

/**
 * Flattened, de-duplicated list of all configured access-control groups.
 * AI_VA_USERS_GROUP_ID and AI_VA_ADMINS_GROUP_ID may each hold a single value
 * or a comma-separated list, and each value may be a group object ID (GUID) or
 * a display name.
 */
function getConfiguredGroups(): string[] {
  const raw = [
    process.env.AI_VA_USERS_GROUP_ID,
    process.env.AI_VA_ADMINS_GROUP_ID,
  ]
    .filter(Boolean)
    .flatMap((v) => (v as string).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(raw)];
}

/**
 * True when any configured access-control group is a *name* (not a GUID). Name
 * matching needs display names, which only the Graph lookup supplies — so this
 * forces a Graph resolution at login.
 */
function configHasGroupName(): boolean {
  return getConfiguredGroups().some((v) => !isGuid(v));
}

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
  const base = (process.env.AUTH_URL || "http://localhost:8081").replace(
    /\/$/,
    "",
  );
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
  storedState: string,
): Promise<{
  name: string;
  email: string;
  oid: string;
  groups: UserGroup[];
  accessToken: string;
  expiresAt: number;
} | null> {
  if (returnedState !== storedState) return null;
  try {
    const app = getMsalApp();
    const requestedScopes = getScopes();
    const result = await app.acquireTokenByCode({
      code,
      scopes: requestedScopes,
      redirectUri: getRedirectUri(),
    });
    const claims = result.idTokenClaims as Record<string, any>;
    // Full dump of what a successful auth returns, so we can see exactly which
    // claims Entra emits (roles, groups, wids, scp, etc.) for this user / App
    // Registration. Only prints under LOG_LEVEL=DEBUG.
    logger.debug(
      "[auth] login success — id token claim keys:",
      Object.keys(claims).join(", "),
    );
    logger.debug(
      "[auth] login success — roles claim:",
      JSON.stringify(claims.roles ?? null),
    );
    logger.debug(
      "[auth] login success — wids (directory roles) claim:",
      JSON.stringify(claims.wids ?? null),
    );
    logger.debug(
      "[auth] login success — groups claim:",
      JSON.stringify(claims.groups ?? null),
    );
    logger.debug(
      "[auth] login success — full id token claims:",
      JSON.stringify(claims),
    );
    // Scopes requested vs. actually granted in the access token. The `scp`
    // claim is what Entra ultimately consented to (delegated permissions).
    logger.debug("[auth] requested scopes:", JSON.stringify(requestedScopes));
    logger.debug(
      "[auth] granted scopes (result.scopes):",
      JSON.stringify(result.scopes),
    );
    logger.debug(
      "[auth] id token scp claim:",
      JSON.stringify(claims.scp ?? null),
    );

    // The token only carries group object IDs (no display names). Start with
    // the claim, then resolve via Graph when either (a) the claim is absent
    // (App Registration not emitting it, or the user is over the ~200-group
    // token limit) or (b) access control is configured by group *name*, which
    // requires display names that only Graph can supply.
    let groups: UserGroup[] = Array.isArray(claims.groups)
      ? claims.groups.map((id: string) => ({ id, name: "" }))
      : [];
    if (groups.length === 0 || configHasGroupName()) {
      logger.warn(
        `[auth] resolving group membership via Microsoft Graph (oid: ${claims.oid}, reason: ${
          groups.length === 0 ? "no groups claim" : "configured by name"
        })`,
      );
      // Preferred: delegated call using the signed-in user's own Graph token,
      // minted from the auth-code refresh token (requires the Group.Read.All
      // *delegated* permission with admin consent on the FE App Registration).
      let resolved = await fetchUserGroupsDelegated(app, result.account);
      logger.debug(
        "[auth] groups from delegated Graph (/me):",
        JSON.stringify(resolved),
      );
      // Fallback: app-only (client credentials) call, in case the delegated
      // token couldn't be acquired (e.g. delegated permission not consented).
      if (resolved.length === 0) {
        resolved = await fetchUserGroupsFromGraph(claims.oid);
        logger.debug(
          "[auth] groups from app-only Graph fallback:",
          JSON.stringify(resolved),
        );
      }
      // Keep the (named) Graph result if it succeeded; otherwise fall back to
      // whatever the token claim gave us (IDs only).
      if (resolved.length > 0) groups = resolved;
    }

    return {
      oid: claims.oid,
      name: claims.name || claims.preferred_username || "User",
      email: claims.preferred_username || claims.email || "",
      groups,
      accessToken: result.accessToken,
      expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600_000,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the signed-in user's group membership using a *delegated* Microsoft
 * Graph token. The token is minted from the auth-code refresh token via
 * acquireTokenSilent (same MSAL instance that redeemed the code, so its cache
 * holds the account + refresh token), then used to call /me/transitiveMemberOf.
 *
 * Requires the `Group.Read.All` *delegated* permission with admin consent on
 * the FE App Registration. We cannot bundle this scope into the login request
 * because API_SCOPE targets a different resource (Entra v2 rejects mixed-
 * resource scope requests), so it is acquired here as a separate token.
 * Returns transitive (nested) group object IDs, paging through all results.
 */
async function fetchUserGroupsDelegated(
  app: ConfidentialClientApplication,
  account: AccountInfo | null,
): Promise<UserGroup[]> {
  if (!account) return [];
  try {
    const tokenResult = await app.acquireTokenSilent({
      account,
      scopes: ["https://graph.microsoft.com/Group.Read.All"],
    });
    if (!tokenResult?.accessToken) {
      logger.error(
        "[auth] delegated Graph: failed to acquire user Graph token (is Group.Read.All delegated + admin-consented?)",
      );
      return [];
    }

    const groups: UserGroup[] = [];
    let url: string | undefined =
      "https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=id,displayName&$top=999";

    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
      });
      if (!res.ok) {
        logger.error(
          `[auth] delegated Graph: ${res.status} ${res.statusText} — ${await res.text()}`,
        );
        break;
      }
      const data = (await res.json()) as {
        value?: Array<{ id?: string; displayName?: string }>;
        "@odata.nextLink"?: string;
      };
      for (const obj of data.value ?? []) {
        if (obj.id) groups.push({ id: obj.id, name: obj.displayName ?? "" });
      }
      url = data["@odata.nextLink"];
    }
    return groups;
  } catch (err) {
    logger.error("[auth] delegated Graph error:", (err as Error).message);
    return [];
  }
}

/**
 * Resolves a user's group membership via Microsoft Graph using an app-only
 * (client credentials) token. Used as a fallback when the `groups` claim is
 * missing from the ID token.
 *
 * Requires an application permission of `GroupMember.Read.All` (or
 * `Directory.Read.All`) granted with admin consent on the App Registration.
 * Returns transitive (nested) groups (id + display name), paging through all
 * results.
 */
async function fetchUserGroupsFromGraph(userOid: string): Promise<UserGroup[]> {
  if (!userOid) return [];
  try {
    const app = getMsalApp();
    const tokenResult = await app.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    if (!tokenResult?.accessToken) {
      logger.error(
        "[auth] Graph fallback: failed to acquire app-only token (check client secret / API permissions)",
      );
      return [];
    }

    const groups: UserGroup[] = [];
    let url: string | undefined =
      `https://graph.microsoft.com/v1.0/users/${userOid}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName&$top=999`;

    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
      });
      if (!res.ok) {
        logger.error(
          `[auth] Graph fallback: ${res.status} ${res.statusText} — ${await res.text()}`,
        );
        break;
      }
      const data = (await res.json()) as {
        value?: Array<{ id?: string; displayName?: string }>;
        "@odata.nextLink"?: string;
      };
      for (const obj of data.value ?? []) {
        if (obj.id) groups.push({ id: obj.id, name: obj.displayName ?? "" });
      }
      url = data["@odata.nextLink"];
    }
    return groups;
  } catch (err) {
    logger.error("[auth] Graph fallback error:", (err as Error).message);
    return [];
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
    const { data, sig } = JSON.parse(
      Buffer.from(token, "base64url").toString(),
    );
    const expected = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("hex");
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
 * Checks whether the user belongs to at least one of the configured AD groups.
 * AI_VA_USERS_GROUP_ID / AI_VA_ADMINS_GROUP_ID may each hold either a group
 * object ID (GUID) or a group display name — matching is case-insensitive
 * against the user's group IDs and names. (Name matching requires the groups
 * to have been resolved via Graph; see configHasGroupName / handleOAuthCallback.)
 *
 * Returns { allowed: true } when no groups are configured.
 */
export function checkGroupMembership(userGroups: UserGroup[]): {
  allowed: boolean;
} {
  const requiredGroups = getConfiguredGroups();

  if (requiredGroups.length === 0) {
    logger.warn(
      "[auth] ⚠️  GROUP CHECK BYPASSED — neither AI_VA_USERS_GROUP_ID nor " +
        "AI_VA_ADMINS_GROUP_ID is set. Every authenticated user is allowed in. " +
        "Set these env vars to enforce group-based access control.",
    );
    return { allowed: true };
  }

  const required = requiredGroups.map((g) => g.toLowerCase());
  const allowed = userGroups.some(
    (g) =>
      required.includes(g.id.toLowerCase()) ||
      (g.name && required.includes(g.name.toLowerCase())),
  );
  return { allowed };
}

export { SESSION_COOKIE, STATE_COOKIE, SESSION_MAX_AGE };
