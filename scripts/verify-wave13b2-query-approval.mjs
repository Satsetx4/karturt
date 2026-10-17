import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoReparsePoints,
  assertNoInventedLineageNulls,
  getRootLineageAttestationSha256,
  assertRootLineageAttestation,
  assertOwnerSecretDirectoryBinding,
  assertCleanExactSourceCommit,
  configureGitExecutable,
  WAVE13B2_LOCAL_PREFLIGHT_EXPECTED as PREFLIGHT_EXPECTED,
} from './preflight-wave13b2-local.mjs';

const EXPECTED = Object.freeze({
  organizationId: 'org-ancient-boat-57106549',
  projectId: 'broad-star-40451875',
  projectName: 'karturt-v1-synthetic-staging-20261015',
  branchId: 'br-orange-recipe-azed9f78',
  branchName: 'main',
  endpointId: 'ep-mute-firefly-azjcru4h',
  directHostname: 'ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech',
  databaseId: '708081',
  databaseName: 'neondb',
  ownerRole: 'neondb_owner',
  region: 'aws-ap-southeast-1',
  postgresMajor: 18,
  computeCU: 0.25,
  queryPacketSha256: PREFLIGHT_EXPECTED.queryPacketSha256,
  migrationManifestFingerprint: 'e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4',
  caBundleSource: 'https://curl.se/ca/cacert.pem',
  passwordlessAccessMeaning: 'NOT_YET_IMPLEMENTED_UNRELIED_UPON',
  passwordlessAccessContractReference: 'https://neon.com/api_spec/release/v2.json',
  passwordlessConnectDocumentationReference: 'https://neon.com/docs/connect/passwordless-connect',
});

export const QUERY_APPROVAL_PAYLOAD_KEYS = Object.freeze([
  'schemaVersion',
  'purpose',
  'organizationId',
  'projectId',
  'branchId',
  'endpointId',
  'rootLineageAttestationSha256',
  'directHostname',
  'databaseId',
  'databaseName',
  'ownerRole',
  'applicationSourceSha',
  'expectedStateSha256',
  'queryPacketSha256',
  'caBundleSha256',
  'ownerPublicKeyFingerprint',
  'issuedAtUtc',
  'expiresAtUtc',
]);

export const WAVE13B2_MINIMUM_QUERY_APPROVAL_REMAINING_MS = 120_000;

