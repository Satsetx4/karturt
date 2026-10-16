import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertBoundLibpqEnvironment,
  assertCandidateTargetBinding,
  assertNoReparsePoints,
  assertNoInventedLineageNulls,
  assertPostgres18Version,
  assertRootLineageAttestation,
  assertSha256Matches,
  assertWindowsAclCheckerResult,
  getRootLineageAttestationSha256,
  resolveWindowsPowerShellExecutable,
  WAVE13B2_LOCAL_PREFLIGHT_EXPECTED as EXPECTED,
} from "../../scripts/preflight-wave13b2-local.mjs";
import {
  assertExpectedStateBinding,
  assertQueryApprovalArtifact,
  assertSourceCommit,
  assertTargetManifestBinding,
  QUERY_APPROVAL_PAYLOAD_KEYS,
} from "../../scripts/verify-wave13b2-query-approval.mjs";

const sourceSha = "a".repeat(40);
const expectedStateSha256 = "b".repeat(64);
const caBundleSha256 = createHash("sha256").update("trusted CA fixture").digest("hex");
const fixedNow = Date.parse("2026-10-15T12:40:00.000Z");
const temporaryDirectories: string[] = [];

function tempDirectory() {
  const path = mkdtempSync(join(tmpdir(), "karturt-wave13b2-test-"));
  temporaryDirectories.push(path);
  return path;
}

function createTargetManifest(publicKeyFingerprint = "c".repeat(64)) {
  const rootLineageAttestationSha256 = getRootLineageAttestationSha256();
  return {
    schemaVersion: 1,
    state: "ROOT_VERIFIED_CATALOG_UNKNOWN",
    finalApprovalSourceSha: sourceSha,
    migrationManifestFingerprint: EXPECTED.migrationManifestFingerprint,
    provider: {
      plan: "Free",
      freeOnlyConfirmed: true,
      organizationId: EXPECTED.organizationId,
      projectId: EXPECTED.projectId,
      projectName: EXPECTED.projectName,
      branchId: EXPECTED.branchId,
      branchName: EXPECTED.branchName,
      endpointId: EXPECTED.endpointId,
      region: EXPECTED.region,
      postgresMajor: EXPECTED.postgresMajor,
      computeCU: EXPECTED.computeCU,
      directHostname: EXPECTED.directHostname,
      databaseId: EXPECTED.databaseId,
      databaseName: EXPECTED.databaseName,
      ownerRole: EXPECTED.ownerRole,
      creationMode: "ROOT_BY_NEW_PROJECT_CREATE_CONTRACT",
      passwordlessAccess: true,
      passwordlessAccessMeaning: EXPECTED.passwordlessAccessMeaning,
      passwordlessAccessContractReference: EXPECTED.passwordlessAccessContractReference,
      passwordlessConnectDocumentationReference: EXPECTED.passwordlessConnectDocumentationReference,
      rootLineageAttestation: EXPECTED.rootLineageAttestation,
      rootLineageAttestationSha256,
    },
    tls: {
      sslmode: "verify-full",
      channelBinding: "require",
      caBundleSource: EXPECTED.caBundleSource,
      caBundleSha256,
      caBundleObservedAtUtc: "2026-10-15T12:35:00.000Z",
    },
    readOnlyQueryApproval: {
      status: "SIGNED",
      ownerReference: "owner-controlled key record",
      sourceSha,
      expectedStateSha256,
      queryPacketSha256: EXPECTED.queryPacketSha256,
      rootLineageAttestationSha256,
      ownerPublicKeyFingerprint: publicKeyFingerprint,
      issuedAtUtc: "2026-10-15T12:40:00.000Z",
      expiresAtUtc: "2026-10-15T12:45:00.000Z",
    },
  };
}

