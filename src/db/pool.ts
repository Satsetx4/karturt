import { readFileSync } from "node:fs";
import { checkServerIdentity, rootCertificates } from "node:tls";
import { Pool, type PoolConfig } from "pg";
import { stagingDatabaseTarget } from "@/db/staging-target";

export type DatabaseEnvironment = "development" | "staging" | "production" | "test";
export type DatabaseConnectionPurpose = "runtime" | "migration";

function validateApplicationName(applicationName: string, databaseEnvironment: DatabaseEnvironment, purpose: DatabaseConnectionPurpose) {
  const r3ApplicationName = /^krt-r3-[a-z0-9]{8,20}-R3-RACE-(REQUEST|VERIFY|CASH|REVERSAL)-(a|b)$/;
  if (
    databaseEnvironment !== "staging" ||
    purpose !== "runtime" ||
    applicationName.length > 63 ||
    !r3ApplicationName.test(applicationName)
  ) {
    throw new Error("R3 application name is allowed only for a bounded staging runtime worker.");
  }
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const allowedConnectionParameters = new Set([
  "sslmode",
  "sslrootcert",
  "sslnegotiation",
  "application_name",
  "channel_binding",
]);

function assertStagingTarget(
  url: URL,
  purpose: DatabaseConnectionPurpose,
) {
  const expectedHosts: string[] = [stagingDatabaseTarget.directHost];
  const expectedRole = purpose === "migration" ? stagingDatabaseTarget.migrationRole : stagingDatabaseTarget.runtimeRole;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const role = decodeURIComponent(url.username);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (
    !expectedHosts.includes(host) ||
    (url.port && url.port !== "5432") ||
    database !== stagingDatabaseTarget.database ||
    role !== expectedRole
  ) {
    throw new Error(`Staging ${purpose} connection must target the approved database, endpoint, and role.`);
  }
}

export function createDatabasePoolConfig(
  connectionString: string,
  databaseEnvironment: DatabaseEnvironment,
  purpose: DatabaseConnectionPurpose,
  max = purpose === "migration" ? 1 : 5,
  applicationNameOverride?: string,
): PoolConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Database connection URL is invalid.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database connection URL must use PostgreSQL.");
  }
  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error("Database connection URL must include a host and database name.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const role = decodeURIComponent(url.username);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isCanonicalStagingTarget = host === stagingDatabaseTarget.directHost || (
    database === stagingDatabaseTarget.database &&
    (role === stagingDatabaseTarget.runtimeRole || role === stagingDatabaseTarget.migrationRole)
  );

  if (isCanonicalStagingTarget && databaseEnvironment !== "staging") {
    throw new Error("The canonical staging database cannot be used under another environment label.");
  }
  const isLoopback = loopbackHosts.has(host);
  if (isLoopback && (databaseEnvironment === "staging" || databaseEnvironment === "production")) {
    throw new Error("Staging and production database connections must use a remote TLS endpoint.");
  }

  if (databaseEnvironment === "staging") {
    assertStagingTarget(url, purpose);
    if (!url.username || !url.password) {
      throw new Error(`Staging ${purpose} connection must use credentials provisioned outside chat.`);
    }
  }

  for (const parameter of url.searchParams.keys()) {
    if (!allowedConnectionParameters.has(parameter)) {
      throw new Error(`Unsupported database connection parameter: ${parameter}.`);
    }
    if (url.searchParams.getAll(parameter).length !== 1) {
      throw new Error(`Database connection parameter must appear once: ${parameter}.`);
    }
  }

  const caPath = url.searchParams.get("sslrootcert");
  const channelBinding = url.searchParams.get("channel_binding");
  const sslNegotiation = url.searchParams.get("sslnegotiation");
  if (databaseEnvironment === "staging" && caPath && caPath !== "system") {
    throw new Error("Staging TLS must use the Node.js trusted CA store; custom CA paths are not accepted.");
  }
  if (channelBinding && channelBinding !== "prefer") {
    throw new Error("Strict PostgreSQL channel binding is unsupported; omit channel_binding or use prefer.");
  }
  if (sslNegotiation && sslNegotiation !== "postgres") {
    throw new Error("PostgreSQL connections must use standard TLS negotiation.");
  }
  if (url.hash) {
    throw new Error("Database connection URL must not include a fragment.");
  }

  if (applicationNameOverride) validateApplicationName(applicationNameOverride, databaseEnvironment, purpose);
  const applicationName = applicationNameOverride ?? url.searchParams.get("application_name") ?? undefined;
  const userName = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  if (!isLoopback && process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("Remote database TLS certificate verification is disabled for this process.");
  }

  const ssl = isLoopback
    ? undefined
    : {
      ...(databaseEnvironment === "staging"
        ? { ca: [...rootCertificates] }
        : caPath && caPath !== "system"
          ? { ca: readFileSync(caPath) }
          : {}),
      rejectUnauthorized: true,
      minVersion: "TLSv1.2" as const,
      servername: host,
      checkServerIdentity: (_servername: string, certificate: Parameters<typeof checkServerIdentity>[1]) =>
        checkServerIdentity(host, certificate),
    };

  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    ...(database ? { database } : {}),
    ...(userName ? { user: userName } : {}),
    ...(password ? { password } : {}),
    ...(applicationName ? { application_name: applicationName } : {}),
    ...(channelBinding ? { enableChannelBinding: true } : {}),
    sslnegotiation: "postgres",
    ...(ssl ? { ssl } : {}),
    max,
    connectionTimeoutMillis: 10_000,
  };
}

export function createDatabasePool(
  connectionString: string,
  databaseEnvironment: DatabaseEnvironment,
  purpose: DatabaseConnectionPurpose,
  max?: number,
  applicationNameOverride?: string,
) {
  return new Pool(createDatabasePoolConfig(connectionString, databaseEnvironment, purpose, max, applicationNameOverride));
}
