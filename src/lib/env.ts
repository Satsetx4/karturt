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

export function requireDatabaseEnvironment() {
  const env = getEnvironment();
  if (env.appEnv !== env.databaseEnv) {
    throw new Error(`Environment mismatch: APP_ENV is ${env.appEnv} but DATABASE_ENV is ${env.databaseEnv}.`);
  }
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required for database operations.");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(env.databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  return { ...env, databaseUrl: env.databaseUrl };
}

export function requireAuthEnvironment() {
  const env = getEnvironment();
  if (env.appEnv !== env.databaseEnv) {
    throw new Error(`Environment mismatch: APP_ENV is ${env.appEnv} but DATABASE_ENV is ${env.databaseEnv}.`);
  }
  if (!env.authSecret || env.authSecret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  return { ...env, authSecret: env.authSecret };
}
