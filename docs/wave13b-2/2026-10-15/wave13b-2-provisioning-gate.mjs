#!/usr/bin/env node

// Offline-only evidence completeness check. This file intentionally has no
// Neon SDK, HTTP client, credential lookup, SQL, or provider-action code.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_CHECKS = Object.freeze([
  'organization_identity',
  'free_plan_allowances',
  'project_slot_headroom',
  'account_storage_headroom',
  'current_usage_and_no_overage',
  'singapore_postgres18_availability',
  'fresh_root_create_only',
  'post_create_lineage_evidence_protocol',
  'synthetic_only_scope',
  'security_adequacy',
  'owner_conditional_scope',
]);

const REQUIRED_TARGET_SCOPE = Object.freeze({
  organizationId: 'org-ancient-boat-57106549',
  plan: 'free',
  regionId: 'aws-ap-southeast-1',
  postgresMajor: 18,
  plannedOperationCount: 1,
  sourceProjectId: null,
  syntheticDataOnly: true,
  existingStagingMutationAllowed: false,
  productionMutationAllowed: false,
});

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function hasDatedReference(item) {
  return typeof item?.evidenceRef === 'string'
    && item.evidenceRef.trim().length > 0
    && item.evidenceRef.length <= 500
    && typeof item?.observedAt === 'string'
    && ISO_TIMESTAMP.test(item.observedAt)
    && Number.isFinite(Date.parse(item.observedAt));
}

export function evaluateProvisioningEvidence(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet) || packet.schemaVersion !== 1) {
    return {
      status: 'BLOCKED',
      mayProceedToCoordinatorGate: false,
      providerActionPerformed: false,
      sqlConnectionAttempted: false,
      blockers: ['Invalid evidence packet or unsupported schemaVersion.'],
      unknowns: [],
    };
  }

  const checks = packet.checks && typeof packet.checks === 'object' && !Array.isArray(packet.checks)
    ? packet.checks
    : {};
  const blockers = [];
  const unknowns = [];

  const scope = packet.targetScope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    unknowns.push('targetScope: scope object is missing.');
  } else {
    const allowedKeys = new Set(Object.keys(REQUIRED_TARGET_SCOPE));
    for (const key of Object.keys(scope)) {
      if (!allowedKeys.has(key)) {
        blockers.push(`targetScope.${key}: undeclared scope field is not allowed.`);
      }
    }
    for (const [key, expected] of Object.entries(REQUIRED_TARGET_SCOPE)) {
      if (!Object.hasOwn(scope, key)) {
        unknowns.push(`targetScope.${key}: required scope value is missing.`);
      } else if (scope[key] !== expected) {
        blockers.push(`targetScope.${key}: must equal ${JSON.stringify(expected)}.`);
      }
    }
  }

  for (const key of REQUIRED_CHECKS) {
    const check = checks[key];
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      unknowns.push(`${key}: evidence entry is missing.`);
      continue;
    }

    if (check.status === 'BLOCKED') {
      blockers.push(`${key}: ${typeof check.reason === 'string' && check.reason.trim() ? check.reason : 'evidence is blocked.'}`);
      continue;
    }

    if (check.status !== 'PASS' && check.status !== 'UNKNOWN') {
      unknowns.push(`${key}: status must be PASS, UNKNOWN, or BLOCKED.`);
      continue;
    }

    if (check.status === 'UNKNOWN') {
      unknowns.push(`${key}: ${typeof check.reason === 'string' && check.reason.trim() ? check.reason : 'evidence remains unknown.'}`);
      continue;
    }

    if (!hasDatedReference(check)) {
      unknowns.push(`${key}: PASS lacks a valid dated evidence reference.`);
    }
  }

  const status = blockers.length > 0 ? 'BLOCKED' : unknowns.length > 0 ? 'UNKNOWN' : 'PASS';
  return {
    status,
    mayProceedToCoordinatorGate: status === 'PASS',
    providerActionPerformed: false,
    sqlConnectionAttempted: false,
    blockers,
    unknowns,
  };
}

async function main(argv) {
  const inputPath = argv[2];
  if (!inputPath || inputPath === '--help' || inputPath === '-h') {
    process.stdout.write('Usage: node wave13b-2-provisioning-gate.mjs <offline-evidence.json>\n');
    process.stdout.write('Reads a local JSON packet only; does not contact Neon or perform provider actions.\n');
    process.exitCode = inputPath ? 0 : 1;
    return;
  }

  try {
    const contents = await readFile(resolve(inputPath), 'utf8');
    const packet = JSON.parse(contents);
    const result = evaluateProvisioningEvidence(packet);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === 'PASS' ? 0 : result.status === 'BLOCKED' ? 2 : 3;
  } catch (error) {
    process.stderr.write(`Unable to read offline evidence packet: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await main(process.argv);
}