function requireCondition(condition) {
  if (!condition) throw new Error('approval precondition failed');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasExactKeys(value, expectedKeys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(expectedKeys);
}

function hasUtcCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertHash(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}

export function assertTargetManifestBinding(targetManifest, applicationSourceSha) {
  requireCondition(targetManifest && typeof targetManifest === 'object');
  requireCondition(targetManifest.schemaVersion === 1);
  requireCondition(targetManifest.state === 'ROOT_VERIFIED_CATALOG_UNKNOWN');
  requireCondition(targetManifest.finalApprovalSourceSha === applicationSourceSha);
  requireCondition(targetManifest.migrationManifestFingerprint === EXPECTED.migrationManifestFingerprint);

  const provider = targetManifest.provider;
  requireCondition(provider && typeof provider === 'object');
  assertNoInventedLineageNulls(provider);
  requireCondition(provider.plan === 'Free' && provider.freeOnlyConfirmed === true);
  requireCondition(provider.organizationId === EXPECTED.organizationId);
  requireCondition(provider.projectId === EXPECTED.projectId);
  requireCondition(provider.projectName === EXPECTED.projectName);
  requireCondition(provider.branchId === EXPECTED.branchId);
  requireCondition(provider.branchName === EXPECTED.branchName);
  requireCondition(provider.endpointId === EXPECTED.endpointId);
  requireCondition(provider.region === EXPECTED.region);
  requireCondition(provider.postgresMajor === EXPECTED.postgresMajor);
  requireCondition(provider.computeCU === EXPECTED.computeCU);
  requireCondition(provider.creationMode === 'ROOT_BY_NEW_PROJECT_CREATE_CONTRACT');
  requireCondition(provider.directHostname === EXPECTED.directHostname);
  requireCondition(String(provider.databaseId) === EXPECTED.databaseId);
  requireCondition(provider.databaseName === EXPECTED.databaseName);
  requireCondition(provider.ownerRole === EXPECTED.ownerRole);
  requireCondition(provider.passwordlessAccess === true);
  requireCondition(provider.passwordlessAccessMeaning === EXPECTED.passwordlessAccessMeaning);
  requireCondition(provider.passwordlessAccessContractReference === EXPECTED.passwordlessAccessContractReference);
  requireCondition(provider.passwordlessConnectDocumentationReference === EXPECTED.passwordlessConnectDocumentationReference);
  requireCondition(!provider.directHostname.endsWith('.pg.neon.tech'));
  requireCondition(!provider.directHostname.toLowerCase().includes('pooler'));
  assertRootLineageAttestation(provider.rootLineageAttestation);
  requireCondition(provider.rootLineageAttestationSha256 === getRootLineageAttestationSha256());

  const tls = targetManifest.tls;
  requireCondition(tls && typeof tls === 'object');
  requireCondition(tls.sslmode === 'verify-full');
  requireCondition(tls.channelBinding === 'require');
  requireCondition(tls.caBundleSource === EXPECTED.caBundleSource);
  assertHash(tls.caBundleSha256);
  requireCondition(hasUtcCanonicalTimestamp(tls.caBundleObservedAtUtc));

  const queryApprovalRecord = targetManifest.readOnlyQueryApproval;
  requireCondition(hasExactKeys(queryApprovalRecord, [
    'status', 'ownerReference', 'sourceSha', 'expectedStateSha256', 'queryPacketSha256',
    'rootLineageAttestationSha256', 'ownerPublicKeyFingerprint', 'issuedAtUtc', 'expiresAtUtc',
  ]));
  requireCondition(queryApprovalRecord.status === 'SIGNED');
  requireCondition(queryApprovalRecord.sourceSha === applicationSourceSha);
  requireCondition(queryApprovalRecord.queryPacketSha256 === EXPECTED.queryPacketSha256);
  requireCondition(queryApprovalRecord.rootLineageAttestationSha256 === getRootLineageAttestationSha256());
  requireCondition(queryApprovalRecord.expectedStateSha256 && /^[a-f0-9]{64}$/.test(queryApprovalRecord.expectedStateSha256));
  assertHash(queryApprovalRecord.ownerPublicKeyFingerprint);
  requireCondition(hasUtcCanonicalTimestamp(queryApprovalRecord.issuedAtUtc));
  requireCondition(hasUtcCanonicalTimestamp(queryApprovalRecord.expiresAtUtc));
  return true;
}

export function assertExpectedStateBinding(expectedState, targetManifest, applicationSourceSha) {
  requireCondition(expectedState && typeof expectedState === 'object');
  requireCondition(expectedState.schemaVersion === 1);
  requireCondition(expectedState.state === 'ROOT_VERIFIED_CATALOG_UNKNOWN');
  const expected = expectedState.providerExpected;
  const observed = expectedState.providerObserved;
  const binding = expectedState.binding;
  requireCondition(expected && typeof expected === 'object');
  requireCondition(observed && typeof observed === 'object');
  assertNoInventedLineageNulls(expected);
  assertNoInventedLineageNulls(observed);
  requireCondition(binding && typeof binding === 'object');
  requireCondition(expected.plan === 'Free');
  requireCondition(expected.creationMode === 'ROOT_BY_NEW_PROJECT_CREATE_CONTRACT');
  requireCondition(expected.parentIdReadback === 'OMITTED_NOT_RETURNED');
  requireCondition(expected.initSourceObserved === 'parent-data');
  requireCondition(expected.initSourceInterpretation === 'AMBIGUOUS_NOT_USED_AS_LINEAGE_PROOF');
  requireCondition(expected.region === EXPECTED.region);
  requireCondition(expected.postgresMajor === EXPECTED.postgresMajor);
  requireCondition(expected.computeCU === EXPECTED.computeCU);
  requireCondition(observed.plan === 'Free');
  requireCondition(observed.projectId === EXPECTED.projectId);
  requireCondition(observed.branchId === EXPECTED.branchId);
  requireCondition(observed.endpointId === EXPECTED.endpointId);
  requireCondition(observed.directHostname === EXPECTED.directHostname);
  requireCondition(String(observed.databaseId) === EXPECTED.databaseId);
  requireCondition(observed.databaseName === EXPECTED.databaseName);
  requireCondition(observed.ownerRole === EXPECTED.ownerRole);
  requireCondition(observed.parentIdReadback === 'OMITTED_NOT_RETURNED');
  requireCondition(observed.initSourceObserved === 'parent-data');
  requireCondition(observed.initSourceInterpretation === 'AMBIGUOUS_NOT_USED_AS_LINEAGE_PROOF');
  requireCondition(observed.creationMode === 'ROOT_BY_NEW_PROJECT_CREATE_CONTRACT');
  requireCondition(observed.passwordlessAccess === true);
  requireCondition(observed.passwordlessAccessMeaning === EXPECTED.passwordlessAccessMeaning);
  requireCondition(observed.passwordlessAccessContractReference === EXPECTED.passwordlessAccessContractReference);
  requireCondition(observed.passwordlessConnectDocumentationReference === EXPECTED.passwordlessConnectDocumentationReference);
  assertRootLineageAttestation(observed.rootLineageAttestation);
  requireCondition(binding.organizationId === EXPECTED.organizationId);
  requireCondition(binding.projectId === EXPECTED.projectId);
  requireCondition(binding.branchId === EXPECTED.branchId);
  requireCondition(binding.endpointId === EXPECTED.endpointId);
  requireCondition(binding.directHostname === EXPECTED.directHostname);
  requireCondition(String(binding.databaseId) === EXPECTED.databaseId);
  requireCondition(binding.databaseName === EXPECTED.databaseName);
  requireCondition(binding.ownerRole === EXPECTED.ownerRole);
  requireCondition(binding.finalSourceSha === applicationSourceSha);
  requireCondition(binding.queryPacketSha256 === EXPECTED.queryPacketSha256);

  const rootSha = getRootLineageAttestationSha256();
  requireCondition(binding.rootLineageAttestationSha256 === rootSha);
  requireCondition(targetManifest.provider.rootLineageAttestationSha256 === rootSha);
  requireCondition(targetManifest.readOnlyQueryApproval.rootLineageAttestationSha256 === rootSha);

  const expectedCatalog = expectedState.catalogExpected;
  const observedCatalog = expectedState.catalogObserved;
  requireCondition(expectedCatalog.applicationOwnedRelationCount === 0);
  requireCondition(expectedCatalog.standaloneApplicationTypeCount === 0);
  requireCondition(expectedCatalog.drizzleJournalPresent === false);
  requireCondition(expectedCatalog.tlsVerified === true);
  requireCondition(expectedCatalog.transactionReadOnly === true);
  requireCondition(expectedCatalog.postgresMajor === EXPECTED.postgresMajor);
  requireCondition(observedCatalog && typeof observedCatalog === 'object');
  requireCondition(Object.values(observedCatalog).every((value) => value === null));
  requireCondition(Object.values(observedCatalog).every((value) => value === null));
  return true;
}

export function assertQueryApprovalArtifact(approval, options) {
  const {
    applicationSourceSha,
    expectedStateSha256,
    caBundleSha256,
    ownerPublicKeyFingerprint,
    publicKeyPem,
    nowMs = Date.now(),
  } = options;
  assertHash(expectedStateSha256);
  assertHash(caBundleSha256);
  assertHash(ownerPublicKeyFingerprint);
  requireCondition(/^[a-f0-9]{40}$/.test(applicationSourceSha));
  requireCondition(typeof publicKeyPem === 'string' && /^-----BEGIN PUBLIC KEY-----\s/.test(publicKeyPem));
  requireCondition(hasExactKeys(approval, ['payload', 'signatureBase64']));
  const payload = approval.payload;
  requireCondition(hasExactKeys(payload, QUERY_APPROVAL_PAYLOAD_KEYS));

  const rootLineageAttestationSha256 = sha256(Buffer.from(JSON.stringify(PREFLIGHT_EXPECTED.rootLineageAttestation), 'utf8'));
  requireCondition(payload.schemaVersion === 1);
  requireCondition(payload.purpose === 'karturt-v1-staging-read-only-catalog');
  requireCondition(payload.organizationId === EXPECTED.organizationId);
  requireCondition(payload.projectId === EXPECTED.projectId);
  requireCondition(payload.branchId === EXPECTED.branchId);
  requireCondition(payload.endpointId === EXPECTED.endpointId);
  requireCondition(payload.rootLineageAttestationSha256 === rootLineageAttestationSha256);
  requireCondition(payload.directHostname === EXPECTED.directHostname);
  requireCondition(String(payload.databaseId) === EXPECTED.databaseId);
  requireCondition(payload.databaseName === EXPECTED.databaseName);
  requireCondition(payload.ownerRole === EXPECTED.ownerRole);
  requireCondition(payload.applicationSourceSha === applicationSourceSha);
  requireCondition(payload.expectedStateSha256 === expectedStateSha256);
  requireCondition(payload.queryPacketSha256 === EXPECTED.queryPacketSha256);
  requireCondition(payload.caBundleSha256 === caBundleSha256);
  requireCondition(payload.ownerPublicKeyFingerprint === ownerPublicKeyFingerprint);
  requireCondition(hasUtcCanonicalTimestamp(payload.issuedAtUtc));
  requireCondition(hasUtcCanonicalTimestamp(payload.expiresAtUtc));
  const issuedAt = Date.parse(payload.issuedAtUtc);
  const expiresAt = Date.parse(payload.expiresAtUtc);
  requireCondition(expiresAt > issuedAt && expiresAt - issuedAt <= 15 * 60 * 1000);
  requireCondition(
    issuedAt <= nowMs + 30 * 1000 &&
      expiresAt > nowMs + WAVE13B2_MINIMUM_QUERY_APPROVAL_REMAINING_MS,
  );

  const publicKey = createPublicKey(publicKeyPem);
  requireCondition(publicKey.asymmetricKeyType === 'ed25519');
  const actualFingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  requireCondition(actualFingerprint === ownerPublicKeyFingerprint);
  requireCondition(typeof approval.signatureBase64 === 'string');
  requireCondition(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(approval.signatureBase64));
  const signature = Buffer.from(approval.signatureBase64, 'base64');
  requireCondition(signature.length === 64 && signature.toString('base64') === approval.signatureBase64);
  requireCondition(verify(null, Buffer.from(JSON.stringify(payload), 'utf8'), publicKey, signature));
  return true;
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(['--repo-root', '--secret-dir', '--application-source-sha', '--trusted-public-key-fingerprint', '--git-path']);
  requireCondition(argv.length === allowed.size * 2);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    requireCondition(allowed.has(key) && !values.has(key));
    requireCondition(typeof argv[index + 1] === 'string' && argv[index + 1].length > 0);
    values.set(key, argv[index + 1]);
  }
  requireCondition(values.size === allowed.size);
  return values;
}

