import { describe, expect, it } from "vitest";
import {
  hasNoStagingMigrationGrantOptions,
  hasRequiredMigrationPublicSchemaPrivileges,
} from "@/db/migration-role-policy";

describe("staging migration role public-schema access", () => {
  it("requires both effective USAGE and CREATE", () => {
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: true, create: true })).toBe(true);
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: true, create: false })).toBe(false);
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: false, create: true })).toBe(false);
    expect(hasRequiredMigrationPublicSchemaPrivileges({ usage: false, create: false })).toBe(false);
  });
});

describe("staging migration role grant options", () => {
  it("rejects any grant option on the target database or migration schemas", () => {
    expect(hasNoStagingMigrationGrantOptions(0)).toBe(true);
    expect(hasNoStagingMigrationGrantOptions(1)).toBe(false);
    expect(hasNoStagingMigrationGrantOptions(-1)).toBe(false);
  });
});
