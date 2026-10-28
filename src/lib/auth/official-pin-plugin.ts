import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie, setSessionCookie } from "better-auth/cookies";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/client";
import { appAccounts, authAccount, authSession, authTwoFactor, authUser, officialAssignments } from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/writer";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { lockOfficialPinAccounts, officialPinIsUsedByAnotherAccount, shareOfficialPinUniquenessLock, type AppTransaction } from "@/lib/auth/official-pin-uniqueness";
import { officialAssignmentActiveOn, jakartaBusinessDate } from "@/lib/officials/lifecycle";

const MAX_FAILURES = 5;
const LOCKOUT_MILLISECONDS = 15 * 60 * 1000;
const GENERIC_LOGIN_MESSAGE = "Data masuk belum cocok atau akun belum aktif.";
const GENERIC_RECOVERY_MESSAGE = "Data akun belum cocok atau akun belum aktif.";
type LoginOutcome =
  | { kind: "verified"; appAccountId: string; authUserId: string; pinHash: string; twoFactorEnabled: boolean }
  | { kind: "locked" }
  | { kind: "invalid" }
  | { kind: "wrong_pin" };

type RecoveryOutcome =
  | { kind: "recovered"; sessionsRevoked: number }
  | { kind: "locked" }
  | { kind: "invalid" }
  | { kind: "duplicate_pin" }
  | { kind: "unavailable" };

async function recordFailedLogin(transaction: AppTransaction, accountId: string, now: Date) {
  const nextLockUntil = new Date(now.getTime() + LOCKOUT_MILLISECONDS);
  await transaction.update(appAccounts).set({
    failedLoginAttempts: sql`case when ${appAccounts.lockedUntil} is not null and ${appAccounts.lockedUntil} <= ${now} then 1 else least(${appAccounts.failedLoginAttempts} + 1, ${MAX_FAILURES}) end`,
    lockedUntil: sql`case when ${appAccounts.lockedUntil} is not null and ${appAccounts.lockedUntil} <= ${now} then null when ${appAccounts.failedLoginAttempts} + 1 >= ${MAX_FAILURES} then ${nextLockUntil} else ${appAccounts.lockedUntil} end`,
  }).where(and(eq(appAccounts.id, accountId), eq(appAccounts.accountType, "official")));
}

async function recordFailedRecovery(transaction: AppTransaction, accountId: string, now: Date) {
  const nextLockUntil = new Date(now.getTime() + LOCKOUT_MILLISECONDS);
  await transaction.update(appAccounts).set({
    pinChangeFailedAttempts: sql`case when ${appAccounts.pinChangeLockedUntil} is not null and ${appAccounts.pinChangeLockedUntil} <= ${now} then 1 else least(${appAccounts.pinChangeFailedAttempts} + 1, ${MAX_FAILURES}) end`,
    pinChangeLockedUntil: sql`case when ${appAccounts.pinChangeLockedUntil} is not null and ${appAccounts.pinChangeLockedUntil} <= ${now} then null when ${appAccounts.pinChangeFailedAttempts} + 1 >= ${MAX_FAILURES} then ${nextLockUntil} else ${appAccounts.pinChangeLockedUntil} end`,
  }).where(eq(appAccounts.id, accountId));
}

async function verifyOfficialAssignment(transaction: AppTransaction, accountId: string) {
  const assignments = await transaction.select({ id: officialAssignments.id })
    .from(officialAssignments)
    .innerJoin(appAccounts, and(
      eq(appAccounts.id, officialAssignments.appAccountId),
      eq(appAccounts.rtUnitId, officialAssignments.rtUnitId),
    ))
    .where(and(
      eq(officialAssignments.appAccountId, accountId),
      eq(appAccounts.accountType, "official"),
      eq(appAccounts.status, "active"),
      officialAssignmentActiveOn(jakartaBusinessDate()),
    ))
    .limit(2)
    .for("update");
  return assignments.length === 1;
}