function fileAtExactPath(filePath) {
  requireCondition(isAbsolute(filePath));
  const stat = lstatSync(filePath);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0);
  assertNoReparsePoints(filePath);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function assertSourceCommit(repoRoot, applicationSourceSha) {
  return assertCleanExactSourceCommit(repoRoot, applicationSourceSha);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(args.get('--repo-root'));
  const secretDir = resolve(args.get('--secret-dir'));
  const applicationSourceSha = args.get('--application-source-sha');
  const trustedPublicKeyFingerprint = args.get('--trusted-public-key-fingerprint');
  configureGitExecutable(args.get('--git-path'));
  requireCondition(/^[a-f0-9]{64}$/.test(trustedPublicKeyFingerprint));
  requireCondition(typeof process.env.LOCALAPPDATA === 'string' && process.env.LOCALAPPDATA.length > 0);
  assertOwnerSecretDirectoryBinding(secretDir, process.env.LOCALAPPDATA, applicationSourceSha);
  assertNoReparsePoints(repoRoot);
  assertNoReparsePoints(secretDir);
  assertSourceCommit(repoRoot, applicationSourceSha);

  const queryPath = resolve(repoRoot, 'docs/codex/wave13b2-read-only-catalog-preflight.sql');
  const targetManifestPath = resolve(secretDir, 'wave13b2-staging-target-manifest.local.json');
  const expectedStatePath = resolve(secretDir, 'wave13b2-staging-expected-state.local.json');
  const approvalPath = resolve(secretDir, 'wave13b2-read-only-query-approval.local.json');
  const publicKeyPath = resolve(secretDir, 'wave13b2-owner-signing-public.pem');
  const caBundlePath = resolve(secretDir, 'cacert.pem');
  const passwordFilePath = resolve(secretDir, 'pgpass.conf');
  for (const filePath of [queryPath, targetManifestPath, expectedStatePath, approvalPath, publicKeyPath, caBundlePath, passwordFilePath]) {
    fileAtExactPath(filePath);
  }

  const targetManifest = readJson(targetManifestPath);
  const expectedState = readJson(expectedStatePath);
  const approval = readJson(approvalPath);
  assertTargetManifestBinding(targetManifest, applicationSourceSha);
  assertExpectedStateBinding(expectedState, targetManifest, applicationSourceSha);
  const publicKeyPem = readFileSync(publicKeyPath, 'utf8');
  const queryBytes = readFileSync(queryPath);
  const expectedStateBytes = readFileSync(expectedStatePath);
  const caBundleBytes = readFileSync(caBundlePath);
  requireCondition(sha256(queryBytes) === EXPECTED.queryPacketSha256);
  requireCondition(sha256(expectedStateBytes) === targetManifest.readOnlyQueryApproval.expectedStateSha256);
  requireCondition(sha256(caBundleBytes) === targetManifest.tls.caBundleSha256);
  requireCondition(targetManifest.readOnlyQueryApproval.ownerPublicKeyFingerprint === trustedPublicKeyFingerprint);
  assertQueryApprovalArtifact(approval, {
    applicationSourceSha,
    expectedStateSha256: sha256(expectedStateBytes),
    caBundleSha256: sha256(caBundleBytes),
    ownerPublicKeyFingerprint: trustedPublicKeyFingerprint,
    publicKeyPem,
  });
  process.stdout.write('PASS\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch {
    process.stdout.write('BLOCKED\n');
    process.exitCode = 2;
  }
}
