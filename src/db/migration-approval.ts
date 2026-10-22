import { createHash, verify } from "node:crypto";

export const STAGING_MIGRATION_AUTHORIZATION_PURPOSE = "karturt-v1-staging-migration/v2" as const;
export const STAGING_MIGRATION_AUTHORIZATION_WINDOW_MS = 15 * 60 * 1000;

// Wave 13A intentionally has no owner key. A separately reviewed source change must pin it.
// The owner artifact is Ed25519 over serializeStagingMigrationAuthorizationPayload(payload),
// with the resulting signature encoded as standard base64 in the artifact's `signature` field.
// The private key stays outside this repository; no environment value can replace this trust root.
export const PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM: string | null = null;

export type StagingMigrationAuthorizationPayload = {
  purpose: typeof STAGING_MIGRATION_AUTHORIZATION_PURPOSE;
  authorizationId: string;
  sourceSha: string;
  targetManifestFingerprint: string;
  migrationManifestFingerprint: string;
  readinessEvaluationSha256: string;
  issuedAt: string;
  expiresAt: string;
};

export type StagingMigrationAuthorizationArtifact = {
  schemaVersion: 2;
  payload: StagingMigrationAuthorizationPayload;
  signature: string;
};

export type StagingMigrationAuthorizationExpectation = {
  sourceSha: string;
  targetManifestFingerprint: string;
  migrationManifestFingerprint: string;
  readinessEvaluationSha256: string;
  nowMs: number;
};

export function serializeStagingMigrationAuthorizationPayload(payload: StagingMigrationAuthorizationPayload) {
  // Explicit key order is the signed wire format. Do not replace with an arbitrary object serializer.
  return JSON.stringify({
    purpose: payload.purpose,
    authorizationId: payload.authorizationId,
    sourceSha: payload.sourceSha,
    targetManifestFingerprint: payload.targetManifestFingerprint,
    migrationManifestFingerprint: payload.migrationManifestFingerprint,
    readinessEvaluationSha256: payload.readinessEvaluationSha256,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}

export function parseStagingMigrationAuthorizationArtifact(serialized: string): StagingMigrationAuthorizationArtifact {
  let parsed: unknown;
  try {
    if (Buffer.byteLength(serialized, "utf8") > 16 * 1024) throw new Error("too large");
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("The migration authorization artifact is missing or malformed.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The migration authorization artifact is missing or malformed.");
  }
  const artifact = parsed as Partial<StagingMigrationAuthorizationArtifact>;
  const payload = artifact.payload as Partial<StagingMigrationAuthorizationPayload> | undefined;
  if (
    artifact.schemaVersion !== 2 || !payload || typeof payload !== "object" ||
    Object.keys(artifact).some((key) => !["schemaVersion", "payload", "signature"].includes(key)) ||
    Object.keys(payload).some((key) => ![
      "purpose", "authorizationId", "sourceSha", "targetManifestFingerprint",
      "migrationManifestFingerprint", "readinessEvaluationSha256", "issuedAt", "expiresAt",
    ].includes(key)) ||
    payload.purpose !== STAGING_MIGRATION_AUTHORIZATION_PURPOSE ||
    typeof payload.authorizationId !== "string" || !/^[a-f0-9]{64}$/.test(payload.authorizationId) ||
    typeof payload.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(payload.sourceSha) ||
    typeof payload.targetManifestFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(payload.targetManifestFingerprint) ||
    typeof payload.migrationManifestFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(payload.migrationManifestFingerprint) ||
    typeof payload.readinessEvaluationSha256 !== "string" || !/^[a-f0-9]{64}$/.test(payload.readinessEvaluationSha256) ||
    typeof payload.issuedAt !== "string" || typeof payload.expiresAt !== "string" ||
    typeof artifact.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(artifact.signature)
  ) {
    throw new Error("The migration authorization artifact is missing or malformed.");
  }

  return {
    schemaVersion: 2,
    payload: payload as StagingMigrationAuthorizationPayload,
    signature: artifact.signature,
  };
}

export function assertStagingMigrationAuthorization(
  artifact: StagingMigrationAuthorizationArtifact,
  expected: StagingMigrationAuthorizationExpectation,
  publicKeyPem: string | null = PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM,
) {
  if (!publicKeyPem) {
    throw new Error("No owner approval key is pinned in this source revision; staging migration is disabled.");
  }

  const { payload } = artifact;
  const issuedAtMs = Date.parse(payload.issuedAt);
  const expiresAtMs = Date.parse(payload.expiresAt);
  if (
    !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) ||
    new Date(issuedAtMs).toISOString() !== payload.issuedAt ||
    new Date(expiresAtMs).toISOString() !== payload.expiresAt ||
    issuedAtMs > expected.nowMs + 60_000 || expiresAtMs <= expected.nowMs ||
    expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > STAGING_MIGRATION_AUTHORIZATION_WINDOW_MS ||
    payload.sourceSha !== expected.sourceSha ||
    payload.targetManifestFingerprint !== expected.targetManifestFingerprint ||
    payload.migrationManifestFingerprint !== expected.migrationManifestFingerprint ||
    payload.readinessEvaluationSha256 !== expected.readinessEvaluationSha256
  ) {
    throw new Error("The migration authorization does not match this source, target, migration snapshot, or time window.");
  }

  let signatureIsValid = false;
  try {
    signatureIsValid = verify(
      null,
      Buffer.from(serializeStagingMigrationAuthorizationPayload(payload), "utf8"),
      publicKeyPem,
      Buffer.from(artifact.signature, "base64"),
    );
  } catch {
    signatureIsValid = false;
  }
  if (!signatureIsValid) {
    throw new Error("The migration authorization signature is invalid.");
  }

  return {
    authorizationId: payload.authorizationId,
    payloadFingerprint: createHash("sha256")
      .update(serializeStagingMigrationAuthorizationPayload(payload), "utf8")
      .digest("hex"),
  };
}
