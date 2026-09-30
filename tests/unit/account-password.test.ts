import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidAccountPassword } from "../../src/lib/auth/account-password";

describe("provisioned account password format", () => {
  it("requires resident PINs to be exactly six digits", () => {
    expect(isValidAccountPassword("resident", "000000")).toBe(true);
    expect(isValidAccountPassword("resident", "12345")).toBe(false);
    expect(isValidAccountPassword("resident", "1234567")).toBe(false);
    expect(isValidAccountPassword("resident", "abc123")).toBe(false);
  });

  it("keeps official and System Admin passwords independent from resident PIN format", () => {
    expect(isValidAccountPassword("official", "long password")).toBe(true);
    expect(isValidAccountPassword("system_admin", "secure password")).toBe(true);
  });

  it("keeps the provisioning environment template aligned with the provisioning script", () => {
    const template = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    for (const name of [
      "KARTURT_ACCOUNT_TYPE",
      "KARTURT_LOGIN_IDENTIFIER",
      "KARTURT_DISPLAY_NAME",
      "KARTURT_ACCOUNT_PASSWORD",
      "KARTURT_RT_UNIT_ID",
      "KARTURT_PERSON_ID",
      "KARTURT_HOUSEHOLD_ID",
      "KARTURT_OFFICIAL_ROLE",
      "KARTURT_ASSIGNMENT_STARTS_ON",
    ]) {
      expect(template).toContain(`${name}=`);
    }
  });
});
