import { describe, expect, it } from "vitest";
import { jakartaBusinessDate } from "../../src/lib/time/jakarta";

describe("Jakarta business date", () => {
  it("uses Asia/Jakarta at the month boundary", () => {
    expect(jakartaBusinessDate(new Date("2026-09-30T16:59:59.999Z"))).toBe("2026-09-30");
    expect(jakartaBusinessDate(new Date("2026-09-30T17:00:00.000Z"))).toBe("2026-10-01");
  });

  it("uses Asia/Jakarta at the year boundary", () => {
    expect(jakartaBusinessDate(new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01-01");
  });
});
