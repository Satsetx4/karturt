import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateProvisioningEvidence, REQUIRED_CHECKS } from './wave13b-2-provisioning-gate.mjs';

const datedPass = {
  status: 'PASS',
  observedAt: '2026-10-15T09:00:00Z',
  evidenceRef: 'fixture://synthetic-positive-evidence',
};

function syntheticPacket() {
  return {
    schemaVersion: 1,
    targetScope: {
      organizationId: 'org-ancient-boat-57106549',
      plan: 'free',
      regionId: 'aws-ap-southeast-1',
      postgresMajor: 18,
      plannedOperationCount: 1,
      sourceProjectId: null,
      syntheticDataOnly: true,
      existingStagingMutationAllowed: false,
      productionMutationAllowed: false,
    },
    checks: Object.fromEntries(REQUIRED_CHECKS.map((key) => [key, { ...datedPass }])),
  };
}

test('all required dated synthetic evidence passes only to coordinator review', () => {
  const result = evaluateProvisioningEvidence(syntheticPacket());
  assert.equal(result.status, 'PASS');
  assert.equal(result.mayProceedToCoordinatorGate, true);
  assert.equal(result.providerActionPerformed, false);
  assert.equal(result.sqlConnectionAttempted, false);
});

test('missing evidence fails closed as UNKNOWN', () => {
  const packet = syntheticPacket();
  delete packet.checks.account_storage_headroom;
  const result = evaluateProvisioningEvidence(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.mayProceedToCoordinatorGate, false);
  assert.match(result.unknowns.join(' '), /account_storage_headroom/);
});

test('an explicit blocker dominates unknown evidence', () => {
  const packet = syntheticPacket();
  packet.checks.security_adequacy = { status: 'BLOCKED', reason: 'synthetic fixture blocker' };
  packet.checks.account_storage_headroom = { status: 'UNKNOWN', reason: 'fixture unknown' };
  const result = evaluateProvisioningEvidence(packet);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.mayProceedToCoordinatorGate, false);
  assert.match(result.blockers.join(' '), /synthetic fixture blocker/);
});

test('PASS without a dated evidence reference is downgraded to UNKNOWN', () => {
  const packet = syntheticPacket();
  packet.checks.current_usage_and_no_overage = { status: 'PASS', evidenceRef: 'fixture://missing-date' };
  const result = evaluateProvisioningEvidence(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.mayProceedToCoordinatorGate, false);
  assert.match(result.unknowns.join(' '), /current_usage_and_no_overage.*dated evidence reference/);
});

test('unsupported packet schema is BLOCKED', () => {
  const result = evaluateProvisioningEvidence({ schemaVersion: 99, checks: {} });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.mayProceedToCoordinatorGate, false);
});

test('a packet for the wrong organization or project source is BLOCKED', () => {
  const packet = syntheticPacket();
  packet.targetScope.organizationId = 'wrong-org';
  packet.targetScope.sourceProjectId = 'falling-bread-33359184';
  const result = evaluateProvisioningEvidence(packet);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.mayProceedToCoordinatorGate, false);
  assert.match(result.blockers.join(' '), /targetScope\.organizationId/);
  assert.match(result.blockers.join(' '), /targetScope\.sourceProjectId/);
});

test('an undeclared source field in target scope is BLOCKED', () => {
  const packet = syntheticPacket();
  packet.targetScope.restoreSourceId = null;
  const result = evaluateProvisioningEvidence(packet);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.mayProceedToCoordinatorGate, false);
  assert.match(result.blockers.join(' '), /targetScope\.restoreSourceId.*not allowed/);
});

test('missing target scope is UNKNOWN and cannot pass', () => {
  const packet = syntheticPacket();
  delete packet.targetScope;
  const result = evaluateProvisioningEvidence(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.mayProceedToCoordinatorGate, false);
  assert.match(result.unknowns.join(' '), /targetScope/);
});

test('checked-in current evidence stays UNKNOWN and cannot proceed', () => {
  const packetPath = new URL('./wave13b-2-current-evidence.json', import.meta.url);
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const result = evaluateProvisioningEvidence(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.mayProceedToCoordinatorGate, false);
  assert.equal(result.providerActionPerformed, false);
});
