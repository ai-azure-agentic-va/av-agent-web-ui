import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/msal-auth";

export const runtime = "nodejs";

function firstConfiguredEnv(...values: Array<string | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

const BACKEND_API_URL = firstConfiguredEnv(
  process.env.PARENT_AGENT_API_URL,
  process.env.AGENT_BACKEND_URL,
  process.env.LANGGRAPH_API_URL,
);
const BACKEND_DEV_BEARER_TOKEN =
  process.env.PARENT_AGENT_DEV_TOKEN ??
  process.env.BACKEND_DEV_BEARER_TOKEN ??
  "";

// Group IDs injected as x-dev-groups in dev-auth-bypass mode so the backend's
// _dev_principal() can resolve the correct tenant → search index mapping.
const BACKEND_DEV_GROUP_IDS =
  process.env.BACKEND_DEV_GROUP_IDS ?? "";

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

async function getAccessToken(): Promise<string | null> {
  if (process.env.DISABLE_AUTH === "true") {
    return BACKEND_DEV_BEARER_TOKEN || "local-mock-token";
  }
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = verifySession(raw);
  if (!session?.accessToken) return null;
  if (session.expiresAt && Date.now() > Number(session.expiresAt)) return null;
  return session.accessToken;
}

async function handleRequest(
  req: NextRequest,
  method: string,
): Promise<NextResponse> {
  if (!BACKEND_API_URL) {
    return NextResponse.json(
      { error: "PARENT_AGENT_API_URL is not configured." },
      { status: 500 }
    );
  }

  const accessToken = await getAccessToken();

  if (!accessToken && process.env.DISABLE_AUTH !== "true") {
    return NextResponse.json(
      { error: "Session expired. Please log in again." },
      { status: 401 }
    );
  }

  try {
    const path = req.nextUrl.pathname.replace(/^\/?api\//, "");
    const searchParams = new URLSearchParams(new URL(req.url).search);
    searchParams.delete("_path");
    searchParams.delete("nxtP_path");
    const qs = searchParams.toString() ? `?${searchParams.toString()}` : "";

    const headers: Record<string, string> = {};
    const contentType = req.headers.get("content-type");
    const accept = req.headers.get("accept");
    if (contentType) headers["Content-Type"] = contentType;
    if (accept) headers["Accept"] = accept;
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    // In dev-auth-bypass mode, inject tenant group IDs so the backend's
    // _dev_principal() resolves the correct search index. The header is
    // read directly from request.headers in FastAPI — no CORS issue because
    // this is a server-to-server call (Next.js → uvicorn), not browser → server.
    if (process.env.DISABLE_AUTH === "true" && BACKEND_DEV_GROUP_IDS) {
      headers["x-dev-groups"] = BACKEND_DEV_GROUP_IDS;
    }

    const options: RequestInit = { method, headers };
    if (["POST", "PUT", "PATCH"].includes(method)) {
      options.body = await req.text();
    }

    const backendUrl = BACKEND_API_URL.replace(/\/$/, "");
    const res = await fetch(`${backendUrl}/${path}${qs}`, options);

    const isEventStream = res.headers.get("content-type")?.includes("text/event-stream");

    const responseHeaders: Record<string, string> = {
      ...Object.fromEntries(res.headers.entries()),
      ...getCorsHeaders(),
    };

    if (isEventStream) {
      responseHeaders["Content-Type"] = "text/event-stream";
      responseHeaders["Cache-Control"] = "no-cache, no-transform";
      responseHeaders["Connection"] = "keep-alive";
      responseHeaders["X-Accel-Buffering"] = "no";
      // Remove transfer-encoding and content-length which can cause buffering
      delete responseHeaders["content-length"];
      delete responseHeaders["transfer-encoding"];
    }

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

export const GET = (req: NextRequest) => handleRequest(req, "GET");
export const POST = (req: NextRequest) => handleRequest(req, "POST");
export const PUT = (req: NextRequest) => handleRequest(req, "PUT");
export const PATCH = (req: NextRequest) => handleRequest(req, "PATCH");
export const DELETE = (req: NextRequest) => handleRequest(req, "DELETE");
export const OPTIONS = () =>
  new NextResponse(null, { status: 204, headers: getCorsHeaders() });