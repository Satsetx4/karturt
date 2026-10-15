import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const EXPECTED = Object.freeze({
  organizationId: 'org-ancient-boat-57106549',
  projectId: 'broad-star-40451875',
  projectName: 'karturt-v1-synthetic-staging-20261015',
  branchId: 'br-orange-recipe-azed9f78',
  endpointId: 'ep-mute-firefly-azjcru4h',
  region: 'aws-ap-southeast-1',
  postgresMajor: 18,
  computeCU: 0.25,
  queryPacketSha256: '987570baee76c2affef4a3f68c2ae114b3007174004d070232908c82f513751e',
  migrationManifestFingerprint: 'e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4',
  caBundleSource: 'https://curl.se/ca/cacert.pem',
});

const PAYLOAD_KEYS = [
  'schemaVersion',
  'purpose',
  'organizationId',
  'projectId',
  'branchId',
  'endpointId',
  'directHostname',
  'databaseId',
  'databaseName',
  'ownerRole',
  'parentId',
  'sourceProjectId',
  'applicationSourceSha',
  'expectedStateSha256',
  'queryPacketSha256',
  'caBundleSha256',
  'ownerPublicKeyFingerprint',
  'issuedAtUtc',
  'expiresAtUtc',
];

function requireCondition(condition) {
  if (!condition) throw new Error('approval precondition failed');
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set([
    '--repo-root',
    '--secret-dir',
    '--application-source-sha',
    '--trusted-public-key-fingerprint',
  ]);
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
  return filePath;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function hasUtcCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertHash(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}

function assertNonEmptyString(value) {
  requireCondition(typeof value === 'string' && value.trim().length > 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(args.get('--repo-root'));
  const secretDir = resolve(args.get('--secret-dir'));
  const applicationSourceSha = args.get('--application-source-sha');
  const trustedPublicKeyFingerprint = args.get('--trusted-public-key-fingerprint');

  requireCondition(/^[a-f0-9]{40}$/.test(applicationSourceSha));
  assertHash(trustedPublicKeyFingerprint);
  requireCondition(typeof process.env.LOCALAPPDATA === 'string' && process.env.LOCALAPPDATA.length > 0);
  const expectedSecretDir = resolve(process.env.LOCALAPPDATA, 'KarturtStageOperator');
  requireCondition(secretDir.toLowerCase() === expectedSecretDir.toLowerCase());

  const resolvedSourceCommit = execFileSync('git', ['rev-parse', '--verify', `${applicationSourceSha}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  requireCondition(resolvedSourceCommit === applicationSourceSha);
  const checkedOutHead = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  execFileSync('git', ['merge-base', '--is-ancestor', applicationSourceSha, checkedOutHead], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  const sourcePathspec = [
    '.',
    ':(exclude)docs/**',
    ':(exclude).gitignore',
    ':(exclude)scripts/verify-wave13b2-query-approval.mjs',
  ];
  execFileSync('git', ['diff', '--quiet', applicationSourceSha, '--', ...sourcePathspec], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  execFileSync('git', ['diff', '--quiet', applicationSourceSha, checkedOutHead, '--', ...sourcePathspec], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  execFileSync('git', ['diff', '--cached', '--quiet', applicationSourceSha, '--', ...sourcePathspec], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  const sourceStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'drizzle'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  requireCondition(sourceStatus.length === 0);
  const untrackedPaths = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).split('\0').filter(Boolean);
  const approvedUntracked = new Set([
    'docs/codex/Wave-13B2-Free-Only-Staging-Operator-Packet-2026-10-15.md',
    'docs/codex/wave13b2-read-only-catalog-preflight.sql',
    'docs/codex/wave13b2-staging-expected-state.template.json',
    'docs/codex/wave13b2-staging-target-manifest.template.json',
    'scripts/verify-wave13b2-query-approval.mjs',
  ]);
  requireCondition(untrackedPaths.every((filePath) => approvedUntracked.has(filePath)));

  const queryPath = resolve(repoRoot, 'docs/codex/wave13b2-read-only-catalog-preflight.sql');
  const targetManifestPath = resolve(secretDir, 'wave13b2-staging-target-manifest.local.json');
  const expectedStatePath = resolve(secretDir, 'wave13b2-staging-expected-state.local.json');
  const approvalPath = resolve(secretDir, 'wave13b2-read-only-query-approval.local.json');
  const publicKeyPath = resolve(secretDir, 'wave13b2-owner-signing-public.pem');
  const caBundlePath = resolve(secretDir, 'cacert.pem');
  const passwordFilePath = resolve(secretDir, 'pgpass.conf');

  requireCondition(resolve(queryPath) === join(repoRoot, 'docs/codex/wave13b2-read-only-catalog-preflight.sql'));
  for (const filePath of [
    queryPath,
    targetManifestPath,
    expectedStatePath,
    approvalPath,
    publicKeyPath,
    caBundlePath,
    passwordFilePath,
  ]) {
    fileAtExactPath(filePath);
  }

  const targetManifest = readJson(targetManifestPath);
  const expectedState = readJson(expectedStatePath);
  const approval = readJson(approvalPath);
  requireCondition(targetManifest.schemaVersion === 1);
  requireCondition(targetManifest.state === 'ROOT_VERIFIED_CATALOG_UNKNOWN');
  requireCondition(expectedState.schemaVersion === 1);
  requireCondition(Object.keys(approval).length === 2);
  requireCondition(Object.keys(approval)[0] === 'payload');
  requireCondition(Object.keys(approval)[1] === 'signatureBase64');
  const payload = approval.payload;
  requireCondition(payload && typeof payload === 'object' && !Array.isArray(payload));
  requireCondition(JSON.stringify(Object.keys(payload)) === JSON.stringify(PAYLOAD_KEYS));

  requireCondition(payload.schemaVersion === 1);
  requireCondition(payload.purpose === 'karturt-v1-staging-read-only-catalog');
  requireCondition(payload.organizationId === EXPECTED.organizationId);
  requireCondition(payload.projectId === EXPECTED.projectId);
  requireCondition(payload.branchId === EXPECTED.branchId);
  requireCondition(payload.endpointId === EXPECTED.endpointId);
  requireCondition(payload.parentId === null);
  requireCondition(payload.sourceProjectId === null);
  requireCondition(payload.applicationSourceSha === applicationSourceSha);
  assertHash(payload.expectedStateSha256);
  assertHash(payload.queryPacketSha256);
  assertHash(payload.caBundleSha256);
  assertHash(payload.ownerPublicKeyFingerprint);
  requireCondition(payload.queryPacketSha256 === EXPECTED.queryPacketSha256);

  assertNonEmptyString(payload.directHostname);
  requireCondition(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(payload.directHostname));
  assertNonEmptyString(payload.databaseId);
  assertNonEmptyString(payload.databaseName);
  assertNonEmptyString(payload.ownerRole);

  requireCondition(hasUtcCanonicalTimestamp(payload.issuedAtUtc));
  requireCondition(hasUtcCanonicalTimestamp(payload.expiresAtUtc));
  const issuedAt = Date.parse(payload.issuedAtUtc);
  const expiresAt = Date.parse(payload.expiresAtUtc);
  const now = Date.now();
  requireCondition(expiresAt > issuedAt && expiresAt - issuedAt <= 15 * 60 * 1000);
  requireCondition(issuedAt <= now + 30 * 1000 && expiresAt > now);

  const publicKeyPem = readFileSync(publicKeyPath);
  requireCondition(/^-----BEGIN PUBLIC KEY-----\s/.test(publicKeyPem.toString('ascii')));
  const publicKey = createPublicKey(publicKeyPem);
  requireCondition(publicKey.asymmetricKeyType === 'ed25519');
  const actualPublicKeyFingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  requireCondition(actualPublicKeyFingerprint === trustedPublicKeyFingerprint);
  requireCondition(payload.ownerPublicKeyFingerprint === trustedPublicKeyFingerprint);
  requireCondition(typeof approval.signatureBase64 === 'string');
  requireCondition(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(approval.signatureBase64));
  const signature = Buffer.from(approval.signatureBase64, 'base64');
  requireCondition(signature.length === 64 && signature.toString('base64') === approval.signatureBase64);
  const canonicalPayload = Buffer.from(JSON.stringify(payload), 'utf8');
  requireCondition(verify(null, canonicalPayload, publicKey, signature));

  const provider = targetManifest.provider;
  requireCondition(provider.plan === 'Free' && provider.freeOnlyConfirmed === true);
  requireCondition(provider.organizationId === EXPECTED.organizationId);
  requireCondition(provider.projectId === EXPECTED.projectId);
  requireCondition(provider.projectName === EXPECTED.projectName);
  requireCondition(provider.branchId === EXPECTED.branchId);
  requireCondition(provider.endpointId === EXPECTED.endpointId);
  requireCondition(provider.region === EXPECTED.region);
  requireCondition(provider.postgresMajor === EXPECTED.postgresMajor);
  requireCondition(provider.computeCU === EXPECTED.computeCU);
  requireCondition(provider.creationMode === 'new-project-no-source-fields-reported');
  requireCondition(provider.parentId === null && provider.parentProjectId === null);
  requireCondition(provider.sourceProjectId === null);
  assertNonEmptyString(provider.lineageReadbackEvidenceReference);
  requireCondition(provider.directHostname === payload.directHostname);
  requireCondition(provider.databaseId === payload.databaseId);
  requireCondition(provider.databaseName === payload.databaseName);
  requireCondition(provider.ownerRole === payload.ownerRole);
  requireCondition(targetManifest.finalApprovalSourceSha === applicationSourceSha);
  requireCondition(targetManifest.migrationManifestFingerprint === EXPECTED.migrationManifestFingerprint);
  requireCondition(targetManifest.tls.sslmode === 'verify-full');
  requireCondition(targetManifest.tls.channelBinding === 'require');
  requireCondition(targetManifest.tls.caBundleSource === EXPECTED.caBundleSource);
  requireCondition(hasUtcCanonicalTimestamp(targetManifest.tls.caBundleObservedAtUtc));
  requireCondition(targetManifest.tls.caBundleSha256 === payload.caBundleSha256);
  const queryApprovalRecord = targetManifest.readOnlyQueryApproval;
  requireCondition(JSON.stringify(Object.keys(queryApprovalRecord)) === JSON.stringify([
    'status',
    'ownerReference',
    'sourceSha',
    'expectedStateSha256',
    'queryPacketSha256',
    'ownerPublicKeyFingerprint',
    'issuedAtUtc',
    'expiresAtUtc',
  ]));
  requireCondition(queryApprovalRecord.status === 'SIGNED');
  requireCondition(queryApprovalRecord.sourceSha === applicationSourceSha);
  requireCondition(queryApprovalRecord.expectedStateSha256 === payload.expectedStateSha256);
  requireCondition(queryApprovalRecord.queryPacketSha256 === EXPECTED.queryPacketSha256);
  requireCondition(queryApprovalRecord.ownerPublicKeyFingerprint === trustedPublicKeyFingerprint);
  requireCondition(queryApprovalRecord.issuedAtUtc === payload.issuedAtUtc);
  requireCondition(queryApprovalRecord.expiresAtUtc === payload.expiresAtUtc);

  const observed = expectedState.providerObserved;
  const binding = expectedState.binding;
  requireCondition(expectedState.state === 'ROOT_VERIFIED_CATALOG_UNKNOWN');
  requireCondition(expectedState.providerExpected.plan === 'Free');
  requireCondition(expectedState.providerExpected.creationMode === 'new-project-no-source-fields-reported');
  requireCondition(expectedState.providerExpected.parentProjectId === null);
  requireCondition(expectedState.providerExpected.region === EXPECTED.region);
  requireCondition(expectedState.providerExpected.postgresMajor === EXPECTED.postgresMajor);
  requireCondition(expectedState.providerExpected.computeCU === EXPECTED.computeCU);
  requireCondition(observed.plan === 'Free');
  requireCondition(observed.projectId === EXPECTED.projectId);
  requireCondition(observed.branchId === EXPECTED.branchId);
  requireCondition(observed.endpointId === EXPECTED.endpointId);
  requireCondition(observed.parentId === null && observed.parentProjectId === null);
  requireCondition(observed.sourceProjectId === null);
  requireCondition(observed.creationMode === 'new-project-no-source-fields-reported');
  assertNonEmptyString(observed.lineageReadbackEvidenceReference);
  requireCondition(observed.region === EXPECTED.region);
  requireCondition(observed.postgresMajor === EXPECTED.postgresMajor);
  requireCondition(observed.computeCU === EXPECTED.computeCU);
  requireCondition(observed.directHostname === payload.directHostname);
  requireCondition(observed.databaseId === payload.databaseId);
  requireCondition(observed.databaseName === payload.databaseName);
  requireCondition(observed.ownerRole === payload.ownerRole);
  requireCondition(binding.organizationId === EXPECTED.organizationId);
  requireCondition(binding.projectId === EXPECTED.projectId);
  requireCondition(binding.branchId === EXPECTED.branchId);
  requireCondition(binding.endpointId === EXPECTED.endpointId);
  requireCondition(binding.directHostname === payload.directHostname);
  requireCondition(binding.databaseId === payload.databaseId);
  requireCondition(binding.databaseName === payload.databaseName);
  requireCondition(binding.ownerRole === payload.ownerRole);
  requireCondition(binding.finalSourceSha === applicationSourceSha);
  requireCondition(binding.queryPacketSha256 === EXPECTED.queryPacketSha256);
  requireCondition(expectedState.providerExpected.parentId === null);
  requireCondition(expectedState.providerExpected.sourceProjectId === null);
  requireCondition(expectedState.catalogExpected.applicationOwnedRelationCount === 0);
  requireCondition(expectedState.catalogExpected.standaloneApplicationTypeCount === 0);
  requireCondition(expectedState.catalogExpected.drizzleJournalPresent === false);
  requireCondition(expectedState.catalogExpected.tlsVerified === true);
  requireCondition(expectedState.catalogExpected.transactionReadOnly === true);
  requireCondition(expectedState.catalogExpected.postgresMajor === EXPECTED.postgresMajor);
  requireCondition(Object.values(expectedState.catalogObserved).every((value) => value === null));
  requireCondition(expectedState.catalogObserved.nonSystemTypeObjectCount === null);
  requireCondition(expectedState.catalogObserved.standaloneApplicationTypeCount === null);
  requireCondition(expectedState.catalogObserved.types === null);

  const queryBytes = readFileSync(queryPath);
  const expectedStateBytes = readFileSync(expectedStatePath);
  const caBundleBytes = readFileSync(caBundlePath);
  requireCondition(sha256(queryBytes) === EXPECTED.queryPacketSha256);
  requireCondition(sha256(queryBytes) === payload.queryPacketSha256);
  requireCondition(sha256(expectedStateBytes) === payload.expectedStateSha256);
  requireCondition(sha256(caBundleBytes) === payload.caBundleSha256);

  process.stdout.write('PASS\n');
}

try {
  main();
} catch {
  process.stdout.write('BLOCKED\n');
  process.exitCode = 2;
}
