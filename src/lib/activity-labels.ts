// Single source of truth for every user-facing agent-activity / status string.
//
// Change any wording here and it updates everywhere: the live activity
// indicator, the per-phase step labels, and the persisted "Thought for Ns"
// trace. Nothing else in the app should hardcode these strings.
//
// There are two kinds of activity:
//   • `steps`     — driven by backend custom stream events (search_start, etc.),
//                   keyed by the event's step key.
//   • `subagents` — driven by `task` tool calls to a subagent, keyed by the
//                   tool call's `subagent_type`. ServiceNow lives here because
//                   the backend delegates to it via a tool call, not an event.

export const ACTIVITY_LABELS = {
  // Generic fallbacks shown before / when the agent hasn't reported a phase.
  gettingStarted: "Thinking…",
  working: "Working on your request…",

  // Shown while the agent is producing the answer text.
  generating: {
    running: "Generating response…",
    done: "Generated response",
  },

  // Persisted trace disclosure, rendered as `${thoughtPrefix} ${n}${thoughtSuffix}`.
  thoughtPrefix: "Thought for",
  thoughtSuffix: "s",
  // Header used for historical turns where the duration isn't recoverable.
  thoughtProcess: "Thought process",

  // Event-driven phases, keyed by backend step key. Currently empty: the KB
  // search is surfaced via the `ai_search_tool` tool call below (same operation),
  // not a custom event, so it works in history too. Kept for any future
  // event-only phase the backend might emit that has no tool call.
  steps: {} as Record<string, { running: string; done: string }>,

  // Subagent-delegation phases, keyed by the `task` tool call's `subagent_type`.
  subagents: {
    "servicenow-ticket-agent": {
      running: "Searching ServiceNow tickets…",
      done: "Searched ServiceNow tickets",
    },
  } as Record<string, { running: string; done: string }>,

  // Named labels for specific (non-subagent) tools, keyed by the exact tool name
  // the backend uses. Any tool not listed here falls back to a humanized
  // "Using <Tool Name>…" label so every tool the agent calls is still surfaced.
  //
  // Convention for all labels: running = present-continuous + "…"; done = past
  // tense; sentence case with proper acronyms (AI, KB, …).
  tools: {
    // The AI search tool IS the knowledge-base search (the backend also emits a
    // `search` event for it, which we intentionally drop to avoid a duplicate).
    ai_search_tool: {
      running: "Searching knowledge base…",
      done: "Searched knowledge base",
    },
    read_file: {
      running: "Reading document…",
      done: "Read document",
    },
  } as Record<string, { running: string; done: string }>,
} as const;

// Derived lookups keyed by step key — consumed by the step-timeline reducer.
export const STEP_RUNNING_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIVITY_LABELS.steps).map(([key, v]) => [key, v.running]),
);

export const STEP_DONE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIVITY_LABELS.steps).map(([key, v]) => [key, v.done]),
);

// Common acronyms that should stay fully uppercased in humanized labels.
const ACRONYMS: Record<string, string> = {
  ai: "AI",
  api: "API",
  kb: "KB",
  id: "ID",
  url: "URL",
  sql: "SQL",
  ui: "UI",
  faq: "FAQ",
  pdf: "PDF",
  crm: "CRM",
};

// Turn a raw tool / subagent identifier into a readable phrase, e.g.
// "servicenow-ticket-agent" → "ServiceNow Ticket Agent", "ai_search_tool" →
// "AI Search Tool", "get_incident" → "Get Incident".
function humanize(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (lower === "servicenow") return "ServiceNow";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// Resolve the activity labels for ANY tool call so every tool the agent invokes
// is shown to the user:
//   • `task` calls → the mapped subagent label, else a generic "Delegating to X".
//   • other tools  → the mapped tool label, else a generic "Using X".
// Returns null only when the tool call has no name.
export function resolveToolActivity(
  toolCall: { name?: string; args?: Record<string, unknown> } | null | undefined,
): { running: string; done: string } | null {
  const name = toolCall?.name;
  if (!name) return null;

  if (name === "task") {
    const subagent = toolCall?.args?.subagent_type;
    if (typeof subagent === "string") {
      return (
        ACTIVITY_LABELS.subagents[subagent] ?? {
          running: `Delegating to ${humanize(subagent)}…`,
          done: `Finished ${humanize(subagent)}`,
        }
      );
    }
    return { running: "Delegating to a subagent…", done: "Delegation complete" };
  }

  return (
    ACTIVITY_LABELS.tools[name] ?? {
      running: `Using ${humanize(name)}…`,
      done: `Used ${humanize(name)}`,
    }
  );
}
