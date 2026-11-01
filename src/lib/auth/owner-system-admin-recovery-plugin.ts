import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { AppDatabase } from "@/db/client";
import { recoverOwnSystemAdminTwoFactor } from "@/lib/auth/recover-own-system-admin-two-factor";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { z } from "zod";

const recoveryBody = z.object({
  identifier: z.string().trim().min(1).max(100),
  password: z.string().min(16).max(128),
  reason: z.string().trim().min(1).max(500),
}).strict();

export function ownerSystemAdminRecoveryPlugin(database: AppDatabase) {
  return {
    id: "karturt-system-admin-owner-recovery",
    endpoints: {
      ownerRecoverSystemAdminTwoFactor: createAuthEndpoint("/system-admin/owner-recovery", {
        method: "POST",
        body: recoveryBody,
      }, async (ctx) => {
        ctx.setHeader("cache-control", "no-store");
        if (!isValidAccountPassword("system_admin", ctx.body.password)) {
          throw APIError.from("UNAUTHORIZED", {
            code: "INVALID_CREDENTIALS",
            message: "Data akun belum cocok atau akun belum dapat dipulihkan.",
          });
        }

        const result = await recoverOwnSystemAdminTwoFactor(database, ctx.body);
        if (result.kind === "invalid") {
          throw APIError.from("UNAUTHORIZED", {
            code: "INVALID_CREDENTIALS",
            message: "Data akun belum cocok atau akun belum dapat dipulihkan.",
          });
        }
        if (result.kind === "locked") {
          ctx.setHeader("retry-after", String(result.retryAfterSeconds));
          throw APIError.from("TOO_MANY_REQUESTS", {
            code: "LOGIN_LOCKED",
            message: "Akun terkunci sementara. Tunggu sebelum mencoba lagi.",
          });
        }
        if (result.kind === "unavailable") {
          throw APIError.from("BAD_REQUEST", {
            code: "RECOVERY_UNAVAILABLE",
            message: "Pemulihan belum dapat diproses untuk keadaan akun ini.",
          });
        }

        const user = await ctx.context.internalAdapter.findUserById(result.authUserId);
        if (!user) {
          throw APIError.from("INTERNAL_SERVER_ERROR", {
            code: "RECOVERY_SESSION_UNAVAILABLE",
            message: "Pemulihan tercatat. Sesi penyiapan belum dapat dibuat; coba lagi melalui alamat pemilik.",
          });
        }
        const session = await ctx.context.internalAdapter.createSession(user.id, true, {
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });
        if (!session) {
          throw APIError.from("INTERNAL_SERVER_ERROR", {
            code: "RECOVERY_SESSION_UNAVAILABLE",
            message: "Pemulihan tercatat. Sesi penyiapan belum dapat dibuat; coba lagi melalui alamat pemilik.",
          });
        }
        await setSessionCookie(ctx, { session, user }, true);
        return ctx.json({ ok: true, recoveryReference: result.recoveryReference });
      }),
    },
  };
}
