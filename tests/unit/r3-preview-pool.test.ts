import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabasePoolConfig } from "@/db/pool";
import { getR3PoolIdentity } from "@/db/client";

const previewTarget = "misty-king-95262980/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview";
const productionTarget = "wild-glitter-41970460/br-spring-smoke-ao3apicl/ep-sparkling-rain-aospujja/karturt_production";
const previewUrl = "postgresql://karturt_preview_runtime:test-only@ep-calm-glade-b3rpal01.c-3.ap-southeast-1.aws.neon.tech/karturt_preview?sslmode=verify-full";

function setPreviewTarget(target = previewTarget) {
  vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", target);
  vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", productionTarget);
}

afterEach(() => vi.unstubAllEnvs());

describe("R3 Preview pool identity", () => {
  it("does not turn a date-only Preview run id into a race-worker pool", () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("DATABASE_ENV", "preview");
    setPreviewTarget();
    vi.stubEnv("KARTURT_R3_RUN_ID", "cp3preview261026");

    expect(getR3PoolIdentity()).toBeUndefined();
  });

  it("accepts bounded race workers only for the exact isolated Preview target", () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("DATABASE_ENV", "preview");
    setPreviewTarget();
    vi.stubEnv("KARTURT_R3_RUN_ID", "cp3preview261026");
    vi.stubEnv("KARTURT_R3_SCENARIO", "R3-RACE-REQUEST");
    vi.stubEnv("KARTURT_R3_WORKER_TAG", "a");
    vi.stubEnv("KARTURT_COMPILED_RELEASE_SHA", "a".repeat(40));

    expect(getR3PoolIdentity()).toEqual({
      applicationName: "krt-r3-cp3preview261026-R3-RACE-REQUEST-a",
      max: 1,
    });
  });

  it("rejects a Preview race-worker identity for another project", () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("DATABASE_ENV", "preview");
    setPreviewTarget("other-project/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview");
    vi.stubEnv("KARTURT_R3_RUN_ID", "cp3preview261026");
    vi.stubEnv("KARTURT_R3_SCENARIO", "R3-RACE-REQUEST");
    vi.stubEnv("KARTURT_R3_WORKER_TAG", "a");
    vi.stubEnv("KARTURT_COMPILED_RELEASE_SHA", "a".repeat(40));

    expect(() => getR3PoolIdentity()).toThrow("approved Preview database target");
  });

  it("rejects an incomplete race-worker identity instead of falling back to a normal pool", () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("DATABASE_ENV", "preview");
    setPreviewTarget();
    vi.stubEnv("KARTURT_R3_RUN_ID", "cp3preview261026");
    vi.stubEnv("KARTURT_R3_SCENARIO", "R3-RACE-REQUEST");

    expect(() => getR3PoolIdentity()).toThrow("one bounded race scenario");
  });

  it("allows a one-connection Preview race pool with its verified target and role", () => {
    vi.stubEnv("APP_ENV", "preview");
    setPreviewTarget();

    const config = createDatabasePoolConfig(
      previewUrl,
      "preview",
      "runtime",
      1,
      "krt-r3-cp3preview261026-R3-RACE-REQUEST-a",
    );

    expect(config.application_name).toBe("krt-r3-cp3preview261026-R3-RACE-REQUEST-a");
    expect(config.max).toBe(1);
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true, minVersion: "TLSv1.2" });
  });

  it("rejects Preview race pool names unless the exact approved target is configured", () => {
    vi.stubEnv("APP_ENV", "preview");
    setPreviewTarget("other-project/br-raspy-flower-b3nu1qhn/ep-calm-glade-b3rpal01/karturt_preview");

    expect(() => createDatabasePoolConfig(
      previewUrl,
      "preview",
      "runtime",
      1,
      "krt-r3-cp3preview261026-R3-RACE-REQUEST-a",
    )).toThrow("approved Preview database target");
  });

  it("rejects a Preview race pool wider than one connection", () => {
    vi.stubEnv("APP_ENV", "preview");
    setPreviewTarget();

    expect(() => createDatabasePoolConfig(
      previewUrl,
      "preview",
      "runtime",
      2,
      "krt-r3-cp3preview261026-R3-RACE-REQUEST-a",
    )).toThrow("one-connection");
  });
});
