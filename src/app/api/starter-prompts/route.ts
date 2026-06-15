import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/msal-auth";

export const runtime = "nodejs";

const BACKEND_DEV_BEARER_TOKEN =
  process.env.PARENT_AGENT_DEV_TOKEN ??
  process.env.BACKEND_DEV_BEARER_TOKEN ??
  "";

const BACKEND_DEV_GROUP_IDS = process.env.BACKEND_DEV_GROUP_IDS ?? "";

// Mirrors the catch-all proxy in src/app/api/[..._path]/route.ts so the
// server-to-server call to the backend carries the user's bearer token.
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

// Shown when no backend is reachable and DEFAULT_STARTER_PROMPTS is not set.
const FALLBACK_PROMPTS = [
  {
    label: "STTM Mapping",
    message: "Provide me the RAW, INT and CUR paths for dataset ACAPS.",
  },
  {
    label: "Owner & Data Steward",
    message: "Who is the data owner and the data steward for dataset IMPACS?",
  },
  {
    label: "Pipeline Information",
    message:
      "Give me all the information for pipeline pl-56-00-mdn-dds-daily-ingest_data.",
  },
  {
    label: "ACAPS STTM Location",
    message: "Provide me all the STTM locations for ACAPS.",
  },
];

export async function GET() {
  // 1. Try the real backend first (3 s timeout so it fails fast when offline)
  const backendUrl = (
    process.env.PARENT_AGENT_API_URL ||
    process.env.AGENT_BACKEND_URL ||
    process.env.LANGGRAPH_API_URL ||
    ""
  ).replace(/\/$/, "");

  if (backendUrl) {
    try {
      const accessToken = await getAccessToken();
      const headers: Record<string, string> = {};
      if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
      if (process.env.DISABLE_AUTH === "true" && BACKEND_DEV_GROUP_IDS) {
        headers["x-dev-groups"] = BACKEND_DEV_GROUP_IDS;
      }

      const res = await fetch(`${backendUrl}/starter-prompts`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.prompts) && data.prompts.length > 0) {
          return NextResponse.json(data);
        }
      }
    } catch {
      // backend offline — fall through
    }
  }

  // 2. Use DEFAULT_STARTER_PROMPTS env var if provided (JSON array of {label, message})
  const envRaw = process.env.DEFAULT_STARTER_PROMPTS;
  if (envRaw) {
    try {
      const prompts = JSON.parse(envRaw);
      if (Array.isArray(prompts) && prompts.length > 0) {
        return NextResponse.json({ prompts });
      }
    } catch {
      // invalid JSON — fall through
    }
  }

  // 3. Return hardcoded defaults
  return NextResponse.json({ prompts: FALLBACK_PROMPTS });
}
