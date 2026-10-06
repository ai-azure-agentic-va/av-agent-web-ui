// Ambient declaration for plain (non-module) CSS side-effect imports,
// e.g. `import "./globals.css"`. Next.js only ships declarations for
// `*.module.css`, and TypeScript >= 5.9 (ts2882) errors on unresolvable
// side-effect imports. The more specific `*.module.css` pattern from
// next/types still takes precedence over this wildcard.
declare module "*.css";
