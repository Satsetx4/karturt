import { describe, expect, it } from "vitest";
import { parseStagingMigrationMode } from "@/db/staging-migration-mode";

describe("staging migration mode", () => {
  it("defaults to a non-connecting plan", () => {
    expect(parseStagingMigrationMode([])).toBe("plan");
    expect(parseStagingMigrationMode(["--plan"])).toBe("plan");
  });

  it("requires explicit flags for database preflight and migration", () => {
    expect(parseStagingMigrationMode(["--preflight"])).toBe("preflight");
    expect(parseStagingMigrationMode(["--apply"])).toBe("apply");
  });

  it("rejects unknown, repeated, or combined modes", () => {
    for (const arguments_ of [["--unknown"], ["--plan", "--apply"], ["--apply", "--apply"]]) {
      expect(() => parseStagingMigrationMode(arguments_)).toThrow(
        "Staging migration accepts exactly one mode",
      );
    }
  });
});
