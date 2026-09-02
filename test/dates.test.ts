import { describe, expect, it } from "vitest";
import { isAnniversaryToday, subtractMonths } from "../worker/lib/dates";

describe("subtractMonths", () => {
  it("subtracts plain months", () => {
    expect(subtractMonths("2026-09-02", 1)).toBe("2026-08-02");
    expect(subtractMonths("2026-09-02", 13)).toBe("2025-08-02");
  });

  it("clamps day-of-month overflow to the target month's last day", () => {
    // Mar 31 - 1mo -> Feb 28 (2026 is not a leap year)
    expect(subtractMonths("2026-03-31", 1)).toBe("2026-02-28");
    // Mar 31 - 1mo -> Feb 29 in a leap year
    expect(subtractMonths("2024-03-31", 1)).toBe("2024-02-29");
  });

  it("crosses year boundaries", () => {
    expect(subtractMonths("2026-01-15", 2)).toBe("2025-11-15");
  });
});

describe("isAnniversaryToday", () => {
  it("matches a plain MM-DD anniversary", () => {
    expect(isAnniversaryToday("06-15", "2026-06-15")).toBe(true);
    expect(isAnniversaryToday("06-15", "2026-06-16")).toBe(false);
  });

  it("fires a Feb 29 anniversary on Feb 29 in a leap year", () => {
    expect(isAnniversaryToday("02-29", "2024-02-29")).toBe(true);
    expect(isAnniversaryToday("02-29", "2024-02-28")).toBe(false);
  });

  it("fires a Feb 29 anniversary on Feb 28 in a non-leap year", () => {
    expect(isAnniversaryToday("02-29", "2026-02-28")).toBe(true);
    expect(isAnniversaryToday("02-29", "2026-02-29")).toBe(false); // doesn't exist, never matches
  });
});
