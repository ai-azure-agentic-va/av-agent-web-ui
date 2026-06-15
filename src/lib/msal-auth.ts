import "server-only";
import { ConfidentialClientApplication, Configuration } from "@azure/msal-node";
import { cookies } from "next/headers";
import crypto from "crypto";
import { logger } from "@/lib/logger";

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
  groups: string[];
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

    // Groups can be absent from the token for two reasons: the App
    // Registration isn't emitting a `groups` claim, or the user is over the
    // ~200-group token limit (Entra sends an overage pointer instead). In
    // either case fall back to Microsoft Graph so group validation still works.
    let groups: string[] = Array.isArray(claims.groups) ? claims.groups : [];
    if (groups.length === 0) {
      logger.warn(
        `[auth] no groups in token — falling back to Microsoft Graph (oid: ${claims.oid})`,
      );
      groups = await fetchUserGroupsFromGraph(claims.oid);
      logger.debug(
        "[auth] groups from Graph fallback:",
        JSON.stringify(groups),
      );
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
 * Resolves a user's group membership via Microsoft Graph using an app-only
 * (client credentials) token. Used as a fallback when the `groups` claim is
 * missing from the ID token.
 *
 * Requires an application permission of `GroupMember.Read.All` (or
 * `Directory.Read.All`) granted with admin consent on the App Registration.
 * Returns transitive (nested) group object IDs, paging through all results.
 */
async function fetchUserGroupsFromGraph(userOid: string): Promise<string[]> {
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

    const groups: string[] = [];
    let url: string | undefined =
      `https://graph.microsoft.com/v1.0/users/${userOid}/transitiveMemberOf/microsoft.graph.group?$select=id&$top=999`;

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
        value?: Array<{ id?: string }>;
        "@odata.nextLink"?: string;
      };
      for (const obj of data.value ?? []) {
        if (obj.id) groups.push(obj.id);
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
 * Checks whether the user belongs to at least one of the configured AD groups
 * using the "groups" claim from the ID token (requires groupMembershipClaims
 * = "SecurityGroup" on the App Registration).
 *
 * Returns { allowed: true } when no groups are configured.
 */
export function checkGroupMembership(userGroups: string[]): {
  allowed: boolean;
} {
  const usersGroupId = process.env.AI_VA_USERS_GROUP_ID?.trim();
  const adminsGroupId = process.env.AI_VA_ADMINS_GROUP_ID?.trim();
  const requiredGroups = [usersGroupId, adminsGroupId].filter(
    Boolean,
  ) as string[];

  if (requiredGroups.length === 0) {
    logger.warn(
      "[auth] ⚠️  GROUP CHECK BYPASSED — neither AI_VA_USERS_GROUP_ID nor " +
        "AI_VA_ADMINS_GROUP_ID is set. Every authenticated user is allowed in. " +
        "Set these env vars to enforce group-based access control.",
    );
    return { allowed: true };
  }

  return { allowed: userGroups.some((g) => requiredGroups.includes(g)) };
}

export { SESSION_COOKIE, STATE_COOKIE, SESSION_MAX_AGE };
