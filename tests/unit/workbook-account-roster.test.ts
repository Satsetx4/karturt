import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  validateSyntheticAccountRoster,
  type WorkbookAccountRole,
} from "../fixtures/workbook-account-roster";

const ROLES: WorkbookAccountRole[] = ["system_admin", "rt_chairman", "treasurer", "resident", "resident"];

function makeRoster() {
  const token = randomUUID().replace(/-/g, "");
  const residentPin = String(100_000 + (Number.parseInt(token.slice(0, 6), 16) % 900_000));
  return ROLES.map((role, index) => ({
    identifier: `TEST-${token}-${index}`,
    name: `Test Person ${token}-${index}`,
    role,
    pin: role === "resident" ? residentPin : String(100_000 + ((index * 31_337 + Number.parseInt(token.slice(6, 12), 16)) % 900_000)),
  }));
}

describe("synthetic workbook account roster validation", () => {
  it("preserves every source row, sets active status, and allows repeated PINs", () => {
    const sourceRows = makeRoster();
    const residentRows = sourceRows.filter((row) => row.role === "resident");
    const roster = validateSyntheticAccountRoster(sourceRows);

    const preserved = roster.length === sourceRows.length
      && roster.every((row, index) => {
        const source = sourceRows[index];
        return source !== undefined
          && row.identifier === source.identifier
          && row.name === source.name
          && row.pin === source.pin
          && row.role === source.role
          && row.accountStatus === "active";
      });
    const repeatedResidentPinKept = residentRows.length === 2
      && residentRows[0]?.pin === residentRows[1]?.pin
      && roster.filter((row) => row.role === "resident").length === 2;

    expect(preserved && repeatedResidentPinKept).toBe(true);
  });

  it("rejects invalid rosters with a generic message", () => {
    const sourceRows = makeRoster();
    const sourceIdentifier = sourceRows[0]!.identifier;
    sourceRows[0] = { ...sourceRows[0]!, role: "unmapped" as WorkbookAccountRole };

    let message = "";
    try {
      validateSyntheticAccountRoster(sourceRows);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toBe("Workbook roster is invalid.");
    expect(message.includes(sourceIdentifier)).toBe(false);
  });

  it("rejects duplicate identifiers and names without returning field values", () => {
    const duplicateIdentifierRows = makeRoster();
    duplicateIdentifierRows[1] = {
      ...duplicateIdentifierRows[1]!,
      identifier: duplicateIdentifierRows[0]!.identifier,
    };
    const duplicateNameRows = makeRoster();
    duplicateNameRows[1] = {
      ...duplicateNameRows[1]!,
      name: duplicateNameRows[0]!.name,
    };

    const errorMessages = [duplicateIdentifierRows, duplicateNameRows].map((rows) => {
      try {
        validateSyntheticAccountRoster(rows);
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : "";
      }
    });

    expect(errorMessages.every((message) => message === "Workbook roster is invalid.")).toBe(true);
  });
});
