import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packetPath = resolve(
  repoRoot,
  'docs/codex/Wave-13B2-Free-Only-Staging-Operator-Packet-2026-10-15.md',
);
const workflowPath = resolve(repoRoot, '.github/workflows/gate-a.yml');
const reviewScriptPath = resolve(repoRoot, 'scripts/review-wave13b2-f2-evidence.mjs');
const packet = readFileSync(packetPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

const requiredPacketPatterns = [
  /wave13b2-f2-catalog-evidence-<sourceSHA>-<querySHA>\.local\.txt/,
  /\[IO\.FileMode\]::CreateNew/,
  /protected ACL limited to the current Windows user and SYSTEM/,
  /byte length, and SHA-256/,
  /exactly one `F2_DONE PASS` line matching the pinned source and query SHA-256/,
  /no `F2_FAIL` or `F2_STOP` marker exists/,
  /`F2_DONE` by itself proves neither that the catalog is empty nor that it matches the owner's expected state/,
  /offline comparison of the verified evidence file against the owner-reviewed/,
  /reads only these local files/i,
  /must not invoke psql, connect to Neon/i,
  /interactive, non-signature, hash-bound, and retained owner-local/i,
  /scripts\/review-wave13b2-f2-evidence\.mjs/,
  /--evidence \$evidencePath/,
  /--audit \$auditPath/,
  /--expected-state \$expectedStatePath/,
  /--record-owner-review/,
  /wave13b2-f2-owner-review-<sourceSHA>-<querySHA>\.local\.json/,
  /catalog state remains `UNKNOWN`/,
  /Preserve the old signed approval and `wave13b2-f2-query-attempt\.local\.txt` unchanged/,
];

const missingPacketContracts = requiredPacketPatterns
  .filter((pattern) => !pattern.test(packet))
  .map((pattern) => pattern.source);

if (missingPacketContracts.length > 0) {
  throw new Error(
    `Wave 13B.2 F2 owner packet is missing required evidence contracts: ${missingPacketContracts.join('; ')}`,
  );
}

const workflowMustNotContain = [
  'run-wave13b2-f2-query.ps1',
  'review-wave13b2-f2-evidence.mjs',
  'PGPASSFILE',
  'PGSSLROOTCERT',
  'neondb_owner',
  '.neon.tech',
];

const unsafeWorkflowReferences = workflowMustNotContain.filter((value) =>
  workflow.includes(value),
);

if (unsafeWorkflowReferences.length > 0) {
  throw new Error(
    `Wave 13B.2 F2 CI must remain offline and must not reference owner connection material: ${unsafeWorkflowReferences.join(', ')}`,
  );
}

if (!workflow.includes('node scripts/verify-wave13b2-query-integrity.mjs')) {
  throw new Error('The F2 CI path must keep the raw-query-blob/LF integrity verification.');
}

if (!existsSync(reviewScriptPath)) {
  throw new Error('The documented offline owner-review utility must exist in the reviewed source tree.');
}

const reviewScript = readFileSync(reviewScriptPath, 'utf8');
const requiredReviewScriptTokens = [
  '--evidence',
  '--audit',
  '--expected-state',
  '--record-owner-review',
  'stdin.isTTY',
  'MATCH',
  'MISMATCH',
  'REVIEW WAVE13B2 F2 ',
  'New-Wave13B2F2OwnerOnlyBoundFile',
  'wave13b2-f2-owner-review-',
  'schemaVersion',
  'recordType',
  'sourceSha',
  'querySha256',
  'evidenceFile',
  'evidenceSha256',
  'evidenceBytes',
  'auditFile',
  'auditSha256',
  'auditBytes',
  'expectedStateFile',
  'expectedStateSha256',
  'expectedStateBytes',
  'comparisonStatus',
  'matchedFields',
  'mismatchedFields',
  'reviewedAtUtc',
  'confirmationPhrase',
];
const missingReviewScriptTokens = requiredReviewScriptTokens.filter(
  (token) => !reviewScript.includes(token),
);

if (missingReviewScriptTokens.length > 0) {
  throw new Error(
    `The offline owner-review script no longer matches its documented local interface: ${missingReviewScriptTokens.join(', ')}`,
  );
}

const forbiddenReviewScriptTokens = [
  'psql',
  'neon',
  'neondb_owner',
  'pgpassfile',
  'privatekey',
  'https://',
  'fetch(',
];
const unsafeReviewScriptTokens = forbiddenReviewScriptTokens.filter((token) =>
  reviewScript.toLowerCase().includes(token),
);

if (unsafeReviewScriptTokens.length > 0) {
  throw new Error(
    `The offline owner-review utility must remain local-only and provider-blind: ${unsafeReviewScriptTokens.join(', ')}`,
  );
}

const trackedPaths = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'buffer',
})
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const ownerOnlyPathPatterns = [
  /(^|\/)wave13b2-f2-catalog-evidence-/i,
  /(^|\/)wave13b2-f2-query-attempt.*\.local\.txt$/i,
  /(^|\/)wave13b2-read-only-query-approval\.local\.json$/i,
  /(^|\/)wave13b2-staging-(target-manifest|expected-state)\.local\.json$/i,
  /(^|\/)(pgpass\.conf|cacert\.pem)$/i,
  /(^|\/)wave13b2-owner-signing-(private|public)\.pem$/i,
  /(^|\/)wave13b2-f2-owner-review.*\.local\./i,
];

const trackedOwnerOnlyPaths = trackedPaths.filter((filePath) =>
  ownerOnlyPathPatterns.some((pattern) => pattern.test(filePath)),
);

if (trackedOwnerOnlyPaths.length > 0) {
  throw new Error(
    `Owner-local F2 evidence or credentials must not be tracked by Git: ${trackedOwnerOnlyPaths.join(', ')}`,
  );
}

process.stdout.write(
  'WAVE13B2_F2_EVIDENCE_DOC_CONTRACT_PASS ci=offline ownerFiles=not-tracked\n',
);
