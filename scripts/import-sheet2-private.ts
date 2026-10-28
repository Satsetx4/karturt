import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { appAccounts, authTwoFactor, authUser } from "@/db/schema";
import { closeDb, getDb } from "@/db/client";
import {
  assertProductionConnectionTarget,
  parseProductionTargetIdentity,
  productionDatabaseTarget,
} from "@/db/production-target";
import type { Principal } from "@/lib/auth/permissions";
import { importSheet2, type Sheet2ImportInput, type Sheet2ResidentImportRow } from "@/lib/imports/sheet2-import";

type BridgeEntry = {
  houseIdentifier: string;
  fullName: string;
  username: string;
  pin: string;
  accessRole: "chairman" | "treasurer" | "system_admin" | "resident";
  monthlyTariff: number;
  paidMonths: number[];
};

type BridgePayload = {
  version: 1;
  importBatchId: string;
  sourceSheet: "Sheet2";
  billingYear: 2026;
  dueDay: 10;
  asOfDate: "2026-10-27";
  entries: BridgeEntry[];
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_PRODUCTION_TARGET = "holy-term-22410117/br-jolly-bonus-azzd71cl/ep-empty-rain-azwe3eb3/karturt_production";
const REQUIRED_SYSTEM_ADMIN_LOGIN = "ADMIN";

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error("Required local import settings are incomplete.");
  return value;
}

function parseArguments(args: string[]) {
  let workbookPath: string | undefined;
  let ownerGo: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--workbook") workbookPath = args[++index];
    else if (args[index] === "--owner-go") ownerGo = args[++index];
    else if (args[index] === "--help") {
      process.stdout.write(
        "Use --workbook <local path> --owner-go \"IMPORT SHEET2 SHA <40-char SHA> TARGET <project/branch/endpoint/database> RT <RT UUID> BATCH <batch UUID>\" after separate owner GO. Set the expected release SHA, Production target IDs, database URL, RT and active ADMIN account IDs, stable batch UUID, and separate official credentials in ignored .env.sheet2-import.local.\n",
      );
      process.exit(0);
    } else throw new Error("Command arguments are invalid.");
  }
  if (!workbookPath || !ownerGo) throw new Error("Workbook path and exact owner GO confirmation are required.");
  return { workbookPath, ownerGo };
}

function readSheet2InMemory(workbookPath: string): BridgePayload {
  const python = process.env.SHEET2_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
  const nonce = randomUUID().replaceAll("-", "");
  const child = spawnSync(python, [
    resolve(process.cwd(), "scripts", "validate_sheet2_workbook.py"),
    "--_emit-private-import-payload",
    workbookPath,
  ], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? "production",
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      WINDIR: process.env.WINDIR ?? "",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      KARTURT_SHEET2_IMPORT_BRIDGE: "1",
      KARTURT_SHEET2_IMPORT_PARENT_PID: String(process.pid),
      KARTURT_SHEET2_IMPORT_BRIDGE_NONCE: nonce,
      KARTURT_SHEET2_IMPORT_BATCH_ID: required("SHEET2_IMPORT_BATCH_ID"),
    },
  });
  if (child.error || child.status !== 0 || !child.stdout) {
    throw new Error("The local Sheet2 source failed validation; no workbook values were logged.");
  }
  let value: unknown;
  try {
    value = JSON.parse(child.stdout);
  } catch {
    throw new Error("The local Sheet2 payload could not be read; no workbook values were logged.");
  }
  if (!value || typeof value !== "object") throw new Error("The local Sheet2 payload is invalid.");
  const payload = value as Partial<BridgePayload>;
  if (
    payload.version !== 1 || payload.sourceSheet !== "Sheet2" || payload.billingYear !== 2026 ||
    payload.dueDay !== 10 || payload.asOfDate !== "2026-10-27" ||
    !Array.isArray(payload.entries) || payload.entries.length !== 73
  ) throw new Error("The local Sheet2 payload does not match the approved import contract.");
  return payload as BridgePayload;
}

