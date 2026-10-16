import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WAVE13B2_LOCAL_PREFLIGHT_EXPECTED = Object.freeze({
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
  queryPacketSha256: 'dc3c798b01de7163e26fe3aad0c574e9f1e9c248ef2555bd61ab822e116e3689',
  migrationManifestFingerprint: 'e4a95a0a841872752cbcfa9b46107a99fdb469994280e25fc9f479a54b0312b4',
  caBundleSource: 'https://curl.se/ca/cacert.pem',
  rootLineageAttestation: Object.freeze({
    schemaVersion: 1,
    method: 'ROOT_BY_NEW_PROJECT_CREATE_CONTRACT',
    scope: 'project-root-lineage-only',
    organizationId: 'org-ancient-boat-57106549',
    projectId: 'broad-star-40451875',
    projectCreatedAtUtc: '2026-10-15T11:04:56Z',
    createRequest: Object.freeze({
      method: 'POST',
      operation: 'create-project',
      sourceFieldsOmitted: Object.freeze(['parent_id', 'parent_project_id', 'source_project_id', 'clone', 'import', 'restore']),
      requestSha256: null,
      requestSha256Status: 'NOT_CAPTURED',
    }),
    branch: Object.freeze({
      id: 'br-orange-recipe-azed9f78',
      name: 'main',
      createdAtUtc: '2026-10-15T11:04:56Z',
      isPrimary: true,
      isDefault: true,
      parentIdReadback: 'OMITTED_NOT_RETURNED',
      initSourceObserved: 'parent-data',
      initSourceInterpretation: 'AMBIGUOUS_NOT_USED_AS_LINEAGE_PROOF',
    }),
    providerContracts: Object.freeze([
      Object.freeze({ url: 'https://neon.com/docs/manage/branches', sha256: null }),
      Object.freeze({ url: 'https://neon.com/docs/reference/api/projects/create-project', sha256: null }),
      Object.freeze({ url: 'https://neon.com/docs/reference/api/branches/get-project-branch', sha256: null }),
      Object.freeze({ url: 'https://neon.com/docs/reference/api/branches/create-project-branch', sha256: null }),
      Object.freeze({ url: 'https://neon.com/api_spec/release/v2.json', sha256: null }),
    ]),
    reviewer: Object.freeze({
      agent: 'f0_neon_lineage',
      verdict: 'PASS',
      reviewedAtUtc: '2026-10-15T12:32:42Z',
      summarySha256: 'dc97064182562fb2b86d7bb1d7bee9ba0c7f5d175f943f44fb4501fb9a557530',
      summarySha256Kind: 'REVIEWER_SUMMARY_CHECKSUM_NOT_PROVIDER_SIGNATURE',
      sourceReportCommit: 'f8cf71c251b87b8c37d141dc2f0e40e650797462',
      sourceReportPath: 'docs/wave13b-2/2026-10-15/WAVE13B_2_OWNER_CORRECTION_EXECUTION.md',
      verdictScope: 'ROOT_LINEAGE_ONLY_CATALOG_UNKNOWN',
    }),
    catalogState: 'UNKNOWN',
  }),
  passwordlessAccessMeaning: 'NOT_YET_IMPLEMENTED_UNRELIED_UPON',
  passwordlessAccessContractReference: 'https://neon.com/api_spec/release/v2.json',
  passwordlessConnectDocumentationReference: 'https://neon.com/docs/connect/passwordless-connect',
});

export const WAVE13B2_MIGRATION_PATHS = Object.freeze([
  'drizzle/0000_messy_menace.sql',
  'drizzle/0001_classy_ricochet.sql',
  'drizzle/0002_monthly_due_period_guard.sql',
  'drizzle/0003_due_auth_audit_domain.sql',
  'drizzle/0004_phase_5_payment_request.sql',
  'drizzle/0005_phase_5_1_payment_request_items_immutable.sql',
  'drizzle/0006_phase_6_treasurer_payment_ledger.sql',
  'drizzle/0007_phase_7_reject_cancel.sql',
  'drizzle/0008_phase_7_1_post_resolution_lifecycle.sql',
  'drizzle/0009_phase_8_cash_payment.sql',
  'drizzle/0010_phase_9_payment_reversal.sql',
  'drizzle/0011_phase_10_waiver.sql',
  'drizzle/0012_phase_11_tariff_adjustment.sql',
  'drizzle/0013_phase_12_household_management.sql',
  'drizzle/meta/_journal.json',
]);

