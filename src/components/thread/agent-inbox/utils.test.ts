import { describe, expect, it } from "vitest";
import { unknownToPrettyDate } from "./utils";

describe("unknownToPrettyDate", () => {
  it("formats ISO 8601 dates and Date objects", () => {
    expect(unknownToPrettyDate("2026-03-14")).toBe("03/14/2026");
    expect(unknownToPrettyDate("2026-03-14T10:12:00")).toBe(
      "03/14/2026 10:12 AM",
    );
    expect(unknownToPrettyDate(new Date(2026, 2, 14, 15, 5))).toBe(
      "03/14/2026 03:05 PM",
    );
  });

  // Tool arguments are mostly words and counts. `new Date()` happily reads
  // these as dates, which is how "VPN Client 6.2" showed as 06/02/2001.
  it("leaves values that only look like dates to Date() alone", () => {
    for (const value of [
      "VPN Client 6.2",
      "Network Operations 4",
      "INC0004821",
      "6.2",
      5,
      0,
      true,
      null,
      undefined,
      { at: "2026-03-14" },
    ]) {
      expect(unknownToPrettyDate(value)).toBeUndefined();
    }
  });

  it("rejects impossible dates", () => {
    expect(unknownToPrettyDate("2026-13-45")).toBeUndefined();
  });
});
