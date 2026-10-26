import { hashPassword } from "better-auth/crypto";
import { and, count, eq, getTableName, inArray, sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AppDatabase } from "@/db/client";
import { assertR3PreviewBusinessDateTarget } from "@/db/preview-target";
import {
  appAccounts,
  authAccount,
  authSession,
  authUser,
  officialAssignments,
  rtUnits,
  schema,
} from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import {
  canonicalR2SyntheticFixture,
  canonicalR2SyntheticFixtureTableCounts,
} from "@/lib/rt/r2-staging-fixture";

export type PreviewSyntheticRekeyCredentials = {
  residentPin: string;
  chairmanPassword: string;
  treasurerPassword: string;
  systemAdminPassword: string;
};

type SyntheticCredentialRole = "resident" | "rt_chairman" | "treasurer" | "system_admin";

const canonicalLogins = [
  canonicalR2SyntheticFixture.residentLogin,
  canonicalR2SyntheticFixture.chairmanLogin,
  canonicalR2SyntheticFixture.treasurerLogin,
  canonicalR2SyntheticFixture.systemAdminLogin,
] as const;

const expectedRoles: Readonly<Record<string, SyntheticCredentialRole>> = {
  [canonicalR2SyntheticFixture.residentLogin]: "resident",
  [canonicalR2SyntheticFixture.chairmanLogin]: "rt_chairman",
  [canonicalR2SyntheticFixture.treasurerLogin]: "treasurer",
  [canonicalR2SyntheticFixture.systemAdminLogin]: "system_admin",
};

export function validatePreviewSyntheticRekeyCredentials(value: PreviewSyntheticRekeyCredentials) {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "chairmanPassword,residentPin,systemAdminPassword,treasurerPassword") {
    throw new Error("Preview rekey requires exactly the four canonical synthetic credentials.");
  }
  if (typeof value.residentPin !== "string" || !/^\d{6}$/.test(value.residentPin)) {
    throw new Error("Resident credential must be a six-digit synthetic PIN.");
  }
  const officialPasswords = [value.chairmanPassword, value.treasurerPassword, value.systemAdminPassword];
  if (officialPasswords.some((password) => typeof password !== "string" || password.trim() !== password || password.length < 16 || password.length > 128)) {
    throw new Error("Synthetic official passwords must be 16 to 128 characters without surrounding whitespace.");
  }
  if (new Set(officialPasswords).size !== officialPasswords.length) {
    throw new Error("Each synthetic official account must use a distinct password.");
  }
}

