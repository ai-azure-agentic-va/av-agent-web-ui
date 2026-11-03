// The part of the server session that may be sent to the browser. The session
// cookie also carries `accessToken`, `oid`, `expiresAt` and the user's groups;
// those must never reach client props, React context or the RSC payload, so
// this type and toPublicUser() are an allow-list rather than a filter.
//
// Deliberately NOT "server-only": client components import the type, and the
// helpers are pure.
export type PublicUser = { name: string; email: string };

/**
 * Copies only `name` and `email` out of a verified session. Returns `null` when
 * there is no session or the session has no usable name, which callers treat
 * as "nobody is signed in". The name is returned as stored (no reformatting).
 */
export function toPublicUser(
  session: Record<string, string> | null,
): PublicUser | null {
  if (!session) return null;
  // The session is parsed from JSON, so check the runtime types rather than
  // trusting the declared Record<string, string>.
  const name = typeof session.name === "string" ? session.name : "";
  if (name.trim() === "") return null;
  const email = typeof session.email === "string" ? session.email : "";
  return { name, email };
}

/**
 * Initials for the header badge: the first letter of the first word and the
 * first letter of the last word, upper-cased. A one-word name gives one letter
 * and a blank name gives "".
 */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  // Array.from splits by code point, so a name starting with a character
  // outside the BMP is not cut in half.
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toUpperCase();
}
