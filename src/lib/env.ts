import { z } from "zod";

const environment = z.enum(["development", "staging", "production", "test"]);

type DatabaseTarget = {
  hostname: string;
  port: number;
  databaseName: string;
  username: string;
};

// Keep this empty until an owner confirms a production-independent synthetic staging root.
const approvedStagingDatabaseTargets: readonly DatabaseTarget[] = [];

// Keep this empty until an owner approves the exact non-secret production database identity.
const approvedProductionDatabaseTargets: readonly DatabaseTarget[] = [];

export function databaseUrlMatchesTarget(
  databaseUrl: string,
  target: DatabaseTarget,
) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return false;
    const allowedParameters = new Set(["sslmode"]);
    if ([...parsed.searchParams.keys()].some((parameter) => !allowedParameters.has(parameter))) return false;
    const sslModes = parsed.searchParams.getAll("sslmode");
    if (sslModes.length !== 1 || sslModes[0]!.toLowerCase() !== "verify-full") return false;
    if (parsed.hash) return false;
    return parsed.hostname.toLowerCase() === target.hostname.toLowerCase() &&
      Number(parsed.port || "5432") === target.port &&
      decodeURIComponent(parsed.pathname.slice(1)) === target.databaseName &&
      decodeURIComponent(parsed.username) === target.username;
  } catch {
    return false;
  }
}

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

function requireVercelDatabaseEnvironment(env: ReturnType<typeof getEnvironment>) {
  if (process.env.NODE_ENV === "production" && env.appEnv === "development") {
    throw new Error("APP_ENV must not be development in an optimized production build.");
  }
  const deploymentEnvironment = process.env.VERCEL_ENV;
  if (env.appEnv === "staging" && deploymentEnvironment !== "preview") {
    throw new Error("Staging database operations require VERCEL_ENV=preview.");
  }
  if (env.appEnv === "production" && (process.env.NODE_ENV !== "production" || deploymentEnvironment !== "production")) {
    throw new Error("Production database operations require NODE_ENV=production and VERCEL_ENV=production.");
  }
  if (!deploymentEnvironment) return;
  if (!["development", "preview", "production"].includes(deploymentEnvironment)) {
    throw new Error("VERCEL_ENV must identify a supported Vercel deployment environment.");
  }
  if (deploymentEnvironment === "preview" && (env.appEnv !== "staging" || env.databaseEnv !== "staging")) {
    throw new Error("Vercel Preview deployments require staging application and database labels.");
  }
  if (deploymentEnvironment === "production" && (env.appEnv !== "production" || env.databaseEnv !== "production")) {
    throw new Error("Vercel Production deployments require production application and database labels.");
  }
  if (deploymentEnvironment === "development" && (env.appEnv !== "development" || env.databaseEnv !== "development")) {
    throw new Error("Vercel Development deployments require development application and database labels.");
  }
}

function isLocalPostgresUrl(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    const hostname = parsed.hostname.toLowerCase();
    const parameters = [...parsed.searchParams.keys()];
    const sslModes = parsed.searchParams.getAll("sslmode");
    return (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") &&
      parameters.every((parameter) => parameter === "sslmode") &&
      sslModes.length <= 1 &&
      sslModes.every((mode) => ["disable", "prefer"].includes(mode.toLowerCase())) &&
      parsed.hash === "";
  } catch {
    return false;
  }
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
  requireVercelDatabaseEnvironment(env);
  const databaseUrl = env.databaseUrl;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database operations.");
  }
  if ((env.appEnv === "development" || env.appEnv === "test") && !isLocalPostgresUrl(databaseUrl)) {
    throw new Error(`${env.appEnv === "test" ? "Test" : "Development"} database operations require a local PostgreSQL URL.`);
  }
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  if (
    env.databaseEnv === "staging" &&
    !approvedStagingDatabaseTargets.some((target) => databaseUrlMatchesTarget(databaseUrl, target))
  ) {
    throw new Error("DATABASE_URL does not match an approved staging database target.");
  }
  if (
    env.databaseEnv === "production" &&
    !approvedProductionDatabaseTargets.some((target) => databaseUrlMatchesTarget(databaseUrl, target))
  ) {
    throw new Error("DATABASE_URL does not match an approved production database target.");
  }
  return { ...env, databaseUrl };
}

export function requireAuthEnvironment() {
  const env = requireExplicitEnvironmentLabels();
  if (!env.authSecret || env.authSecret.length < 32 || /^replace[-_]/i.test(env.authSecret)) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  validateDeploymentAppUrl(env);
  return { ...env, authSecret: env.authSecret };
}
