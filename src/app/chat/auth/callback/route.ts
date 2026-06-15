import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  handleOAuthCallback,
  checkGroupMembership,
  signSession,
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/msal-auth";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const base = process.env.AUTH_URL || "http://localhost:8081";

  if (error || !code || !state) {
    return NextResponse.redirect(`${base}/auth/error`);
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get(STATE_COOKIE)?.value ?? "";

  const user = await handleOAuthCallback(code, state, storedState);

  cookieStore.delete(STATE_COOKIE);

  if (!user) {
    logger.error(
      "[auth] handleOAuthCallback returned null — token exchange failed",
    );
    return NextResponse.redirect(`${base}/auth/error`);
  }

  logger.debug("[auth] user.oid:", user.oid, "user.email:", user.email);
  logger.debug("[auth] user.groups:", JSON.stringify(user.groups));
  logger.debug(
    "[auth] configured groups — users:",
    process.env.AI_VA_USERS_GROUP_ID,
    "admins:",
    process.env.AI_VA_ADMINS_GROUP_ID,
  );

  const { allowed } = checkGroupMembership(user.groups);
  logger.debug("[auth] checkGroupMembership result:", allowed);
  if (!allowed) {
    return NextResponse.redirect(`${base}/auth/access-denied`);
  }

  const response = NextResponse.redirect(`${base}/chat`);
  response.cookies.set(SESSION_COOKIE, signSession(user), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}
