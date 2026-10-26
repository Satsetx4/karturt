import { randomBytes, randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AccountType } from "@/db/schema";
import { isValidAccountPassword } from "@/lib/auth/account-password";

function generatedValue(length: number) {
  return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function generatedPin() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

describe("account password policy", () => {
  it("accepts only six-digit resident PINs", () => {
    const validPin = generatedPin();
    const shortCandidate = generatedValue(5);
    const longCandidate = generatedValue(7);
    const nonNumericCandidate = `${String.fromCharCode(randomInt(65, 91))}${generatedValue(5)}`;

    expect(isValidAccountPassword("resident", validPin)).toBe(true);
    expect(isValidAccountPassword("resident", shortCandidate)).toBe(false);
    expect(isValidAccountPassword("resident", longCandidate)).toBe(false);
    expect(isValidAccountPassword("resident", nonNumericCandidate)).toBe(false);
  });

  it("requires 16 to 128 characters for official and System Admin passwords", () => {
    const privilegedTypes: AccountType[] = ["official", "system_admin"];
    const minimumCandidate = generatedValue(16);
    const maximumCandidate = generatedValue(128);
    const shortCandidate = generatedValue(15);
    const longCandidate = generatedValue(129);

    for (const type of privilegedTypes) {
      expect(isValidAccountPassword(type, minimumCandidate)).toBe(true);
      expect(isValidAccountPassword(type, maximumCandidate)).toBe(true);
      expect(isValidAccountPassword(type, shortCandidate)).toBe(false);
      expect(isValidAccountPassword(type, longCandidate)).toBe(false);
    }
  });
});
