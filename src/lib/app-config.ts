// Public-facing app/brand name. Client-neutral by default; the real product
// name is injected at build time via NEXT_PUBLIC_APP_NAME (see the deploy
// workflows / Dockerfile). NEXT_PUBLIC_* is inlined at build, so this works in
// both server and client components.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Agent Chat";
