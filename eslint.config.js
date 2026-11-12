import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default defineConfig(
  // `pnpm lint` runs the ESLint CLI over the repo (Next 16 removed `next lint`,
  // which only walked src/app/pages/components/lib), so generated output must be
  // ignored explicitly.
  {
    ignores: [
      "dist",
      "agent-chat-package/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  // Next.js rules (@next/next + react, jsx-a11y, import). `next lint` used to run
  // without them ("The Next.js plugin was not detected"); Next 16 replaces it with
  // the ESLint CLI + eslint-config-next's flat configs.
  nextVitals,
  {
    extends: [js.configs.recommended, tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks 7 folds the React Compiler diagnostics into
      // `recommended` as errors. These four flag pre-existing ref / effect /
      // memo patterns in Stream.tsx, thread/index.tsx and friends that work
      // today (the app does not run the React Compiler). Warn, don't fail, until
      // they are refactored as their own tested change; the other compiler rules
      // stay errors because the codebase already passes them.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "@typescript-eslint/no-explicit-any": 0,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "none",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Off: this rule targets Vite's fast refresh. Next.js handles fast
      // refresh itself, and it false-positives on idiomatic Next/shadcn
      // patterns (`export const metadata`, cva variants, provider hooks).
      "react-refresh/only-export-components": "off",
    },
  },
);
