import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export type WorkbookAccountRole = "system_admin" | "rt_chairman" | "treasurer" | "resident";

export interface WorkbookAccountRosterEntry {
  identifier: string;
  name: string;
  role: WorkbookAccountRole;
  accountStatus: "active";
  pin: string;
}

const INVALID_MESSAGE = "Workbook roster is invalid.";
const EXPECTED_ROLE_COUNTS: Readonly<Record<WorkbookAccountRole, number>> = {
  system_admin: 1,
  rt_chairman: 1,
  treasurer: 1,
  resident: 2,
};
const PYTHON_READER_PATH = fileURLToPath(
  new URL("../../scripts/read-synthetic-account-workbook.py", import.meta.url),
);

function invalidRoster(): never {
  throw new Error(INVALID_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityKey(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("id");
}

function isWorkbookAccountRole(value: unknown): value is WorkbookAccountRole {
  return value === "system_admin" || value === "rt_chairman" || value === "treasurer" || value === "resident";
}

export function validateSyntheticAccountRoster(value: unknown): WorkbookAccountRosterEntry[] {
  if (!Array.isArray(value) || value.length !== 5) return invalidRoster();

  const identifierKeys = new Set<string>();
  const nameKeys = new Set<string>();
  const roleCounts: Record<WorkbookAccountRole, number> = {
    system_admin: 0,
    rt_chairman: 0,
    treasurer: 0,
    resident: 0,
  };
  const rows: WorkbookAccountRosterEntry[] = [];

  for (const item of value) {
    if (!isRecord(item)) return invalidRoster();
    const keys = Object.keys(item).sort();
    const hasAccountStatus = keys.length === 5 && keys[0] === "accountStatus";
    const sourceFieldsMatch = hasAccountStatus
      ? keys.join(",") === "accountStatus,identifier,name,pin,role"
      : keys.join(",") === "identifier,name,pin,role";
    if (!sourceFieldsMatch || (hasAccountStatus && item.accountStatus !== "active")) {
      return invalidRoster();
    }

    const identifier = item.identifier;
    const name = item.name;
    const role = item.role;
    const pin = item.pin;
    if (typeof identifier !== "string" || !identifier.trim() || identifier !== identifier.trim() || identifier.length > 100) return invalidRoster();
    if (typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > 160) return invalidRoster();
    if (!isWorkbookAccountRole(role)) return invalidRoster();
    if (role === "resident" && (identifier.length > 40 || !/^[-A-Z0-9/ ]+$/i.test(identifier))) return invalidRoster();
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return invalidRoster();

    const normalizedIdentifier = identityKey(identifier);
    const normalizedName = identityKey(name);
    if (!normalizedIdentifier || !normalizedName) return invalidRoster();
    if (identifierKeys.has(normalizedIdentifier) || nameKeys.has(normalizedName)) return invalidRoster();
    identifierKeys.add(normalizedIdentifier);
    nameKeys.add(normalizedName);
    roleCounts[role] += 1;

    rows.push({
      identifier,
      name,
      role,
      accountStatus: "active",
      pin,
    });
  }

  for (const role of Object.keys(EXPECTED_ROLE_COUNTS) as WorkbookAccountRole[]) {
    const expectedCount = EXPECTED_ROLE_COUNTS[role];
    if (roleCounts[role] !== expectedCount) return invalidRoster();
  }
  return rows;
}

function captureReaderOutput(workbookPath: string): Promise<string> {
  const executable = process.env.PYTHON_EXECUTABLE?.trim() || (process.platform === "win32" ? "python" : "python3");
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ["-B", PYTHON_READER_PATH, workbookPath],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(INVALID_MESSAGE));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function readSyntheticAccountWorkbook(workbookPath: string): Promise<WorkbookAccountRosterEntry[]> {
  try {
    const capturedOutput = await captureReaderOutput(workbookPath);
    const parsedRows: unknown = JSON.parse(capturedOutput);
    return validateSyntheticAccountRoster(parsedRows);
  } catch {
    throw new Error(INVALID_MESSAGE);
  }
}
