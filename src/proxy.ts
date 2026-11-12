import { NextRequest, NextResponse } from "next/server";
import { verifySessionEdge, SESSION_COOKIE } from "@/lib/session-verify";

// Next 16 renamed `middleware` to `proxy`. Proxy always runs on the Node.js
// runtime (it was Edge as middleware), so it shares process.env with
// instrumentation.ts — AUTH_SECRET hydrated from Key Vault is visible here.
// verifySessionEdge only uses Web APIs (crypto.subtle, atob), which Node has.
export async function proxy(req: NextRequest) {
  if (process.env.DISABLE_AUTH === "true") return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionEdge(token) : null;

  if (!user) {
    return NextResponse.redirect(new URL("/api/auth/login", req.url));
  }

  return NextResponse.next();
}

// Brand assets (src/lib/design-system.ts) load without a session so the
// sign-in and access-denied pages show the mark and favicon.
export const config = {
  matcher: [
    "/((?!api/auth|auth|chat/auth/callback|_next/static|_next/image|favicon\\.ico|logo\\.png|icon\\.png).*)",
  ],
};
