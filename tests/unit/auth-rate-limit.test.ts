import { describe, expect, it } from "vitest";
import { createAuthRateLimitOptions, DEFAULT_EMAIL_SIGN_IN_MAX, STAGING_DEMO_LOGIN_BURST_MAX } from "@/lib/auth/rate-limit";

describe("Better Auth email sign-in rate limit configuration", () => {
  it.each([
    ["unset environment", {}],
    ["development, even with the opt-in flag", { APP_ENV: "development", DATABASE_ENV: "development", KARTURT_STAGING_DEMO_LOGIN_BURST: "true" }],
    ["production, even with the opt-in flag", { APP_ENV: "production", DATABASE_ENV: "production", KARTURT_STAGING_DEMO_LOGIN_BURST: "true" }],
    ["staging without the opt-in flag", { APP_ENV: "staging", DATABASE_ENV: "staging" }],
    ["staging with a mismatched database label", { APP_ENV: "staging", DATABASE_ENV: "production", KARTURT_STAGING_DEMO_LOGIN_BURST: "true" }],
    ["staging with a non-true opt-in value", { APP_ENV: "staging", DATABASE_ENV: "staging", KARTURT_STAGING_DEMO_LOGIN_BURST: "yes" }],
  ])("keeps the default sign-in limit for %s", (_label, environment) => {
    const options = createAuthRateLimitOptions(environment);

    expect(options.customRules["/sign-in/email"]).toEqual({ window: 60, max: DEFAULT_EMAIL_SIGN_IN_MAX });
    expect(options.customRules["/two-factor/verify-totp"]).toEqual({ window: 60, max: 5 });
    expect(options.customRules["/two-factor/verify-backup-code"]).toEqual({ window: 60, max: 5 });
    expect(options).toMatchObject({ enabled: true, storage: "database", window: 60, max: 100 });
  });

  it("raises only the email sign-in limit for an explicitly opted-in staging app and staging database", () => {
    const options = createAuthRateLimitOptions({
      APP_ENV: "staging",
      DATABASE_ENV: "staging",
      KARTURT_STAGING_DEMO_LOGIN_BURST: "true",
    });

    expect(options.customRules["/sign-in/email"]).toEqual({ window: 60, max: STAGING_DEMO_LOGIN_BURST_MAX });
    expect(options.customRules["/two-factor/verify-totp"]).toEqual({ window: 60, max: 5 });
    expect(options.customRules["/two-factor/verify-backup-code"]).toEqual({ window: 60, max: 5 });
    expect(options).toMatchObject({ enabled: true, storage: "database", window: 60, max: 100 });
  });
});
