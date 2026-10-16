import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WAVE13B2_LOCAL_PREFLIGHT_EXPECTED as PREFLIGHT_EXPECTED, assertSha256Matches } from './preflight-wave13b2-local.mjs';

export const WAVE13B2_QUERY_PACKET_PATH = 'docs/codex/wave13b2-read-only-catalog-preflight.sql';
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function sha256RawBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertWave13B2QueryDigest(bytes, expected = PREFLIGHT_EXPECTED.queryPacketSha256) {
  requireCondition(Buffer.isBuffer(bytes), 'query packet must be checked as raw bytes');
  assertSha256Matches(bytes, expected);
}

export function readWave13B2QueryGitBlob(repoRoot = DEFAULT_REPO_ROOT, revision = 'HEAD') {
  return execFileSync('git', ['cat-file', 'blob', revision + ':' + WAVE13B2_QUERY_PACKET_PATH], {
    cwd: repoRoot,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function assertWave13B2QueryIntegrity(repoRoot = DEFAULT_REPO_ROOT) {
  const expected = PREFLIGHT_EXPECTED.queryPacketSha256;
  const gitBlob = readWave13B2QueryGitBlob(repoRoot);
  const workingTreeBytes = readFileSync(join(repoRoot, WAVE13B2_QUERY_PACKET_PATH));
  assertWave13B2QueryDigest(gitBlob, expected);
  assertWave13B2QueryDigest(workingTreeBytes, expected);
  requireCondition(gitBlob.equals(workingTreeBytes), 'query checkout bytes differ from the raw Git blob');
  requireCondition(!workingTreeBytes.includes(0x0d), 'query checkout contains CR bytes; expected LF-only bytes');

  const attributes = execFileSync('git', ['check-attr', 'text', 'eol', '--', WAVE13B2_QUERY_PACKET_PATH], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  requireCondition(attributes.includes('text: set') && attributes.includes('eol: lf'), 'query path must be text with eol=lf');

  const targetManifest = JSON.parse(readFileSync(join(repoRoot, 'docs/codex/wave13b2-staging-target-manifest.template.json'), 'utf8'));
  const expectedState = JSON.parse(readFileSync(join(repoRoot, 'docs/codex/wave13b2-staging-expected-state.template.json'), 'utf8'));
  requireCondition(targetManifest.readOnlyQueryApproval && targetManifest.readOnlyQueryApproval.queryPacketSha256 === expected, 'target manifest template digest pin disagrees');
  requireCondition(expectedState.binding && expectedState.binding.queryPacketSha256 === expected, 'expected-state template digest pin disagrees');

  const packet = readFileSync(join(repoRoot, 'docs/codex/Wave-13B2-Free-Only-Staging-Operator-Packet-2026-10-15.md'), 'utf8');
  const tick = String.fromCharCode(96);
  requireCondition(packet.includes('SHA-256 ' + tick + expected + tick), 'operator packet prose digest pin disagrees');
  requireCondition(packet.includes('$queryPacketSha256 = ' + String.fromCharCode(39) + expected + String.fromCharCode(39)), 'operator command digest pin disagrees');
  const approvalVerifier = readFileSync(join(repoRoot, 'scripts/verify-wave13b2-query-approval.mjs'), 'utf8');
  requireCondition(approvalVerifier.includes('queryPacketSha256: PREFLIGHT_EXPECTED.queryPacketSha256'), 'approval verifier must share the audited preflight digest pin');

  return Object.freeze({
    queryPacketSha256: expected,
    gitBlobBytes: gitBlob.length,
    workingTreeBytes: workingTreeBytes.length,
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const repoRoot = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_REPO_ROOT;
    const result = assertWave13B2QueryIntegrity(repoRoot);
    process.stdout.write('WAVE13B2_QUERY_INTEGRITY_PASS sha256=' + result.queryPacketSha256 + ' bytes=' + result.gitBlobBytes + '\n');
  } catch {
    process.stderr.write('WAVE13B2_QUERY_INTEGRITY_BLOCKED\n');
    process.exitCode = 1;
  }
}
