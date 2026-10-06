import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import type { AppDatabase } from "@/db/client";
import { getDb } from "@/db/client";
import { relationalSchema } from "@/db/schema";
import { requireAuthEnvironment } from "@/lib/env";
import { createAuthRateLimitOptions } from "@/lib/auth/rate-limit";

export function createAuth(database: AppDatabase, options: { secret: string; baseURL: string }) {
  return betterAuth({
    appName: "KartuRT",
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: [options.baseURL],
    database: drizzleAdapter(database, { provider: "pg", schema: relationalSchema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 6,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    plugins: [twoFactor({ issuer: "KartuRT" })],
    rateLimit: createAuthRateLimitOptions(),
    session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 30 },
    advanced: {
      useSecureCookies: options.baseURL.startsWith("https://"),
      database: { validateSchema: false },
    },
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  if (authInstance) return authInstance;
  const env = requireAuthEnvironment();
  authInstance = createAuth(getDb(), { secret: env.authSecret, baseURL: env.appUrl });
  return authInstance;
}
