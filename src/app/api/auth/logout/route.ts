import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/msal-auth";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);

  const tenantId = process.env.ENTRA_TENANT_ID;
  const clientId = process.env.ENTRA_CLIENT_ID;
  const postLogout = `${process.env.AUTH_URL || "http://localhost:8081"}/chat`;
  const logoutUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?client_id=${clientId}&post_logout_redirect_uri=${encodeURIComponent(postLogout)}`;

  return NextResponse.redirect(logoutUrl);
}