function assertPreviewRekeyEnvironment(releaseSha: string, environment: NodeJS.ProcessEnv) {
  if (environment.APP_ENV !== "preview" || environment.DATABASE_ENV !== "preview") {
    throw new Error("Synthetic credential rekey is restricted to an explicitly labeled Preview environment.");
  }
  assertR3PreviewBusinessDateTarget(environment);
  if (!/^[0-9a-f]{40}$/.test(releaseSha) || environment.KARTURT_PREVIEW_REKEY_SHA !== releaseSha) {
    throw new Error("Preview synthetic rekey must name the exact checked-out release SHA.");
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

function assertCanonicalPreviewIdentity(
  rtRows: Array<{ id: string; code: string; rwCode: string; name: string; village: string }>,
  accounts: Array<{
    id: string;
    authUserId: string;
    accountType: string;
    loginIdentifier: string;
    rtUnitId: string | null;
    status: string;
  }>,
) {
  const expected = canonicalR2SyntheticFixture;
  if (
    rtRows.length !== 1 ||
    rtRows[0]?.code !== expected.rt.code ||
    rtRows[0]?.rwCode !== expected.rt.rwCode ||
    rtRows[0]?.name !== expected.rt.name ||
    rtRows[0]?.village !== expected.rt.village
  ) {
    throw new Error("Preview rekey target does not contain exactly the canonical synthetic RT.");
  }

  const unitId = rtRows[0].id;
  const accountsByLogin = new Map(accounts.map((account) => [account.loginIdentifier, account]));
  if (accounts.length !== 4 || new Set(accounts.map(({ loginIdentifier }) => loginIdentifier)).size !== 4) {
    throw new Error("Preview rekey target does not contain exactly the four canonical synthetic accounts.");
  }
  for (const loginIdentifier of canonicalLogins) {
    const account = accountsByLogin.get(loginIdentifier);
    const expectedAccountType = loginIdentifier === expected.systemAdminLogin ? "system_admin" : loginIdentifier === expected.residentLogin ? "resident" : "official";
    const expectedRtUnitId = expectedAccountType === "system_admin" ? null : unitId;
    if (!account || account.accountType !== expectedAccountType || account.rtUnitId !== expectedRtUnitId || account.status !== "active") {
      throw new Error("Preview rekey found a missing, inactive, or noncanonical synthetic account.");
    }
  }
  return { unitId, accountsByLogin };
}

async function assertCanonicalPreviewFixtureCounts(database: AppDatabase) {
  const tableCounts = await Promise.all((Object.values(schema) as AnyPgTable[]).map(async (table) => {
    const [row] = await database.select({ value: count() }).from(table);
    return [getTableName(table), row?.value ?? 0] as const;
  }));
  const actual = Object.fromEntries(tableCounts);
  const unexpected = Object.entries(canonicalR2SyntheticFixtureTableCounts).filter(([tableName, expected]) => (
    tableName !== "session" && actual[tableName] !== expected
  ));
  if (
    Object.keys(actual).length !== Object.keys(canonicalR2SyntheticFixtureTableCounts).length ||
    unexpected.length > 0
  ) {
    throw new Error("Preview rekey is restricted to the unchanged canonical synthetic fixture before UAT.");
  }
}

export async function rekeyPreviewSyntheticCredentials(
  database: AppDatabase,
  credentials: PreviewSyntheticRekeyCredentials,
  releaseSha: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  assertPreviewRekeyEnvironment(releaseSha, environment);
  validatePreviewSyntheticRekeyCredentials(credentials);

  const replacements = [
    { loginIdentifier: canonicalR2SyntheticFixture.residentLogin, password: credentials.residentPin },
    { loginIdentifier: canonicalR2SyntheticFixture.chairmanLogin, password: credentials.chairmanPassword },
    { loginIdentifier: canonicalR2SyntheticFixture.treasurerLogin, password: credentials.treasurerPassword },
    { loginIdentifier: canonicalR2SyntheticFixture.systemAdminLogin, password: credentials.systemAdminPassword },
  ] as const;
  const passwordHashes = await Promise.all(replacements.map(({ password }) => hashPassword(password)));

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended('karturt:preview:canonical-synthetic-credential-rekey:v1', 0))`);
    await assertCanonicalPreviewFixtureCounts(transaction as unknown as AppDatabase);

    const [rtCount] = await transaction.select({ value: count() }).from(rtUnits);
    const rtRows = await transaction.select({
      id: rtUnits.id,
      code: rtUnits.code,
      rwCode: rtUnits.rwCode,
      name: rtUnits.name,
      village: rtUnits.village,
    }).from(rtUnits).limit(2).for("update");
    if ((rtCount?.value ?? 0) !== 1) throw new Error("Preview rekey target must contain only one synthetic RT.");

    const [accountCount] = await transaction.select({ value: count() }).from(appAccounts);
    const accounts = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      accountType: appAccounts.accountType,
      loginIdentifier: appAccounts.loginIdentifier,
      rtUnitId: appAccounts.rtUnitId,
      status: appAccounts.status,
    }).from(appAccounts).where(inArray(appAccounts.loginIdentifier, canonicalLogins)).limit(5).for("update");
    if ((accountCount?.value ?? 0) !== 4) throw new Error("Preview rekey target must contain only the four canonical synthetic accounts.");

    const { accountsByLogin } = assertCanonicalPreviewIdentity(rtRows, accounts);
    const targetAccounts = replacements.map(({ loginIdentifier }) => accountsByLogin.get(loginIdentifier)!);
    const authUserIds = targetAccounts.map(({ authUserId }) => authUserId);
    const userRows = await transaction.select({ id: authUser.id, email: authUser.email }).from(authUser)
      .where(inArray(authUser.id, authUserIds)).limit(5).for("update");
    if (userRows.length !== 4 || userRows.some(({ email }) => !email.toLowerCase().endsWith("@accounts.karturt.invalid"))) {
      throw new Error("Preview rekey target does not contain only synthetic authentication users.");
    }

    const officialAccountIds = [
      accountsByLogin.get(canonicalR2SyntheticFixture.chairmanLogin)!.id,
      accountsByLogin.get(canonicalR2SyntheticFixture.treasurerLogin)!.id,
    ];
    const today = jakartaToday();
    const assignments = await transaction.select({
      appAccountId: officialAssignments.appAccountId,
      appAccountType: officialAssignments.appAccountType,
      role: officialAssignments.role,
      startsOn: officialAssignments.startsOn,
      endsOn: officialAssignments.endsOn,
    }).from(officialAssignments).where(and(
      eq(officialAssignments.rtUnitId, rtRows[0]!.id),
      inArray(officialAssignments.appAccountId, officialAccountIds),
    )).limit(3).for("update");
    const assignmentByAccountId = new Map(assignments.map((assignment) => [assignment.appAccountId, assignment]));
    for (const [loginIdentifier, role] of [
      [canonicalR2SyntheticFixture.chairmanLogin, "rt_chairman"],
      [canonicalR2SyntheticFixture.treasurerLogin, "treasurer"],
    ] as const) {
      const accountId = accountsByLogin.get(loginIdentifier)!.id;
      const assignment = assignmentByAccountId.get(accountId);
      if (
        assignments.length !== 2 || !assignment || assignment.appAccountType !== "official" || assignment.role !== role ||
        assignment.startsOn > today || (assignment.endsOn !== null && assignment.endsOn < today)
      ) {
        throw new Error("Preview rekey target does not contain the canonical active official assignments.");
      }
    }

    const credentialsInDatabase = await transaction.select({
      id: authAccount.id,
      userId: authAccount.userId,
      providerId: authAccount.providerId,
      password: authAccount.password,
    }).from(authAccount).where(inArray(authAccount.userId, authUserIds)).limit(5).for("update");
    if (
      credentialsInDatabase.length !== 4 ||
      credentialsInDatabase.some(({ providerId, password }) => providerId !== "credential" || !password)
    ) {
      throw new Error("Preview rekey target must have exactly one existing credential hash per synthetic account.");
    }
    const credentialByUser = new Map(credentialsInDatabase.map((credential) => [credential.userId, credential]));

    const sessions = await transaction.delete(authSession).where(inArray(authSession.userId, authUserIds))
      .returning({ userId: authSession.userId });
    const revokedSessionsByUser = new Map(authUserIds.map((userId) => [userId, 0]));
    for (const { userId } of sessions) revokedSessionsByUser.set(userId, (revokedSessionsByUser.get(userId) ?? 0) + 1);

    for (const [index, replacement] of replacements.entries()) {
      const account = accountsByLogin.get(replacement.loginIdentifier)!;
      const credential = credentialByUser.get(account.authUserId);
      if (!credential) throw new Error("Preview rekey target is missing a canonical credential row.");
      const updated = await transaction.update(authAccount).set({
        password: passwordHashes[index],
        updatedAt: new Date(),
      }).where(and(
        eq(authAccount.id, credential.id),
        eq(authAccount.userId, account.authUserId),
        eq(authAccount.providerId, "credential"),
      )).returning({ id: authAccount.id });
      if (updated.length !== 1) throw new Error("Preview rekey did not update exactly one canonical credential hash.");

      const role = expectedRoles[replacement.loginIdentifier];
      await appendAuditEvent(transaction, {
        actorAppAccountId: accountsByLogin.get(canonicalR2SyntheticFixture.systemAdminLogin)!.id,
        action: "preview.synthetic_credential.rekeyed",
        entityType: "synthetic_account",
        entityId: account.id,
        reason: null,
        context: {
          credentialRole: role,
          executionMethod: "owner_authorized_preview_cli",
          revokedSessionCount: revokedSessionsByUser.get(account.authUserId) ?? 0,
        },
      });
    }

    return { accountsRekeyed: 4 as const, sessionsRevoked: sessions.length };
  });
}