function currentGitSha(): string {
  const safeGitEnvironment = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    WINDIR: process.env.WINDIR ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
    env: safeGitEnvironment,
  });
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
    windowsHide: true,
    env: safeGitEnvironment,
  });
  const sha = head.stdout?.trim().toLowerCase();
  if (head.error || head.status !== 0 || !sha || !/^[0-9a-f]{40}$/.test(sha) ||
      status.error || status.status !== 0 || status.stdout?.trim()) {
    throw new Error("The importer requires a clean checkout with a verifiable commit SHA.");
  }
  if (required("SHEET2_IMPORT_EXPECTED_RELEASE_SHA").toLowerCase() !== sha) {
    throw new Error("The checked-out commit does not match the owner-authorized release SHA.");
  }
  return sha;
}

async function verifyProductionSession() {
  if (process.env.APP_ENV !== "production" || process.env.DATABASE_ENV !== "production") {
    throw new Error("The importer requires explicitly labeled Production runtime settings.");
  }
  const target = parseProductionTargetIdentity(process.env);
  const targetKey = [target.projectId, target.branchId, target.endpointId, target.database].join("/");
  if (targetKey !== REQUIRED_PRODUCTION_TARGET) throw new Error("Configured Production database identity does not match the reviewed target.");
  const guardedTarget = assertProductionConnectionTarget(required("DATABASE_URL"), "runtime", process.env);
  if ([guardedTarget.projectId, guardedTarget.branchId, guardedTarget.endpointId, guardedTarget.database].join("/") !== targetKey) {
    throw new Error("The Production connection URL does not match the reviewed target.");
  }
  if (target.database !== productionDatabaseTarget.database) throw new Error("The Production database name does not match the runtime policy.");

  const database = getDb();
  const result = await database.execute(sql`
    SELECT current_database() AS database_name,
      current_user AS role_name,
      current_setting('neon.branch_id', true) AS neon_branch_id,
      current_setting('neon.endpoint_id', true) AS neon_endpoint_id
  `);
  const rows = (result as unknown as { rows?: Array<{
    database_name: string;
    role_name: string;
    neon_branch_id: string | null;
    neon_endpoint_id: string | null;
  }> }).rows;
  const session = rows?.[0];
  if (
    session?.database_name !== target.database || session.role_name !== productionDatabaseTarget.runtimeRole ||
    (session.neon_branch_id !== null && session.neon_branch_id !== undefined && session.neon_branch_id !== target.branchId) ||
    (session.neon_endpoint_id !== null && session.neon_endpoint_id !== undefined && session.neon_endpoint_id !== target.endpointId)
  ) throw new Error("The connected Production database session did not match the reviewed target.");
  return { database, targetKey };
}

function mapRows(entries: BridgeEntry[]): Sheet2ResidentImportRow[] {
  return entries.map((entry) => {
    const paidMonths = entry.paidMonths;
    if (
      !Array.isArray(paidMonths) || paidMonths.some((month) => !Number.isInteger(month) || month < 1 || month > 12) ||
      (paidMonths.length > 0 && paidMonths.some((month, index) => index > 0 && month !== paidMonths[index - 1]! + 1))
    ) throw new Error("A Sheet2 payment range is invalid.");
    return {
      houseNumber: entry.houseIdentifier,
      fullName: entry.fullName,
      username: entry.username,
      pin: entry.pin,
      monthlyAmount: entry.monthlyTariff,
      paidFromMonth: paidMonths[0] ?? null,
      paidThroughMonth: paidMonths.at(-1) ?? null,
      ...(entry.accessRole === "chairman" ? { officialRole: "rt_chairman" as const } : {}),
      ...(entry.accessRole === "treasurer" ? { officialRole: "treasurer" as const } : {}),
    };
  });
}

