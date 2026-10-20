import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packetPath = resolve(
  repoRoot,
  'docs/codex/Wave-13B2-Free-Only-Staging-Operator-Packet-2026-10-15.md',
);
const workflowPath = resolve(repoRoot, '.github/workflows/gate-a.yml');
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
  /must read only local files; it must not invoke psql, connect to Neon/,
  /interactive, non-signature, hash-bound, and retained owner-local/,
  /catalog state remains `UNKNOWN`/,
  /DRAFT — pending the reviewed script path and interface/,
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
