import { describe, expect, it } from "vitest";
import { parseProductionMigrationMode } from "@/db/production-migration-mode";

describe("Production migration mode", () => {
  it("requires an explicit Production mode for plans, preflight, and apply", () => {
    expect(parseProductionMigrationMode(["--production", "--plan"])).toBe("plan");
    expect(parseProductionMigrationMode(["--production", "--preflight"])).toBe("preflight");
    expect(parseProductionMigrationMode(["--production", "--apply"])).toBe("apply");
  });

  it("rejects an implicit mode, missing target flag, repeated flag, or mixed mode", () => {
    for (const args of [[], ["--plan"], ["--production"], ["--production", "--plan", "--apply"], ["--production", "--apply", "--apply"]]) {
      expect(() => parseProductionMigrationMode(args)).toThrow("Production migration requires exactly --production");
    }
  });
});