async function authenticateOfficialPin(database: AppDatabase, identifier: string, pin: string): Promise<LoginOutcome> {
  return database.transaction(async (transaction) => {
    await shareOfficialPinUniquenessLock(transaction);
    const candidates = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
    }).from(appAccounts).where(and(
      eq(appAccounts.accountType, "official"),
      sql`lower(${appAccounts.loginIdentifier}) = ${identifier.toLowerCase()}`,
    )).limit(2);

    if (candidates.length !== 1 || !candidates[0]) return { kind: "invalid" };
    const candidate = candidates[0];
    const [account] = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      status: appAccounts.status,
      pinHash: appAccounts.pinHash,
      lockedUntil: appAccounts.lockedUntil,
      twoFactorEnabled: authUser.twoFactorEnabled,
    }).from(appAccounts)
      .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
      .where(and(eq(appAccounts.id, candidate.id), eq(appAccounts.authUserId, candidate.authUserId)))
      .limit(1)
      .for("update");

    if (!account || account.status !== "active" || !(await verifyOfficialAssignment(transaction, account.id))) {
      return { kind: "invalid" };
    }

    const now = new Date();
    if (account.lockedUntil && account.lockedUntil > now) return { kind: "locked" };
    if (!account.pinHash) {
      await recordFailedLogin(transaction, account.id, now);
      return { kind: "invalid" };
    }

    let matches = false;
    try {
      matches = await verifyPassword({ hash: account.pinHash, password: pin });
    } catch {
      await recordFailedLogin(transaction, account.id, now);
      return { kind: "wrong_pin" };
    }
    if (!matches) {
      await recordFailedLogin(transaction, account.id, now);
      return { kind: "wrong_pin" };
    }
    if (await officialPinIsUsedByAnotherAccount(transaction, account.id, pin)) {
      await recordFailedLogin(transaction, account.id, now);
      return { kind: "wrong_pin" };
    }

    await transaction.update(appAccounts).set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(appAccounts.id, account.id));
    return {
      kind: "verified",
      appAccountId: account.id,
      authUserId: account.authUserId,
      pinHash: account.pinHash,
      twoFactorEnabled: account.twoFactorEnabled,
    };
  });
}

async function officialLoginStateStillMatches(
  database: AppDatabase,
  appAccountId: string,
  identifier: string,
  pinHash: string,
  twoFactorEnabled: boolean,
) {
  return database.transaction(async (transaction) => {
    const accounts = await transaction.select({
      id: appAccounts.id,
      status: appAccounts.status,
      pinHash: appAccounts.pinHash,
      lockedUntil: appAccounts.lockedUntil,
      twoFactorEnabled: authUser.twoFactorEnabled,
    }).from(appAccounts)
      .innerJoin(authUser, eq(authUser.id, appAccounts.authUserId))
      .where(and(
        eq(appAccounts.accountType, "official"),
        eq(appAccounts.status, "active"),
        sql`lower(${appAccounts.loginIdentifier}) = ${identifier.toLowerCase()}`,
      ))
      .limit(2)
      .for("update");
    const account = accounts.length === 1 ? accounts[0] : undefined;
    if (!account || account.id !== appAccountId || account.pinHash !== pinHash || account.twoFactorEnabled !== twoFactorEnabled) {
      return false;
    }
    if (account.lockedUntil && account.lockedUntil > new Date()) return false;
    return verifyOfficialAssignment(transaction, account.id);
  });
}

async function officialPinChallengeStillMatches(
  database: AppDatabase,
  userId: string,
  markerValue: string,
) {
  const [expectedAccountId, expectedPinFingerprint] = markerValue.split(":");
  if (!expectedAccountId || !expectedPinFingerprint) return false;
  return database.transaction(async (transaction) => {
    const [account] = await transaction.select({
      id: appAccounts.id,
      pinHash: appAccounts.pinHash,
      status: appAccounts.status,
      lockedUntil: appAccounts.lockedUntil,
    }).from(appAccounts).where(and(
      eq(appAccounts.id, expectedAccountId),
      eq(appAccounts.authUserId, userId),
      eq(appAccounts.accountType, "official"),
      eq(appAccounts.status, "active"),
    )).limit(1).for("update");
    if (!account?.pinHash || account.lockedUntil && account.lockedUntil > new Date()) return false;
    const currentFingerprint = createHash("sha256").update(account.pinHash).digest("hex");
    return currentFingerprint === expectedPinFingerprint && verifyOfficialAssignment(transaction, account.id);
  });
}

