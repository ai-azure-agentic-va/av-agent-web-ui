// Which design system this build ships. Chosen at BUILD time with
// NEXT_PUBLIC_DESIGN_SYSTEM (inlined by Next.js into server and client
// bundles, like APP_NAME), so one image carries one look:
//
//   ps  — black ink, a red signal, the IVY leaf (the default)
//   ets — dark-blue ink, orange for what is live, blue for what is sourced,
//         the ETS three-boomerang mark
//
// The tokens live in src/styles/tokens/<name>.css; the root layout stamps
// data-design-system on <html> and the matching token block takes over.
// Every component reads tokens, never a system name, so a third system is a
// new token file plus an entry below.

export const DESIGN_SYSTEMS = ["ps", "ets"] as const;
export type DesignSystem = (typeof DESIGN_SYSTEMS)[number];

/**
 * Normalises a NEXT_PUBLIC_DESIGN_SYSTEM value. Unset or blank means "ps".
 * Anything else that isn't a known system throws, so a typo fails the build
 * instead of quietly shipping the wrong brand.
 */
export function resolveDesignSystem(raw: string | undefined): DesignSystem {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "ps";
  if ((DESIGN_SYSTEMS as readonly string[]).includes(value)) {
    return value as DesignSystem;
  }
  throw new Error(
    `NEXT_PUBLIC_DESIGN_SYSTEM="${raw}" is not a design system. ` +
      `Use one of: ${DESIGN_SYSTEMS.join(", ")}.`,
  );
}

// Must stay a literal `process.env.NEXT_PUBLIC_…` read so Next.js inlines it.
export const DESIGN_SYSTEM: DesignSystem = resolveDesignSystem(
  process.env.NEXT_PUBLIC_DESIGN_SYSTEM,
);

type BrandAssets = {
  /** Square transparent mark: header, empty state and the answer gutter. */
  mark: string;
  /** Favicon. */
  icon: string;
};

export const BRAND_ASSETS: Record<DesignSystem, BrandAssets> = {
  ps: { mark: "/logo.png", icon: "/icon.png" },
  ets: { mark: "/ets/mark.png", icon: "/ets/icon.png" },
};

export const BRAND: BrandAssets = BRAND_ASSETS[DESIGN_SYSTEM];
