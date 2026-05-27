// Edge Runtime compatible session verification (no node: imports)

export const SESSION_COOKIE = "ets_session";

function fromBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return atob(padded);
}

export async function verifySessionEdge(
  token: string
): Promise<Record<string, string> | null> {
  try {
    const secret = process.env.AUTH_SECRET!;
    const { data, sig } = JSON.parse(fromBase64Url(token));

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = new Uint8Array(
      sig.match(/.{2}/g)!.map((b: string) => parseInt(b, 16))
    );

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      enc.encode(data)
    );

    if (!isValid) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}