async function recoverOfficialPin(
  database: AppDatabase,
  identifier: string,
  currentPassword: string,
  newPin: string,
): Promise<RecoveryOutcome> {
  return database.transaction(async (transaction) => {
    await lockOfficialPinAccounts(transaction);
    const candidates = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
    }).from(appAccounts).where(and(
      eq(appAccounts.accountType, "official"),
      sql`lower(${appAccounts.loginIdentifier}) = ${identifier.toLowerCase()}`,
    )).limit(2);
    if (candidates.length !== 1 || !candidates[0]) return { kind: "unavailable" };

    const [account] = await transaction.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      status: appAccounts.status,
      pinChangeFailedAttempts: appAccounts.pinChangeFailedAttempts,
      pinChangeLockedUntil: appAccounts.pinChangeLockedUntil,
    }).from(appAccounts).where(and(
      eq(appAccounts.id, candidates[0].id),
      eq(appAccounts.authUserId, candidates[0].authUserId),
      eq(appAccounts.accountType, "official"),
    )).limit(1).for("update");
    if (!account || account.status !== "active" || !(await verifyOfficialAssignment(transaction, account.id))) {
      return { kind: "unavailable" };
    }

    const now = new Date();
    if (account.pinChangeLockedUntil && account.pinChangeLockedUntil > now) return { kind: "locked" };
    const credentials = await transaction.select({ id: authAccount.id, password: authAccount.password })
      .from(authAccount).where(and(
        eq(authAccount.userId, account.authUserId),
        eq(authAccount.providerId, "credential"),
      )).limit(2).for("update");
    if (credentials.length !== 1 || !credentials[0]?.password) return { kind: "unavailable" };

    let matches = false;
    try {
      matches = await verifyPassword({ hash: credentials[0].password, password: currentPassword });
    } catch {
      return { kind: "unavailable" };
    }
    if (!matches) {
      await recordFailedRecovery(transaction, account.id, now);
      return { kind: "invalid" };
    }

    if (await officialPinIsUsedByAnotherAccount(transaction, account.id, newPin)) {
      return { kind: "duplicate_pin" };
    }

    const pinHash = await hashPassword(newPin);
    await transaction.update(appAccounts).set({
      pinHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      pinChangeFailedAttempts: 0,
      pinChangeLockedUntil: null,
    }).where(eq(appAccounts.id, account.id));
    const revokedSessions = await transaction.delete(authSession)
      .where(eq(authSession.userId, account.authUserId))
      .returning({ id: authSession.id });
    await appendAuditEvent(transaction, {
      actorAppAccountId: account.id,
      action: "account.pin.recovered",
      entityType: "account_pin",
      entityId: account.id,
      reason: null,
      context: { recoveryMethod: "strong_account_password", revokedSessionCount: revokedSessions.length },
    });
    return { kind: "recovered", sessionsRevoked: revokedSessions.length };
  });
}

function genericUnauthorized(message: string) {
  return APIError.from("UNAUTHORIZED", { code: "INVALID_CREDENTIALS", message });
}

