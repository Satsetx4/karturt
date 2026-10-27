import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appendAuditEvent } from "@/lib/audit/writer";
import { getDb } from "@/db/client";
import { appAccounts } from "@/db/schema";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { MfaEnrollmentRequiredError, resolvePrincipalForUser, UnauthenticatedError } from "@/lib/auth/principal";
import { getAuth } from "@/lib/auth/server";

export const runtime = "nodejs";

async function handle(request: Request) {
  const auth = getAuth();
  if (request.method !== "POST") return auth.handler(request);

  const pathname = new URL(request.url).pathname;
  const endpoint = pathname.replace(/^\/api\/auth/, "");

  if (endpoint === "/change-password") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return auth.handler(request);

    const database = getDb();
    const [account] = await database.select({
      id: appAccounts.id,
      authUserId: appAccounts.authUserId,
      accountType: appAccounts.accountType,
    }).from(appAccounts).where(and(
      eq(appAccounts.authUserId, session.user.id),
      eq(appAccounts.status, "active"),
    )).limit(1);
    if (!account) return jsonResponse({ message: "Akun tidak aktif atau tidak tersedia." }, 401);

    let principal;
    try {
      principal = await resolvePrincipalForUser(database, account.authUserId);
    } catch (error) {
      if (error instanceof MfaEnrollmentRequiredError || error instanceof UnauthenticatedError) {
        return jsonResponse({ message: "Sesi akun belum memenuhi verifikasi keamanan." }, 403);
      }
      return jsonResponse({ message: "Permintaan belum dapat diproses." }, 503);
    }
    if (principal.role === "resident") {
      return jsonResponse({ message: "Warga mengubah PIN melalui menu Keamanan akun." }, 403);
    }

    const passwordChangeSchema = z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z.string().min(16).max(128),
    }).passthrough();
    let payload: unknown;
    try {
      payload = await request.clone().json();
    } catch {
      return jsonResponse({ message: "Format permintaan tidak valid." }, 400);
    }
    const parsed = passwordChangeSchema.safeParse(payload);
    if (!parsed.success || !isValidAccountPassword(account.accountType, parsed.data.newPassword)) {
      return jsonResponse({ message: "Kata sandi harus berisi 16–128 karakter." }, 400);
    }

    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.delete("content-length");
    forwardedHeaders.delete("content-encoding");
    forwardedHeaders.set("content-type", "application/json");
    const forwardedRequest = new Request(request.url, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify({ ...parsed.data, revokeOtherSessions: true }),
    });
    const response = await auth.handler(forwardedRequest);
    if (!response.ok) return await safeAuthResponse(response, { message: "Kata sandi belum dapat diubah." });

    try {
      await appendAccountSecurityAudit(account.id, "account.password.changed");
    } catch {
      return await safeAuthResponse(response, { message: "Perubahan belum dapat dicatat dengan aman." }, 503);
    }
    return await safeAuthResponse(response, { status: true });
  }

  const twoFactorAuditAction = twoFactorAuditActionForEndpoint(endpoint);
  let account: { id: string; accountType: string } | null = null;
  if (twoFactorAuditAction || endpoint === "/two-factor/disable") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) {
      try {
        const [current] = await getDb().select({
          id: appAccounts.id,
          accountType: appAccounts.accountType,
        }).from(appAccounts).where(and(
          eq(appAccounts.authUserId, session.user.id),
          eq(appAccounts.status, "active"),
        )).limit(1);
        account = current ?? null;
      } catch {
        return jsonResponse({ message: "Permintaan belum dapat diproses." }, 503);
      }
    }
  }

  if (endpoint === "/two-factor/disable" && account?.accountType === "system_admin") {
    return jsonResponse({ message: "Verifikasi dua langkah wajib untuk System Admin." }, 403);
  }

  const response = await auth.handler(request);
  if (response.ok && account && twoFactorAuditAction) {
    try {
      await appendAccountSecurityAudit(account.id, twoFactorAuditAction);
    } catch {
      return await safeAuthResponse(response, { message: "Perubahan keamanan belum dapat dicatat." }, 503);
    }
  }
  return response;
}

function twoFactorAuditActionForEndpoint(endpoint: string) {
  if (endpoint === "/two-factor/enable") return "account.two_factor.enrollment_started";
  if (endpoint === "/two-factor/verify-totp") return "account.two_factor.verified";
  if (endpoint === "/two-factor/generate-backup-codes") return "account.two_factor.backup_codes_rotated";
  if (endpoint === "/two-factor/verify-backup-code") return "account.two_factor.backup_code_used";
  return null;
}

async function appendAccountSecurityAudit(accountId: string, action: string) {
  await getDb().transaction(async (transaction) => {
    await appendAuditEvent(transaction, {
      actorAppAccountId: accountId,
      action,
      entityType: action === "account.password.changed" ? "account_credential" : "account_security",
      entityId: accountId,
      reason: null,
      context: {},
    });
  });
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function safeAuthResponse(response: Response, body: Record<string, unknown>, status = response.status) {
  await response.body?.cancel().catch(() => undefined);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export { handle as GET, handle as POST };
