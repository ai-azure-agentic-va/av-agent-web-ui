import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_ASSETS,
  DESIGN_SYSTEMS,
  resolveDesignSystem,
} from "./design-system";

describe("resolveDesignSystem", () => {
  it("defaults to ps when the flag is unset or blank", () => {
    expect(resolveDesignSystem(undefined)).toBe("ps");
    expect(resolveDesignSystem("")).toBe("ps");
    expect(resolveDesignSystem("   ")).toBe("ps");
  });

  it("accepts each system, ignoring case and surrounding space", () => {
    expect(resolveDesignSystem("ps")).toBe("ps");
    expect(resolveDesignSystem(" PS ")).toBe("ps");
  });

  it("fails loudly on an unknown name instead of shipping the wrong brand", () => {
    expect(() => resolveDesignSystem("pss")).toThrow(
      'NEXT_PUBLIC_DESIGN_SYSTEM="pss" is not a design system. Use one of: ps.',
    );
  });
});

describe("BRAND_ASSETS", () => {
  it("gives every system a mark and a favicon", () => {
    for (const system of DESIGN_SYSTEMS) {
      expect(BRAND_ASSETS[system].mark).toMatch(/^\/.+\.png$/);
      expect(BRAND_ASSETS[system].icon).toMatch(/^\/.+\.png$/);
    }
  });
});

// Another system would override ps's :root block, so a token missing from its
// file would silently fall back to ps red in that build. Keep the sets identical.
describe("design-system token files", () => {
  const tokens = (system: string) =>
    new Set(
      [
        ...readFileSync(
          resolve(process.cwd(), `src/styles/tokens/${system}.css`),
          "utf8",
        ).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm),
      ].map((m) => m[1]),
    );

  it("define exactly the same tokens in every system", () => {
    const [first, ...rest] = DESIGN_SYSTEMS.map(tokens);
    expect(first.size).toBeGreaterThan(30);
    for (const other of rest) {
      expect([...other].sort()).toEqual([...first].sort());
    }
  });
});
