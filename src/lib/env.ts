import { z } from "zod";

const environment = z.enum(["development", "staging", "production", "test"]);

export function getEnvironment() {
  const inferred = process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development";
  const appEnv = environment.parse(process.env.APP_ENV ?? inferred);
  const databaseEnv = environment.parse(process.env.DATABASE_ENV ?? appEnv);

  return {
    appEnv,
    databaseEnv,
    databaseUrl: process.env.DATABASE_URL,
    authSecret: process.env.BETTER_AUTH_SECRET,
    appUrl: z.url().parse(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  };
}

function requireExplicitEnvironmentLabels() {
  if (!process.env.APP_ENV || !process.env.DATABASE_ENV) {
    throw new Error("APP_ENV and DATABASE_ENV must both be set explicitly for application or database operations.");
  }
  const env = getEnvironment();
  if (env.appEnv !== env.databaseEnv) {
    throw new Error(`Environment mismatch: APP_ENV is ${env.appEnv} but DATABASE_ENV is ${env.databaseEnv}.`);
  }
  return env;
}

function validateDeploymentAppUrl(env: ReturnType<typeof getEnvironment>) {
  if (process.env.NODE_ENV === "production" && env.appEnv === "development") {
    throw new Error("APP_ENV must not be development in an optimized production build.");
  }
  if (env.appEnv !== "staging" && env.appEnv !== "production") return;
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    throw new Error("NEXT_PUBLIC_APP_URL must be set for staging and production.");
  }
  const appUrl = new URL(env.appUrl);
  if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("NEXT_PUBLIC_APP_URL must be an HTTPS origin without credentials, path, query, or fragment in staging and production.");
  }
}

export function getPublicAppUrl() {
  const env = requireExplicitEnvironmentLabels();
  validateDeploymentAppUrl(env);
  return env.appUrl;
}

export function requireDatabaseEnvironment() {
  const env = requireExplicitEnvironmentLabels();
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required for database operations.");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(env.databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  return { ...env, databaseUrl: env.databaseUrl };
}

export function requireAuthEnvironment() {
  const env = requireExplicitEnvironmentLabels();
  if (!env.authSecret || env.authSecret.length < 32 || /^replace[-_]/i.test(env.authSecret)) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  validateDeploymentAppUrl(env);
  return { ...env, authSecret: env.authSecret };
}
