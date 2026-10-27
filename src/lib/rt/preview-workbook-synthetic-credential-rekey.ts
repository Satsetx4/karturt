import { hashPassword } from "better-auth/crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { assertR3PreviewBusinessDateTarget } from "@/db/preview-target";
import { appAccounts, authAccount, authSession, authUser, officialAssignments, rtUnits } from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";

export type PreviewWorkbookRekeyCredentials = {
  chairmanPassword: string;
  treasurerPassword: string;
  systemAdminPassword: string;
};

type PrivilegedRole = "rt_chairman" | "treasurer" | "system_admin";

const privilegedRoles = ["rt_chairman", "treasurer", "system_admin"] as const;

export function validatePreviewWorkbookRekeyCredentials(value: PreviewWorkbookRekeyCredentials) {
  if (
    !value || typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== "chairmanPassword,systemAdminPassword,treasurerPassword"
  ) {
    throw new Error("Preview workbook rekey requires exactly three privileged synthetic passwords.");
  }
  const passwords = [value.chairmanPassword, value.treasurerPassword, value.systemAdminPassword];
  if (passwords.some((password) => typeof password !== "string" || password.trim() !== password || password.length < 16 || password.length > 128)) {
    throw new Error("Synthetic privileged passwords must be 16 to 128 characters without surrounding whitespace.");
  }
  if (new Set(passwords).size !== passwords.length) {
    throw new Error("Each synthetic privileged account must use a distinct password.");
  }
}

function assertWorkbookPreviewEnvironment(releaseSha: string, environment: NodeJS.ProcessEnv) {
  if (environment.APP_ENV !== "preview" || environment.DATABASE_ENV !== "preview") {
    throw new Error("Workbook credential rekey is restricted to an explicitly labeled Preview environment.");
  }
  assertR3PreviewBusinessDateTarget(environment);
  if (!/^[0-9a-f]{40}$/.test(releaseSha) || environment.KARTURT_PREVIEW_REKEY_SHA !== releaseSha) {
    throw new Error("Workbook credential rekey must name the exact checked-out release SHA.");
  }
}

function jakartaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function rekeyPreviewWorkbookSyntheticCredentials(
  database: AppDatabase,
  credentials: PreviewWorkbookRekeyCredentials,
  releaseSha: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  assertWorkbookPreviewEnvironment(releaseSha, environment);
  validatePreviewWorkbookRekeyCredentials(credentials);

  const replacements = [
    { role: "rt_chairman", password: credentials.chairmanPassword },
    { role: "treasurer", password: credentials.treasurerPassword },
    { role: "system_admin", password: credentials.systemAdminPassword },
  ] as const;
  const passwordHashes = await Promise.all(replacements.map(({ password }) => hashPassword(password)));

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended('karturt:preview:workbook-synthetic-credential-rekey:v1', 0))`);

    const [unitCount] = await transaction.select({ value: count() }).from(rtUnits);
    const units = await transaction.select({ id: rtUnits.id }).from(rtUnits).limit(2).for("update");
    if ((unitCount?.value ?? 0) !== 1 || units.length !== 1) {
      throw new Error("Workbook credential rekey requires exactly one synthetic RT unit.");
    }
    const unitId = units[0]!.id;

    const [accountCount] = await transaction.select({ value: count() }).from(appAccounts);
    const accounts = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      accountType: appAccounts.accountType,
      status: appAccounts.status,
      rtUnitId: appAccounts.rtUnitId,
      householdId: appAccounts.householdId,
      pinHash: appAccounts.pinHash,
    }).from(appAccounts).limit(6).for("update");
    const residents = accounts.filter(({ accountType }) => accountType === "resident");
    const officials = accounts.filter(({ accountType }) => accountType === "official");
    const systemAdmins = accounts.filter(({ accountType }) => accountType === "system_admin");
    if (
      (accountCount?.value ?? 0) !== 5 || accounts.length !== 5 ||
      residents.length !== 2 || officials.length !== 2 || systemAdmins.length !== 1 ||
      accounts.some(({ status, pinHash }) => status !== "active" || !pinHash) ||
      accounts.some(({ accountType, rtUnitId }) => accountType === "system_admin" ? rtUnitId !== null : rtUnitId !== unitId) ||
      residents.some(({ householdId }) => !householdId) ||
      new Set(residents.map(({ householdId }) => householdId)).size !== 2
    ) {
      throw new Error("Workbook credential rekey requires exactly five active synthetic accounts with the expected roles.");
    }

    const authUserIds = accounts.map(({ authUserId }) => authUserId);
    const users = await transaction.select({ id: authUser.id, email: authUser.email }).from(authUser)
      .where(inArray(authUser.id, authUserIds)).limit(6).for("update");
    if (users.length !== 5 || users.some(({ email }) => !email.toLowerCase().endsWith("@accounts.karturt.invalid"))) {
      throw new Error("Workbook credential rekey requires only synthetic authentication users.");
    }

    const credentialRows = await transaction.select({
      id: authAccount.id,
      userId: authAccount.userId,
      providerId: authAccount.providerId,
      password: authAccount.password,
    }).from(authAccount).where(inArray(authAccount.userId, authUserIds)).limit(6).for("update");
    if (
      credentialRows.length !== 5 ||
      credentialRows.some(({ providerId, password }) => providerId !== "credential" || !password) ||
      new Set(credentialRows.map(({ userId }) => userId)).size !== 5
    ) {
      throw new Error("Workbook credential rekey requires one existing credential per synthetic account.");
    }
    const credentialByUser = new Map(credentialRows.map((row) => [row.userId, row]));
    for (const resident of residents) {
      if (credentialByUser.get(resident.authUserId)?.password !== resident.pinHash) {
        throw new Error("Workbook credential rekey refuses to change resident PIN login credentials.");
      }
    }

    const assignments = await transaction.select({
      appAccountId: officialAssignments.appAccountId,
      role: officialAssignments.role,
      startsOn: officialAssignments.startsOn,
      endsOn: officialAssignments.endsOn,
    }).from(officialAssignments).where(eq(officialAssignments.rtUnitId, unitId)).limit(3).for("update");
    const roleByAccount = new Map(assignments.map(({ appAccountId, role }) => [appAccountId, role]));
    const today = jakartaToday();
    if (
      assignments.length !== 2 ||
      new Set(assignments.map(({ role }) => role)).size !== 2 ||
      !privilegedRoles.slice(0, 2).every((role) => assignments.some((assignment) => (
        assignment.role === role && assignment.startsOn <= today && (assignment.endsOn === null || assignment.endsOn >= today)
      )))
    ) {
      throw new Error("Workbook credential rekey requires one active chairman and treasurer assignment.");
    }

    const privilegedAccounts = [...systemAdmins, ...officials];
    const roleById = new Map<string, PrivilegedRole>();
    for (const account of systemAdmins) roleById.set(account.id, "system_admin");
    for (const account of officials) {
      const role = roleByAccount.get(account.id);
      if (role !== "rt_chairman" && role !== "treasurer") {
        throw new Error("Workbook credential rekey found an unassigned or noncanonical official role.");
      }
      roleById.set(account.id, role);
    }
    const admin = systemAdmins[0]!;
    for (const account of privilegedAccounts) {
      const credential = credentialByUser.get(account.authUserId);
      if (!credential || credential.password === account.pinHash) {
        throw new Error("Workbook privileged login must remain separate from the account PIN.");
      }
    }

    const privilegedUserIds = privilegedAccounts.map(({ authUserId }) => authUserId);
    const sessions = await transaction.delete(authSession).where(inArray(authSession.userId, privilegedUserIds))
      .returning({ userId: authSession.userId });
    const revokedByUser = new Map(privilegedUserIds.map((userId) => [userId, 0]));
    for (const { userId } of sessions) revokedByUser.set(userId, (revokedByUser.get(userId) ?? 0) + 1);

    for (const [index, replacement] of replacements.entries()) {
      const account = privilegedAccounts.find(({ id }) => roleById.get(id) === replacement.role);
      if (!account) throw new Error("Workbook credential rekey could not resolve a privileged synthetic role.");
      const credential = credentialByUser.get(account.authUserId);
      if (!credential) throw new Error("Workbook credential rekey found a missing synthetic credential.");
      const updated = await transaction.update(authAccount).set({
        password: passwordHashes[index],
        updatedAt: new Date(),
      }).where(and(
        eq(authAccount.id, credential.id),
        eq(authAccount.userId, account.authUserId),
        eq(authAccount.providerId, "credential"),
      )).returning({ id: authAccount.id });
      if (updated.length !== 1) throw new Error("Workbook credential rekey did not update exactly one privileged credential.");

      await appendAuditEvent(transaction, {
        actorAppAccountId: admin.id,
        action: "preview.synthetic_credential.rekeyed",
        entityType: "synthetic_account",
        entityId: account.id,
        reason: null,
        context: {
          credentialRole: replacement.role,
          executionMethod: "owner_authorized_preview_cli",
          revokedSessionCount: revokedByUser.get(account.authUserId) ?? 0,
        },
      });
    }

    return { accountsRekeyed: 3 as const, sessionsRevoked: sessions.length };
  });
}
