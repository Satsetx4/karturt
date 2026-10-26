import { afterEach, describe, expect, it, vi } from "vitest";
import { jakartaBusinessDate } from "@/lib/officials/lifecycle";

describe("Jakarta business date", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured R3 business date only for staging or the approved Preview target", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("DATABASE_ENV", "staging");
    vi.stubEnv("KARTURT_R3_RUN_ID", "uatrun2027");
    vi.stubEnv("KARTURT_R3_AUTHORIZATION_REF", "#98/1234567890");
    vi.stubEnv("KARTURT_COMPILED_RELEASE_SHA", "a".repeat(40));
    vi.stubEnv("KARTURT_R3_BUSINESS_DATE", "2027-10-05");

    expect(jakartaBusinessDate(new Date("2026-10-05T12:00:00.000Z"))).toBe("2027-10-05");
  });

  it("allows the R3 business date for the exact isolated Preview target", () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("DATABASE_ENV", "preview");
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", "wild-glitter-41970460/br-spring-smoke-ao3apicl/ep-sparkling-rain-aospujja/karturt_production");
    vi.stubEnv("KARTURT_R3_RUN_ID", "uatrun2027");
    vi.stubEnv("KARTURT_R3_AUTHORIZATION_REF", "CP3-GO-REFERENCE");
    vi.stubEnv("KARTURT_COMPILED_RELEASE_SHA", "a".repeat(40));
    vi.stubEnv("KARTURT_R3_BUSINESS_DATE", "2027-10-05");

    expect(jakartaBusinessDate(new Date("2026-10-05T12:00:00.000Z"))).toBe("2027-10-05");
  });

  it("rejects the R3 business date for any other Preview database target", () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("DATABASE_ENV", "preview");
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "other-project/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", "wild-glitter-41970460/br-spring-smoke-ao3apicl/ep-sparkling-rain-aospujja/karturt_production");
    vi.stubEnv("KARTURT_R3_RUN_ID", "uatrun2027");
    vi.stubEnv("KARTURT_R3_AUTHORIZATION_REF", "CP3-GO-REFERENCE");
    vi.stubEnv("KARTURT_COMPILED_RELEASE_SHA", "a".repeat(40));
    vi.stubEnv("KARTURT_R3_BUSINESS_DATE", "2027-10-05");

    expect(() => jakartaBusinessDate()).toThrow("restricted to the approved Preview database target");
  });

  it.each([
    [{ APP_ENV: "production", DATABASE_ENV: "production" }],
    [{ APP_ENV: "staging", DATABASE_ENV: "production" }],
    [{ APP_ENV: "development", DATABASE_ENV: "staging" }],
  ])("rejects the R3 business-date override outside a matching staging environment %#", (labels) => {
    vi.stubEnv("APP_ENV", labels.APP_ENV);
    vi.stubEnv("DATABASE_ENV", labels.DATABASE_ENV);
    vi.stubEnv("KARTURT_R3_BUSINESS_DATE", "2027-10-05");

    expect(() => jakartaBusinessDate()).toThrow("allowed only when APP_ENV and DATABASE_ENV are staging");
  });

  it("requires a bounded R3 run identity and exact compiled release SHA", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("DATABASE_ENV", "staging");
    vi.stubEnv("KARTURT_R3_BUSINESS_DATE", "2027-10-05");

    expect(() => jakartaBusinessDate()).toThrow("requires a bounded R3 app identity");
  });

  it.each(["", "0000-01-01", "2025-10-05", "2028-10-05", "2027-02-29", "2027-2-05", "2027-10-05T00:00:00Z"])(
    "rejects invalid R3 business-date value %p",
    (value) => {
      vi.stubEnv("APP_ENV", "staging");
      vi.stubEnv("DATABASE_ENV", "staging");
      vi.stubEnv("KARTURT_R3_RUN_ID", "uatrun2027");
      vi.stubEnv("KARTURT_R3_AUTHORIZATION_REF", "#98/1234567890");
      vi.stubEnv("KARTURT_COMPILED_RELEASE_SHA", "a".repeat(40));
      vi.stubEnv("KARTURT_R3_BUSINESS_DATE", value);

      expect(() => jakartaBusinessDate(new Date("2026-10-05T12:00:00.000Z")))
        .toThrow("must be a valid date in the current or next Jakarta calendar year");
    },
  );
});