async function main() {
  const { workbookPath, ownerGo } = parseArguments(process.argv.slice(2));
  const rtUnitId = required("SHEET2_IMPORT_RT_UNIT_ID");
  const importBatchId = required("SHEET2_IMPORT_BATCH_ID");
  const actorAccountId = required("SHEET2_IMPORT_ACTOR_ACCOUNT_ID");
  if (!UUID_V4.test(rtUnitId) || !UUID_V4.test(importBatchId) || !UUID_V4.test(actorAccountId)) {
    throw new Error("Local target or batch identifiers are invalid.");
  }
  const sha = currentGitSha();
  const { database, targetKey } = await verifyProductionSession();
  const requiredOwnerPhrase = `IMPORT SHEET2 SHA ${sha} TARGET ${targetKey} RT ${rtUnitId} BATCH ${importBatchId}`;
  if (ownerGo !== requiredOwnerPhrase) throw new Error("Owner GO confirmation does not match this SHA, target, and batch.");

  const activeAdmins = await database.select({
    id: appAccounts.id,
    authUserId: appAccounts.authUserId,
    loginIdentifier: appAccounts.loginIdentifier,
    rtUnitId: appAccounts.rtUnitId,
    householdId: appAccounts.householdId,
    personId: appAccounts.personId,
    twoFactorEnabled: authUser.twoFactorEnabled,
    twoFactorVerified: authTwoFactor.verified,
  }).from(appAccounts)
    .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
    .leftJoin(authTwoFactor, eq(authTwoFactor.userId, authUser.id))
    .where(and(
      eq(appAccounts.accountType, "system_admin"),
      eq(appAccounts.status, "active"),
    )).limit(2);
  const [actorAccount] = activeAdmins;
  if (
    activeAdmins.length !== 1 || actorAccount?.id !== actorAccountId ||
    actorAccount.loginIdentifier !== REQUIRED_SYSTEM_ADMIN_LOGIN ||
    actorAccount.rtUnitId !== null || actorAccount.householdId !== null || actorAccount.personId !== null ||
    actorAccount.twoFactorEnabled !== true || actorAccount.twoFactorVerified !== true
  ) throw new Error("The sole active global ADMIN account and its verified MFA factor could not be verified.");

  const actor: Principal = {
    authUserId: actorAccount.authUserId,
    appAccountId: actorAccount.id,
    role: "system_admin",
    rtUnitId: actorAccount.rtUnitId,
    householdId: actorAccount.householdId,
    personId: actorAccount.personId,
  };
  const payload = readSheet2InMemory(workbookPath);
  if (payload.importBatchId !== importBatchId) throw new Error("The workbook batch identifier does not match local settings.");
  const residents = mapRows(payload.entries);

  const input: Sheet2ImportInput = {
    rtUnitId,
    importBatchId,
    actor,
    residents,
    officials: [
      {
        role: "rt_chairman",
        loginIdentifier: required("SHEET2_CHAIRMAN_LOGIN"),
        password: required("SHEET2_CHAIRMAN_PASSWORD"),
      },
      {
        role: "treasurer",
        loginIdentifier: required("SHEET2_TREASURER_LOGIN"),
        password: required("SHEET2_TREASURER_PASSWORD"),
      },
    ],
  };
  const result = await importSheet2(database, input);
  process.stdout.write(`${JSON.stringify({
    idempotentReplay: result.idempotentReplay,
    householdCount: result.householdCount,
    residentAccountCount: result.residentAccountCount,
    officialAccountCount: result.officialAccountCount,
    createdAccountCount: result.createdAccountCount,
    reusedSystemAdminAccountCount: result.reusedSystemAdminAccountCount,
    totalImportAccountCount: result.totalImportAccountCount,
    monthlyDueCount: result.monthlyDueCount,
    openingBalanceCount: result.openingBalanceCount,
    arrearsCount: result.arrearsCount,
    futureUnpaidCount: result.futureUnpaidCount,
  })}\n`);
}

main()
  .catch(() => {
    process.stderr.write("Sheet2 import failed safely. No workbook rows, PINs, passwords, database URL, or SQL details were logged.\n");
    process.exitCode = 1;
  })
  .finally(async () => closeDb());