function createExpectedState(targetManifest = createTargetManifest()) {
  const provider = targetManifest.provider;
  const rootLineageAttestationSha256 = getRootLineageAttestationSha256();
  return {
    schemaVersion: 1,
    state: "ROOT_VERIFIED_CATALOG_UNKNOWN",
    binding: {
      organizationId: EXPECTED.organizationId,
      projectId: EXPECTED.projectId,
      branchId: EXPECTED.branchId,
      endpointId: EXPECTED.endpointId,
      directHostname: EXPECTED.directHostname,
      databaseId: EXPECTED.databaseId,
      databaseName: EXPECTED.databaseName,
      ownerRole: EXPECTED.ownerRole,
      finalSourceSha: sourceSha,
      queryPacketSha256: EXPECTED.queryPacketSha256,
      rootLineageAttestationSha256,
    },
    providerExpected: {
      plan: "Free",
      creationMode: "ROOT_BY_NEW_PROJECT_CREATE_CONTRACT",
      parentIdReadback: "OMITTED_NOT_RETURNED",
      initSourceObserved: "parent-data",
      initSourceInterpretation: "AMBIGUOUS_NOT_USED_AS_LINEAGE_PROOF",
      region: EXPECTED.region,
      postgresMajor: EXPECTED.postgresMajor,
      computeCU: EXPECTED.computeCU,
    },
    providerObserved: {
      plan: "Free",
      projectId: EXPECTED.projectId,
      branchId: EXPECTED.branchId,
      endpointId: EXPECTED.endpointId,
      directHostname: EXPECTED.directHostname,
      databaseId: EXPECTED.databaseId,
      databaseName: EXPECTED.databaseName,
      ownerRole: EXPECTED.ownerRole,
      creationMode: "ROOT_BY_NEW_PROJECT_CREATE_CONTRACT",
      parentIdReadback: "OMITTED_NOT_RETURNED",
      initSourceObserved: "parent-data",
      initSourceInterpretation: "AMBIGUOUS_NOT_USED_AS_LINEAGE_PROOF",
      passwordlessAccess: true,
      passwordlessAccessMeaning: EXPECTED.passwordlessAccessMeaning,
      passwordlessAccessContractReference: EXPECTED.passwordlessAccessContractReference,
      passwordlessConnectDocumentationReference: EXPECTED.passwordlessConnectDocumentationReference,
      rootLineageAttestation: provider.rootLineageAttestation,
    },
    catalogExpected: {
      applicationOwnedRelationCount: 0,
      standaloneApplicationTypeCount: 0,
      drizzleJournalPresent: false,
      tlsVerified: true,
      transactionReadOnly: true,
      postgresMajor: EXPECTED.postgresMajor,
    },
    catalogObserved: {
      observedAtUtc: null,
      databaseName: null,
      databaseOid: null,
      databaseOwner: null,
      currentRole: null,
      serverVersion: null,
      tls: null,
      transactionReadOnly: null,
      schemas: null,
      relations: null,
      nonSystemTypeObjectCount: null,
      standaloneApplicationTypeCount: null,
      types: null,
      routines: null,
      extensions: null,
      roleAttributes: null,
      roleMemberships: null,
      defaultAcl: null,
      drizzleJournalPresent: null,
      sanitizedEvidenceReference: null,
    },
  };
}

function createSignedApproval(overrides: Record<string, unknown> = {}, signingKey = keyPair.privateKey) {
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    purpose: "karturt-v1-staging-read-only-catalog",
    organizationId: EXPECTED.organizationId,
    projectId: EXPECTED.projectId,
    branchId: EXPECTED.branchId,
    endpointId: EXPECTED.endpointId,
    rootLineageAttestationSha256: getRootLineageAttestationSha256(),
    directHostname: EXPECTED.directHostname,
    databaseId: EXPECTED.databaseId,
    databaseName: EXPECTED.databaseName,
    ownerRole: EXPECTED.ownerRole,
    applicationSourceSha: sourceSha,
    expectedStateSha256,
    queryPacketSha256: EXPECTED.queryPacketSha256,
    caBundleSha256,
    ownerPublicKeyFingerprint,
    issuedAtUtc: "2026-10-15T12:40:00.000Z",
    expiresAtUtc: "2026-10-15T12:45:00.000Z",
    ...overrides,
  };
  const signatureBase64 = sign(null, Buffer.from(JSON.stringify(payload), "utf8"), signingKey).toString("base64");
  return { payload, signatureBase64 };
}

