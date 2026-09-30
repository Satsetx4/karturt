import { afterEach, describe, expect, it } from "vitest";
import { getPublicAppUrl, requireAuthEnvironment, requireDatabaseEnvironment } from "../../src/lib/env";

const variableNames = ["APP_ENV", "DATABASE_ENV", "DATABASE_URL", "BETTER_AUTH_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
const originalValues = new Map(variableNames.map((name) => [name, process.env[name]]));

function setEnvironment(values: Partial<Record<(typeof variableNames)[number], string>>) {
  for (const name of variableNames) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  for (const name of variableNames) {
    const value = originalValues.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("runtime environment guards", () => {
  it("requires explicit matching application and database labels", () => {
    setEnvironment({ APP_ENV: "development", DATABASE_ENV: "production", DATABASE_URL: "postgresql://local/db" });
    expect(() => requireDatabaseEnvironment()).toThrow("Environment mismatch");

    setEnvironment({ DATABASE_URL: "postgresql://local/db" });
    expect(() => requireDatabaseEnvironment()).toThrow("must both be set explicitly");
  });

  it("requires explicit labels before generating deployment metadata", () => {
    setEnvironment({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
    expect(() => getPublicAppUrl()).toThrow("must both be set explicitly");
  });

  it("rejects localhost, missing, and non-origin URLs for staging and production auth", () => {
    const shared = { DATABASE_ENV: "production", BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-long-enough" };
    setEnvironment({ APP_ENV: "production", ...shared });
    expect(() => requireAuthEnvironment()).toThrow("NEXT_PUBLIC_APP_URL must be set");

    setEnvironment({ APP_ENV: "production", ...shared, NEXT_PUBLIC_APP_URL: "http://karturt.example" });
    expect(() => requireAuthEnvironment()).toThrow("HTTPS origin");

    setEnvironment({ APP_ENV: "staging", DATABASE_ENV: "staging", BETTER_AUTH_SECRET: shared.BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL: "https://preview.example/path" });
    expect(() => requireAuthEnvironment()).toThrow("HTTPS origin");
  });

  it("accepts a configured HTTPS origin and rejects the example secret placeholder", () => {
    setEnvironment({
      APP_ENV: "production",
      DATABASE_ENV: "production",
      DATABASE_URL: "postgresql://production.example/db",
      BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-long-enough",
      NEXT_PUBLIC_APP_URL: "https://karturt.example",
    });
    expect(requireAuthEnvironment().appUrl).toBe("https://karturt.example");

    setEnvironment({
      APP_ENV: "production",
      DATABASE_ENV: "production",
      BETTER_AUTH_SECRET: "replace-with-a-unique-random-secret-at-least-32-characters",
      NEXT_PUBLIC_APP_URL: "https://karturt.example",
    });
    expect(() => requireAuthEnvironment()).toThrow("BETTER_AUTH_SECRET");
  });
});
