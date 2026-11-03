// Public-facing app/brand name. Defaults to "IVY"; a deploy can override
// it via NEXT_PUBLIC_APP_NAME (see the deploy workflows / Dockerfile). An unset
// or empty value falls back to the default. NEXT_PUBLIC_* is inlined at build,
// so this works in both server and client components.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "IVY";

// One-line product description shown under the name on the welcome screen.
// Overridden the same way as APP_NAME, with the same unset/empty fallback.
export const APP_TAGLINE =
  process.env.NEXT_PUBLIC_APP_TAGLINE ||
  "An incident virtual assistant which answers from tickets, pipelines and docs.";