const keyPair = generateKeyPairSync("ed25519");
const ownerPublicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const ownerPublicKeyFingerprint = createHash("sha256")
  .update(keyPair.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");

function approvalOptions(overrides: Record<string, unknown> = {}) {
  return {
    applicationSourceSha: sourceSha,
    expectedStateSha256,
    caBundleSha256,
    ownerPublicKeyFingerprint,
    publicKeyPem: ownerPublicKeyPem,
    nowMs: fixedNow,
    ...overrides,
  };
}

describe("Wave 13B.2 offline local preflight", () => {
  it("accepts only PostgreSQL 18 client and rejects missing or altered CA bytes", () => {
    expect(() => assertPostgres18Version("psql (PostgreSQL) 18.0")).not.toThrow();
    expect(() => assertPostgres18Version("psql (PostgreSQL) 17.6")).toThrow();
    expect(() => assertSha256Matches(Buffer.alloc(0), caBundleSha256)).toThrow();
    expect(() => assertSha256Matches(Buffer.from("different CA"), caBundleSha256)).toThrow();
    expect(() => assertSha256Matches(Buffer.from("trusted CA fixture"), caBundleSha256)).not.toThrow();
  });

  it("requires direct target, verify-full, PGPASSFILE, and PGSSLROOTCERT bindings", () => {
    const secretDir = join(tmpdir(), "KarturtStageOperator");
    const base = {
      PGHOST: EXPECTED.directHostname,
      PGPORT: "5432",
      PGDATABASE: EXPECTED.databaseName,
      PGUSER: EXPECTED.ownerRole,
      PGSSLMODE: "verify-full",
      PGCHANNELBINDING: "require",
      PGPASSFILE: join(secretDir, "pgpass.conf"),
      PGSSLROOTCERT: join(secretDir, "cacert.pem"),
    };
    expect(() => assertBoundLibpqEnvironment(base, secretDir)).not.toThrow();
    expect(() => assertBoundLibpqEnvironment({ ...base, PGHOST: "ep-mute-firefly-azjcru4h.pg.neon.tech" }, secretDir)).toThrow();
    expect(() => assertBoundLibpqEnvironment({ ...base, PGSSLMODE: "require" }, secretDir)).toThrow();
    expect(() => assertBoundLibpqEnvironment({ ...base, PGPASSFILE: undefined }, secretDir)).toThrow();
    expect(() => assertBoundLibpqEnvironment({ ...base, PGSSLROOTCERT: undefined }, secretDir)).toThrow();
    expect(() => assertBoundLibpqEnvironment({ ...base, PGPASSWORD: "never-allowed" }, secretDir)).toThrow();
  });

  it("rejects target or lineage JSON edits and retains omitted parent plus ambiguous init_source", () => {
    const manifest = createTargetManifest();
    expect(() => assertRootLineageAttestation(manifest.provider.rootLineageAttestation)).not.toThrow();
    expect(() => assertTargetManifestBinding(manifest, sourceSha)).not.toThrow();
    expect(() => assertCandidateTargetBinding(manifest, sourceSha)).not.toThrow();
    expect(() => assertExpectedStateBinding(createExpectedState(manifest), manifest, sourceSha)).not.toThrow();
    expect("parentId" in EXPECTED.rootLineageAttestation.branch).toBe(false);
    expect(() => assertNoInventedLineageNulls({ parentId: null })).toThrow();

    const wrongTarget = structuredClone(manifest);
    Reflect.set(wrongTarget.provider, "projectId", "falling-bread-33359184");
    expect(() => assertTargetManifestBinding(wrongTarget, sourceSha)).toThrow();

    const tamperedAttestation = structuredClone(manifest.provider.rootLineageAttestation);
    Reflect.set(tamperedAttestation.branch, "parentIdReadback", null);
    expect(() => assertRootLineageAttestation(tamperedAttestation)).toThrow();

    const alteredExpectedState = createExpectedState(manifest);
    alteredExpectedState.providerObserved.initSourceObserved = "no-data";
    expect(() => assertExpectedStateBinding(alteredExpectedState, manifest, sourceSha)).toThrow();
  });

  it("rejects missing ACL proof and symlink or reparse-point paths", () => {
    expect(() => assertWindowsAclCheckerResult("PASS\r\n")).not.toThrow();
    expect(() => assertWindowsAclCheckerResult("BLOCKED\r\n")).toThrow();

    const root = tempDirectory();
    const targetDirectory = join(root, "target");
    mkdirSync(targetDirectory);
    const linkPath = join(root, "linked");
    try {
      symlinkSync(targetDirectory, linkPath, process.platform === "win32" ? "junction" : "dir");
      expect(() => assertNoReparsePoints(linkPath)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      temporaryDirectories.splice(temporaryDirectories.indexOf(root), 1);
    }
  });

  it.skipIf(process.platform !== "win32")("checks real Windows owner-only ACLs and rejects an Everyone ACE", () => {
    const root = tempDirectory();
    const protectedDirectory = join(root, "protected");
    mkdirSync(protectedDirectory);
    const aclChecker = resolve(process.cwd(), "scripts/check-wave13b2-secret-acl.ps1");
    const powershell = resolveWindowsPowerShellExecutable();
    let lastAclOutput = "";
    const currentSid = execFileSync(powershell, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    ], { encoding: "utf8" }).trim();

    execFileSync("icacls.exe", [
      protectedDirectory,
      "/inheritance:r",
      "/grant:r",
      `*${currentSid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F",
    ], { stdio: "ignore" });
    const protectedFile = join(protectedDirectory, "owner-only.json");
    writeFileSync(protectedFile, "{}", { encoding: "utf8" });

    const runAclChecker = (path: string, requireProtected: boolean) => {
      const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", aclChecker, "-Path", path];
      if (requireProtected) args.push("-RequireProtected");
      args.push("-Verbose");
      try {
        lastAclOutput = execFileSync(powershell, args, { encoding: "utf8" }).trim();
      } catch (error) {
        lastAclOutput = (error as NodeJS.ErrnoException & { stdout?: Buffer }).stdout?.toString("utf8").trim() ?? "";
        if (!lastAclOutput) throw error;
      }
      return lastAclOutput.split(/\r?\n/).at(-1) ?? "";
    };

    expect(runAclChecker(protectedDirectory, true), `${currentSid}\n${lastAclOutput}`).toBe("PASS");
    expect(runAclChecker(protectedFile, false)).toBe("PASS");
    execFileSync("icacls.exe", [protectedFile, "/grant", "*S-1-1-0:R"], { stdio: "ignore" });
    expect(runAclChecker(protectedFile, false)).toBe("BLOCKED");
  });

  it("rejects an unresolved or wrong source commit", () => {
    expect(() => assertSourceCommit(resolve(process.cwd()), "f".repeat(40))).toThrow();
  });

  it("accepts an exact signed query approval and rejects wrong source, expiry, key, signature, or tampered JSON", () => {
    const valid = createSignedApproval();
    expect(Object.keys(valid.payload)).toEqual(QUERY_APPROVAL_PAYLOAD_KEYS);
    expect(() => assertQueryApprovalArtifact(valid, approvalOptions())).not.toThrow();

    const wrongSource = createSignedApproval({ applicationSourceSha: "f".repeat(40) });
    expect(() => assertQueryApprovalArtifact(wrongSource, approvalOptions())).toThrow();

    const expired = createSignedApproval({
      issuedAtUtc: "2026-10-15T12:20:00.000Z",
      expiresAtUtc: "2026-10-15T12:35:00.000Z",
    });
    expect(() => assertQueryApprovalArtifact(expired, approvalOptions())).toThrow();

    const otherKey = generateKeyPairSync("ed25519");
    const badSignature = createSignedApproval({}, otherKey.privateKey);
    expect(() => assertQueryApprovalArtifact(badSignature, approvalOptions())).toThrow();
    expect(() => assertQueryApprovalArtifact(valid, approvalOptions({
      publicKeyPem: otherKey.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }))).toThrow();

    const wrongQueryDigest = createSignedApproval({ queryPacketSha256: "0".repeat(64) });
    expect(() => assertQueryApprovalArtifact(wrongQueryDigest, approvalOptions())).toThrow();
    const tampered = structuredClone(valid);
    tampered.payload.projectId = "falling-bread-33359184";
    expect(() => assertQueryApprovalArtifact(tampered, approvalOptions())).toThrow();
    expect(() => assertQueryApprovalArtifact(valid, approvalOptions({
      applicationSourceSha: "f".repeat(40),
    }))).toThrow();
  });
});

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});
