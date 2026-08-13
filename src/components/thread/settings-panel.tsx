"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  ChatSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from "@/lib/settings";

type Defaults = {
  models: string[];
  model: string;
  topK: number;
  temperature: number;
  systemPrompt: string;
};

const FALLBACK_DEFAULTS: Defaults = {
  models: ["gpt-4.1"],
  model: "gpt-4.1",
  topK: DEFAULT_SETTINGS.topK,
  temperature: DEFAULT_SETTINGS.temperature,
  systemPrompt: "",
};

export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [defaults, setDefaults] = useState<Defaults>(FALLBACK_DEFAULTS);

  useEffect(() => {
    if (!open) return;
    const current = loadSettings();
    setDraft(current);
    let cancelled = false;
    fetch("/api/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const def: Defaults = {
          models:
            Array.isArray(d.models) && d.models.length
              ? d.models
              : [d.model || "gpt-4.1"],
          model: d.model || "gpt-4.1",
          topK: Number.isFinite(d.top_k) ? d.top_k : FALLBACK_DEFAULTS.topK,
          temperature: Number.isFinite(d.temperature)
            ? d.temperature
            : FALLBACK_DEFAULTS.temperature,
          systemPrompt:
            typeof d.system_prompt === "string" ? d.system_prompt : "",
        };
        setDefaults(def);
        // Pre-fill the system prompt with the real backend prompt when the user
        // hasn't set a custom one yet.
        setDraft((prev) =>
          prev.systemPrompt ? prev : { ...prev, systemPrompt: def.systemPrompt },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const reset = () =>
    setDraft({
      model: defaults.model,
      topK: defaults.topK,
      temperature: defaults.temperature,
      systemPrompt: defaults.systemPrompt,
    });

  const confirm = () => {
    saveSettings(draft);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border-border flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-foreground text-base font-semibold">
            Settings panel
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="border-border text-muted-foreground hover:text-foreground rounded-md border p-1"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          {/* Model */}
          <div>
            <Label className="text-sm font-medium">Model</Label>
            <select
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              className="border-border bg-background text-foreground mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
            >
              {defaults.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-1 text-xs">
              Azure OpenAI deployment to use for generation.
            </p>
          </div>

          {/* Top K */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Top K (Retrieved Chunks)
              </Label>
              <span className="border-border text-foreground rounded-md border px-2 py-0.5 text-xs">
                {draft.topK}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={draft.topK}
              onChange={(e) =>
                setDraft({ ...draft, topK: Number(e.target.value) })
              }
              className="accent-primary mt-2 w-full"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Number of chunks to retrieve from AI Search.
            </p>
          </div>

          {/* Temperature */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Temperature</Label>
              <span className="border-border text-foreground rounded-md border px-2 py-0.5 text-xs">
                {draft.temperature.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature}
              onChange={(e) =>
                setDraft({ ...draft, temperature: Number(e.target.value) })
              }
              className="accent-primary mt-2 w-full"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              LLM randomness. Lower = more deterministic, higher = more creative.
            </p>
          </div>

          {/* System Prompt */}
          <div>
            <Label className="text-sm font-medium">System Prompt</Label>
            <Textarea
              value={draft.systemPrompt}
              onChange={(e) =>
                setDraft({ ...draft, systemPrompt: e.target.value })
              }
              rows={6}
              className="mt-1.5 text-sm"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Instructions for the LLM. Edit to change behavior.
            </p>
          </div>
        </div>

        <div className="border-border flex items-center justify-between border-t p-4">
          <Button
            variant="outline"
            onClick={reset}
          >
            Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button onClick={confirm}>Confirm</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