const LOCAL_FILES = Object.freeze([
  'wave13b2-staging-target-manifest.local.json',
  'wave13b2-staging-expected-state.local.json',
  'wave13b2-read-only-query-approval.local.json',
  'wave13b2-owner-signing-public.pem',
  'cacert.pem',
  'pgpass.conf',
]);

function requireCondition(condition) {
  if (!condition) throw new Error('local preflight condition failed');
}

let gitExecutable = 'git';

export function assertWindowsExecutablePath(executablePath, executableName) {
  requireCondition(typeof executablePath === 'string' && isAbsolute(executablePath));
  requireCondition(typeof executableName === 'string' && parse(executablePath).base.toLowerCase() === executableName.toLowerCase());
  const stat = lstatSync(executablePath);
  requireCondition(stat.isFile() && !stat.isSymbolicLink());
  return resolve(executablePath);
}

export function configureGitExecutable(executablePath) {
  gitExecutable = assertWindowsExecutablePath(executablePath, 'git.exe');
  return gitExecutable;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBuffer(repoRoot, args) {
  return execFileSync(gitExecutable, args, {
    cwd: repoRoot,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function gitText(repoRoot, args) {
  return execFileSync(gitExecutable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function assertPostgres18Version(versionOutput) {
  requireCondition(
    typeof versionOutput === 'string' &&
      /^psql \(PostgreSQL\) 18(?:\.\d+)+(?:\s|$)/.test(versionOutput.trim()),
  );
}

export function assertSha256Matches(bytes, expected) {
  requireCondition(/^[a-f0-9]{64}$/.test(expected));
  requireCondition(sha256(bytes) === expected);
}

export function assertOwnerSecretDirectoryBinding(secretDir, localAppData, applicationSourceSha) {
  requireCondition(typeof localAppData === 'string' && localAppData.length > 0);
  requireCondition(/^[a-f0-9]{40}$/.test(applicationSourceSha));
  const operatorRoot = resolve(localAppData, 'KarturtStageOperator');
  const allowedDirectory = resolve(operatorRoot, 'f2-attempt-' + applicationSourceSha);
  const resolvedSecretDir = resolve(secretDir);
  requireCondition(allowedDirectory.toLowerCase() === resolvedSecretDir.toLowerCase());
  return true;
}

export function assertNoReparsePoints(path) {
  requireCondition(isAbsolute(path));
  const absolutePath = resolve(path);
  const { root } = parse(absolutePath);
  const remainder = absolutePath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let currentPath = root;
  for (const segment of remainder) {
    currentPath = join(currentPath, segment);
    const stat = lstatSync(currentPath);
    requireCondition(!stat.isSymbolicLink());
  }
  const stat = lstatSync(absolutePath);
  requireCondition(!stat.isSymbolicLink());
  return absolutePath;
}

export function parseMigrationManifest(source) {
  requireCondition(typeof source === 'string');
  const declaration = 'export const APPROVED_MIGRATION_BLOB_SHA256';
  const declarationIndex = source.indexOf(declaration);
  requireCondition(declarationIndex >= 0);
  const openIndex = source.indexOf('Object.freeze({', declarationIndex);
  const closeIndex = source.indexOf('} as const);', openIndex);
  requireCondition(openIndex >= 0 && closeIndex > openIndex);
  const body = source.slice(openIndex + 'Object.freeze({'.length, closeIndex);
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const match = /^"([^"\r\n]+)":\s*"([a-f0-9]{64})",?$/.exec(line);
    requireCondition(match);
    entries.push([match[1], match[2]]);
  }
  requireCondition(entries.length === WAVE13B2_MIGRATION_PATHS.length);
  requireCondition(new Set(entries.map(([path]) => path)).size === entries.length);
  requireCondition(
    [...entries.map(([path]) => path)].sort().join('\n') === [...WAVE13B2_MIGRATION_PATHS].sort().join('\n'),
  );
  return entries;
}

export function assertCandidateTargetBinding(targetManifest, applicationSourceSha) {
  const expected = WAVE13B2_LOCAL_PREFLIGHT_EXPECTED;
  requireCondition(targetManifest && typeof targetManifest === 'object');
  requireCondition(targetManifest.schemaVersion === 1);
  requireCondition(targetManifest.state === 'ROOT_VERIFIED_CATALOG_UNKNOWN');
  requireCondition(targetManifest.finalApprovalSourceSha === applicationSourceSha);
  requireCondition(targetManifest.migrationManifestFingerprint === expected.migrationManifestFingerprint);
  const provider = targetManifest.provider;
  requireCondition(provider && typeof provider === 'object');
  assertNoInventedLineageNulls(provider);
  requireCondition(provider.plan === 'Free' && provider.freeOnlyConfirmed === true);
  requireCondition(provider.organizationId === expected.organizationId);
  requireCondition(provider.projectId === expected.projectId);
  requireCondition(provider.projectName === expected.projectName);
  requireCondition(provider.branchId === expected.branchId);
  requireCondition(provider.branchName === expected.branchName);
  requireCondition(provider.endpointId === expected.endpointId);
  requireCondition(provider.region === expected.region);
  requireCondition(provider.postgresMajor === expected.postgresMajor);
  requireCondition(provider.computeCU === expected.computeCU);
  requireCondition(provider.creationMode === 'ROOT_BY_NEW_PROJECT_CREATE_CONTRACT');
  requireCondition(provider.directHostname === expected.directHostname);
  requireCondition(String(provider.databaseId) === expected.databaseId);
  requireCondition(provider.databaseName === expected.databaseName);
  requireCondition(provider.ownerRole === expected.ownerRole);
  requireCondition(provider.passwordlessAccess === true);
  requireCondition(provider.passwordlessAccessMeaning === expected.passwordlessAccessMeaning);
  requireCondition(provider.passwordlessAccessContractReference === expected.passwordlessAccessContractReference);
  requireCondition(provider.passwordlessConnectDocumentationReference === expected.passwordlessConnectDocumentationReference);
  assertRootLineageAttestation(provider.rootLineageAttestation);
  requireCondition(provider.rootLineageAttestationSha256 === getRootLineageAttestationSha256());
  requireCondition(!provider.directHostname.endsWith('.pg.neon.tech'));
  requireCondition(!provider.directHostname.toLowerCase().includes('pooler'));
  const tls = targetManifest.tls;
  requireCondition(tls && typeof tls === 'object');
  requireCondition(tls.sslmode === 'verify-full');
  requireCondition(tls.channelBinding === 'require');
  requireCondition(tls.caBundleSource === expected.caBundleSource);
  requireCondition(/^[a-f0-9]{64}$/.test(tls.caBundleSha256));
  return true;
}

export function assertRootLineageAttestation(attestation) {
  requireCondition(attestation && typeof attestation === 'object');
  requireCondition(JSON.stringify(attestation) === JSON.stringify(WAVE13B2_LOCAL_PREFLIGHT_EXPECTED.rootLineageAttestation));
  return true;
}

export function assertNoInventedLineageNulls(value) {
  requireCondition(value && typeof value === 'object');
  requireCondition(!['parentId', 'parentProjectId', 'sourceProjectId'].some((key) => Object.hasOwn(value, key)));
  return true;
}

export function getRootLineageAttestationSha256() {
  return sha256(Buffer.from(JSON.stringify(WAVE13B2_LOCAL_PREFLIGHT_EXPECTED.rootLineageAttestation), 'utf8'));
}

export function assertBoundLibpqEnvironment(environment, secretDir) {
  const expected = WAVE13B2_LOCAL_PREFLIGHT_EXPECTED;
  const passfilePath = join(secretDir, 'pgpass.conf');
  const caPath = join(secretDir, 'cacert.pem');
  requireCondition(!environment.PGPASSWORD);
  requireCondition(!environment.PGSERVICE && !environment.PGSERVICEFILE);
  requireCondition(!environment.PGHOSTADDR && !environment.PGOPTIONS);
  requireCondition(!environment.PGSSLCERT && !environment.PGSSLKEY);
  requireCondition(environment.PGHOST === expected.directHostname);
  requireCondition(environment.PGPORT === '5432');
  requireCondition(environment.PGDATABASE === expected.databaseName);
  requireCondition(environment.PGUSER === expected.ownerRole);
  requireCondition(environment.PGSSLMODE === 'verify-full');
  requireCondition(environment.PGCHANNELBINDING === 'require');
  requireCondition(typeof environment.PGPASSFILE === 'string');
  requireCondition(resolve(environment.PGPASSFILE).toLowerCase() === resolve(passfilePath).toLowerCase());
  requireCondition(typeof environment.PGSSLROOTCERT === 'string');
  requireCondition(resolve(environment.PGSSLROOTCERT).toLowerCase() === resolve(caPath).toLowerCase());
  return true;
}

export function assertWindowsAclCheckerResult(output) {
  requireCondition(typeof output === 'string' && output.trim() === 'PASS');
}

export function assertCleanExactSourceCommit(repoRoot, applicationSourceSha) {
  requireCondition(/^[a-f0-9]{40}$/.test(applicationSourceSha));
  const actualRoot = resolve(gitText(repoRoot, ['rev-parse', '--show-toplevel']));
  requireCondition(actualRoot.toLowerCase() === resolve(repoRoot).toLowerCase());
  const headSha = gitText(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const resolvedSource = gitText(repoRoot, ['rev-parse', '--verify', applicationSourceSha + '^{commit}']);
  requireCondition(resolvedSource === applicationSourceSha);
  requireCondition(headSha === applicationSourceSha);
  const status = gitText(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  requireCondition(status.length === 0);
  return headSha;
}

export function assertSourceAndMigrationSnapshot(repoRoot, applicationSourceSha) {
  const headSha = assertCleanExactSourceCommit(repoRoot, applicationSourceSha);

  const manifestSource = gitBuffer(repoRoot, ['show', applicationSourceSha + ':src/db/migration-manifest.ts']).toString('utf8');
  const manifestEntries = parseMigrationManifest(manifestSource);
  const sortedEntries = [...manifestEntries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  requireCondition(
    sha256(Buffer.from(JSON.stringify(sortedEntries), 'utf8')) ===
      WAVE13B2_LOCAL_PREFLIGHT_EXPECTED.migrationManifestFingerprint,
  );

  for (const [repositoryPath, expectedSha256] of manifestEntries) {
    const blob = gitBuffer(repoRoot, ['cat-file', 'blob', applicationSourceSha + ':' + repositoryPath]);
    requireCondition(sha256(blob) === expectedSha256);
  }
  return {
    headSha,
    applicationSourceSha,
    migrationBlobCount: manifestEntries.length,
    migrationManifestFingerprint: WAVE13B2_LOCAL_PREFLIGHT_EXPECTED.migrationManifestFingerprint,
  };
}

function assertRegularNonEmptyFile(path) {
  const absolutePath = assertNoReparsePoints(path);
  const stat = lstatSync(absolutePath);
  requireCondition(stat.isFile() && stat.size > 0);
  return absolutePath;
}

function getRequiredArgs(argv) {
  const allowed = new Set(['--repo-root', '--secret-dir', '--application-source-sha', '--trusted-public-key-fingerprint', '--git-path', '--psql-path']);
  requireCondition(argv.length === allowed.size * 2);
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    requireCondition(allowed.has(key) && !args.has(key));
    requireCondition(typeof argv[index + 1] === 'string' && argv[index + 1].length > 0);
    args.set(key, argv[index + 1]);
  }
  requireCondition(args.size === allowed.size);
  return args;
}

export function resolveWindowsPowerShellExecutable() {
  requireCondition(process.platform === 'win32');
  const programFiles = process.env.ProgramW6432 ?? process.env.ProgramFiles ?? 'C:\\Program Files';
  const pwsh = join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  if (existsSync(pwsh)) return pwsh;
  const windowsPowerShell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  requireCondition(existsSync(windowsPowerShell));
  return windowsPowerShell;
}

function runWindowsAclCheck(scriptPath, path, requireProtected) {
  const powershell = resolveWindowsPowerShellExecutable();
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Path', path];
  if (requireProtected) args.push('-RequireProtected');
  const output = execFileSync(powershell, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assertWindowsAclCheckerResult(output);
}

function runApprovalVerifier(repoRoot, secretDir, applicationSourceSha, trustedFingerprint, gitPath) {
  const verifierPath = join(repoRoot, 'scripts', 'verify-wave13b2-query-approval.mjs');
  const output = execFileSync(process.execPath, [
    verifierPath,
    '--repo-root', repoRoot,
    '--secret-dir', secretDir,
    '--application-source-sha', applicationSourceSha,
    '--trusted-public-key-fingerprint', trustedFingerprint,
    '--git-path', gitPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  requireCondition(output.trim() === 'PASS');
}

function main() {
  requireCondition(process.platform === 'win32');
  requireCondition(typeof process.env.LOCALAPPDATA === 'string' && process.env.LOCALAPPDATA.length > 0);

  const args = getRequiredArgs(process.argv.slice(2));
  const repoRoot = resolve(args.get('--repo-root'));
  const secretDir = resolve(args.get('--secret-dir'));
  const applicationSourceSha = args.get('--application-source-sha');
  const trustedFingerprint = args.get('--trusted-public-key-fingerprint');
  const gitPath = configureGitExecutable(args.get('--git-path'));
  const psqlPath = assertWindowsExecutablePath(args.get('--psql-path'), 'psql.exe');
  requireCondition(/^[a-f0-9]{40}$/.test(applicationSourceSha));
  requireCondition(/^[a-f0-9]{64}$/.test(trustedFingerprint));
  assertOwnerSecretDirectoryBinding(secretDir, process.env.LOCALAPPDATA, applicationSourceSha);
  assertBoundLibpqEnvironment(process.env, secretDir);

  const operatorRoot = resolve(process.env.LOCALAPPDATA, 'KarturtStageOperator');
  assertNoReparsePoints(repoRoot);
  assertNoReparsePoints(operatorRoot);
  assertNoReparsePoints(secretDir);
  const sourceSnapshot = assertSourceAndMigrationSnapshot(repoRoot, applicationSourceSha);
  const psqlVersion = execFileSync(psqlPath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assertPostgres18Version(psqlVersion);

  const localPaths = Object.fromEntries(LOCAL_FILES.map((name) => [name, assertRegularNonEmptyFile(join(secretDir, name))]));
  const aclChecker = assertRegularNonEmptyFile(join(repoRoot, 'scripts', 'check-wave13b2-secret-acl.ps1'));
  runWindowsAclCheck(aclChecker, operatorRoot, true);
  runWindowsAclCheck(aclChecker, secretDir, true);
  for (const localPath of Object.values(localPaths)) runWindowsAclCheck(aclChecker, localPath, false);

  const targetManifest = JSON.parse(readFileSync(localPaths['wave13b2-staging-target-manifest.local.json'], 'utf8'));
  assertCandidateTargetBinding(targetManifest, applicationSourceSha);

  const queryPath = assertRegularNonEmptyFile(join(repoRoot, 'docs', 'codex', 'wave13b2-read-only-catalog-preflight.sql'));
  const queryBytes = readFileSync(queryPath);
  assertSha256Matches(queryBytes, WAVE13B2_LOCAL_PREFLIGHT_EXPECTED.queryPacketSha256);
  assertSha256Matches(
    readFileSync(localPaths['cacert.pem']),
    targetManifest.tls.caBundleSha256,
  );

  runApprovalVerifier(repoRoot, secretDir, applicationSourceSha, trustedFingerprint, gitPath);
  process.stdout.write(
    `LOCAL_OFFLINE_PREFLIGHT_PASS source=${sourceSnapshot.applicationSourceSha} migrations=${sourceSnapshot.migrationBlobCount} query=${WAVE13B2_LOCAL_PREFLIGHT_EXPECTED.queryPacketSha256}\n`,
  );
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
