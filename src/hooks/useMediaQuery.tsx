import { useCallback, useSyncExternalStore } from "react";

// `undefined` until the query can be evaluated (server render and hydration),
// so callers can tell "not known yet" apart from "doesn't match". Treating the
// unknown first render as `false` made the mobile history sheet flash open on
// desktop page loads.
export function useMediaQuery(query: string): boolean | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => undefined,
  );
}
