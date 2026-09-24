import { NextRequest, NextResponse } from "next/server";
import { verifySessionEdge, SESSION_COOKIE } from "@/lib/session-verify";

export async function middleware(req: NextRequest) {
  if (process.env.DISABLE_AUTH === "true") return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionEdge(token) : null;

  if (!user) {
    return NextResponse.redirect(new URL("/api/auth/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/auth|auth|chat/auth/callback|_next/static|_next/image|favicon\\.ico|logo\\.svg).*)",
  ],
};
