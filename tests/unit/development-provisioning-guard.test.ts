import { describe, expect, it } from "vitest";
import { assertDevelopmentProvisioningEnvironment } from "@/db/development-provisioning-guard";

describe("development setup script environment guard", () => {
  it("allows only a consistently labeled development target", () => {
    expect(() => assertDevelopmentProvisioningEnvironment({
      appEnv: "development",
      databaseEnv: "development",
    })).not.toThrow();
  });

  it.each([
    { appEnv: "staging", databaseEnv: "staging" },
    { appEnv: "production", databaseEnv: "production" },
    { appEnv: "development", databaseEnv: "staging" },
  ])("refuses $appEnv app / $databaseEnv database setup", (environment) => {
    expect(() => assertDevelopmentProvisioningEnvironment(environment))
      .toThrow("development-only setup script");
  });
});
