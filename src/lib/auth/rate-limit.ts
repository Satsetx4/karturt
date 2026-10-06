type LoginBurstEnvironment = Readonly<Record<string, string | undefined>>;

export const STAGING_DEMO_LOGIN_BURST_MAX = 90;
export const DEFAULT_EMAIL_SIGN_IN_MAX = 5;

export function createAuthRateLimitOptions(environment: LoginBurstEnvironment = process.env) {
  const stagingDemoLoginBurstEnabled = environment.APP_ENV === "staging"
    && environment.DATABASE_ENV === "staging"
    && environment.KARTURT_STAGING_DEMO_LOGIN_BURST === "true";

  return {
    enabled: true,
    storage: "database" as const,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": {
        window: 60,
        max: stagingDemoLoginBurstEnabled ? STAGING_DEMO_LOGIN_BURST_MAX : DEFAULT_EMAIL_SIGN_IN_MAX,
      },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
    },
  };
}
