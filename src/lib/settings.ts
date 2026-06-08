// Per-user chat settings (Settings panel). Persisted in localStorage and read
// at submit time so the backend can honor model / top_k / temperature /
// system_prompt overrides.

export type ChatSettings = {
  model: string;
  topK: number;
  temperature: number;
  systemPrompt: string;
};

export const DEFAULT_SETTINGS: ChatSettings = {
  model: "gpt-4.1",
  topK: 12,
  temperature: 0.8,
  systemPrompt: "",
};

const STORAGE_KEY = "nfcu-chat-settings";
export const SETTINGS_CHANGED_EVENT = "nfcu-settings-changed";

export function loadSettings(): ChatSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<ChatSettings>;
    return {
      model: typeof p.model === "string" ? p.model : DEFAULT_SETTINGS.model,
      topK: Number.isFinite(p.topK) ? Number(p.topK) : DEFAULT_SETTINGS.topK,
      temperature: Number.isFinite(p.temperature)
        ? Number(p.temperature)
        : DEFAULT_SETTINGS.temperature,
      systemPrompt:
        typeof p.systemPrompt === "string"
          ? p.systemPrompt
          : DEFAULT_SETTINGS.systemPrompt,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ChatSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

/** Build the per-request body fields from the saved settings. */
export function settingsRequestFields(): Record<string, unknown> {
  const s = loadSettings();
  const fields: Record<string, unknown> = {
    model: s.model,
    top_k: s.topK,
    temperature: s.temperature,
  };
  if (s.systemPrompt.trim()) fields.system_prompt = s.systemPrompt;
  return fields;
}
