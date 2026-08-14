import { NextResponse } from "next/server";
import { getLoginUrl, STATE_COOKIE } from "@/lib/msal-auth";
import { cookies } from "next/headers";

export async function GET() {
  const { url, state } = await getLoginUrl();

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return NextResponse.redirect(url);
}