export function officialPinPlugin(database: AppDatabase, options: { twoFactorChallengeSeconds: number }) {
  const signInBody = z.object({
    identifier: z.string().trim().min(1).max(100),
    pin: z.string().regex(/^\d{6}$/),
    rememberMe: z.literal(false).optional(),
  }).strict();
  const recoveryBody = z.object({
    identifier: z.string().trim().min(1).max(100),
    currentPassword: z.string().min(1).max(128),
    newPin: z.string().regex(/^\d{6}$/),
    website: z.string().max(200).optional(),
  }).strict();

  return {
    id: "karturt-official-pin",
    endpoints: {
      signInOfficialPin: createAuthEndpoint("/sign-in/official-pin", {
        method: "POST",
        body: signInBody,
      }, async (ctx) => {
        const identifier = ctx.body.identifier.toLowerCase();
        const outcome = await authenticateOfficialPin(database, identifier, ctx.body.pin);
        if (outcome.kind === "locked") {
          ctx.setHeader("retry-after", String(Math.ceil(LOCKOUT_MILLISECONDS / 1000)));
          throw APIError.from("TOO_MANY_REQUESTS", { code: "LOGIN_LOCKED", message: "Login temporarily locked." });
        }
        if (outcome.kind !== "verified") {
          if (outcome.kind === "invalid") await ctx.context.password.hash(ctx.body.pin);
          throw genericUnauthorized(GENERIC_LOGIN_MESSAGE);
        }

        const stillMatches = await officialLoginStateStillMatches(
          database,
          outcome.appAccountId,
          identifier,
          outcome.pinHash,
          outcome.twoFactorEnabled,
        );
        if (!stillMatches) throw genericUnauthorized(GENERIC_LOGIN_MESSAGE);

        const user = await ctx.context.internalAdapter.findUserById(outcome.authUserId);
        if (!user) throw genericUnauthorized(GENERIC_LOGIN_MESSAGE);

        if (outcome.twoFactorEnabled) {
          const [factor] = await database.select({ verified: authTwoFactor.verified })
            .from(authTwoFactor).where(eq(authTwoFactor.userId, user.id)).limit(1);
          if (!factor?.verified) throw genericUnauthorized(GENERIC_LOGIN_MESSAGE);
          const expiresAt = new Date(Date.now() + options.twoFactorChallengeSeconds * 1000);
          const identifier = `2fa-${randomUUID()}`;
          const markerIdentifier = `official-pin-${identifier}`;
          const pinFingerprint = createHash("sha256").update(outcome.pinHash).digest("hex");
          await ctx.context.internalAdapter.createVerificationValue({ value: user.id, identifier, expiresAt });
          await ctx.context.internalAdapter.createVerificationValue({ value: "0", identifier: `2fa-attempts-${identifier}`, expiresAt });
          await ctx.context.internalAdapter.createVerificationValue({
            value: `${outcome.appAccountId}:${pinFingerprint}`,
            identifier: markerIdentifier,
            expiresAt,
          });
          const twoFactorCookie = ctx.context.createAuthCookie("two_factor", { maxAge: options.twoFactorChallengeSeconds });
          const officialChallengeCookie = ctx.context.createAuthCookie("official_pin_challenge", { maxAge: options.twoFactorChallengeSeconds });
          await ctx.setSignedCookie(twoFactorCookie.name, identifier, ctx.context.secret, twoFactorCookie.attributes);
          await ctx.setSignedCookie(officialChallengeCookie.name, identifier, ctx.context.secret, officialChallengeCookie.attributes);
          return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
        }

        const session = await ctx.context.internalAdapter.createSession(user.id, true);
        if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", { code: "FAILED_TO_CREATE_SESSION", message: "Failed to create session." });
        if (!await officialLoginStateStillMatches(
          database,
          outcome.appAccountId,
          identifier,
          outcome.pinHash,
          outcome.twoFactorEnabled,
        )) {
          await ctx.context.internalAdapter.deleteSession(session.token);
          throw genericUnauthorized(GENERIC_LOGIN_MESSAGE);
        }
        await setSessionCookie(ctx, { session, user }, true);
        return ctx.json({ redirect: false, token: session.token, url: null, user });
      }),
      recoverOfficialPin: createAuthEndpoint("/official-pin/recover", {
        method: "POST",
        body: recoveryBody,
      }, async (ctx) => {
        if (ctx.body.website) {
          await ctx.context.password.hash(ctx.body.currentPassword);
          throw genericUnauthorized(GENERIC_RECOVERY_MESSAGE);
        }
        if (!isValidAccountPassword("official", ctx.body.currentPassword)) {
          await ctx.context.password.hash(ctx.body.currentPassword);
          throw genericUnauthorized(GENERIC_RECOVERY_MESSAGE);
        }

        const outcome = await recoverOfficialPin(
          database,
          ctx.body.identifier.toLowerCase(),
          ctx.body.currentPassword,
          ctx.body.newPin,
        );
        if (outcome.kind === "locked") {
          ctx.setHeader("retry-after", String(Math.ceil(LOCKOUT_MILLISECONDS / 1000)));
          throw APIError.from("TOO_MANY_REQUESTS", { code: "PIN_RECOVERY_LOCKED", message: "PIN recovery temporarily locked." });
        }
        if (outcome.kind === "duplicate_pin") {
          throw APIError.from("BAD_REQUEST", { code: "DUPLICATE_OFFICIAL_PIN", message: "PIN baru tidak dapat digunakan. Pilih PIN lain." });
        }
        if (outcome.kind === "unavailable") {
          await ctx.context.password.hash(ctx.body.currentPassword);
          throw genericUnauthorized(GENERIC_RECOVERY_MESSAGE);
        }
        if (outcome.kind === "invalid") throw genericUnauthorized(GENERIC_RECOVERY_MESSAGE);
        return ctx.json({ status: true });
      }),
    },
    hooks: {
      after: [{
        matcher: (context: { path?: string }) => context.path === "/two-factor/verify-totp" || context.path === "/two-factor/verify-backup-code",
        handler: createAuthMiddleware(async (ctx) => {
          const newSession = ctx.context.newSession;
          if (!newSession) return;
          const officialChallengeCookie = ctx.context.createAuthCookie("official_pin_challenge", { maxAge: options.twoFactorChallengeSeconds });
          const challengeIdentifier = await ctx.getSignedCookie(officialChallengeCookie.name, ctx.context.secret);
          if (!challengeIdentifier) return;
          expireCookie(ctx, officialChallengeCookie);
          const markerIdentifier = `official-pin-${challengeIdentifier}`;
          const marker = await ctx.context.internalAdapter.findVerificationValue(markerIdentifier);
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(markerIdentifier);
          if (!marker || marker.expiresAt <= new Date() || !await officialPinChallengeStillMatches(
            database,
            newSession.user.id,
            marker.value,
          )) {
            await ctx.context.internalAdapter.deleteSession(newSession.session.token);
            deleteSessionCookie(ctx, true);
            const twoFactorCookie = ctx.context.createAuthCookie("two_factor", { maxAge: options.twoFactorChallengeSeconds });
            expireCookie(ctx, twoFactorCookie);
            ctx.context.setNewSession(null);
            throw genericUnauthorized(GENERIC_LOGIN_MESSAGE);
          }
        }),
      }],
    },
  };
}
