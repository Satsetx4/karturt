import { describe, expect, it } from "vitest";
import {
  assessSoloCandidateOffline,
  SOLO_STAGING_CANDIDATE as candidate,
} from "../../src/lib/staging-solo-candidate";

// Deliberately no Neon/GitHub API calls, DB clients, or fake positive attestation.
const source = () => ({
  schemaVersion: "karturt/solo-staging-candidate-offline/v1",
  request: {
    organizationId: candidate.organizationId,
    name: candidate.projectName,
    regionId: candidate.regionId,
    postgresMajor: candidate.postgresMajor,
    computeMinCU: candidate.computeCU,
    computeMaxCU: candidate.computeCU,
    branchName: candidate.branchName,
    databaseName: candidate.databaseName,
    roleName: candidate.roleName,
  },
  project: {
    id: candidate.projectId,
    organizationId: candidate.organizationId,
    name: candidate.projectName,
    plan: candidate.plan,
    regionId: candidate.regionId,
    postgresMajor: candidate.postgresMajor,
    computeMinCU: candidate.computeCU,
    computeMaxCU: candidate.computeCU,
    createdAtUtc: candidate.createdAtUtc,
  },
  branch: {
    id: candidate.branchId,
    projectId: candidate.projectId,
    name: candidate.branchName,
    primary: true,
    default: true,
    state: "ready",
    parentIdFieldObserved: false,
    initSource: "parent-data",
    createdAtUtc: candidate.createdAtUtc,
  },
  endpoint: {
    id: candidate.endpointId,
    projectId: candidate.projectId,
    branchId: candidate.branchId,
    host: candidate.directHostname,
    regionId: candidate.regionId,
    poolerEnabled: false,
    computeMinCU: candidate.computeCU,
    computeMaxCU: candidate.computeCU,
  },
  operation: {
    id: candidate.createTimelineOperationId,
    projectId: candidate.projectId,
    branchId: candidate.branchId,
    action: "create_timeline",
    status: "finished",
    createdAtUtc: candidate.createdAtUtc,
  },
});

describe("issue #70: isolated new staging candidate, offline only", () => {
  it("recognizes consistent metadata but never grants trusted provenance, runtime, or migration", () => {
    expect(assessSoloCandidateOffline(source())).toEqual({
      metadataConsistency: "MATCH_UNAUTHENTICATED",
      failureCodes: [],
      rootLineage: "UNKNOWN",
      syntheticOnly: "UNKNOWN",
      providerAuthentication: "UNKNOWN",
      tlsAndCatalog: "UNKNOWN",
      approvedForCutover: false,
      migrationAllowed: false,
    });
  });

  it.each([
    ["legacy project", (p: ReturnType<typeof source>) => { p.project.id = "wild-darkness-00489132"; }, "PROJECT_IDENTITY_MISMATCH"],
    ["different org", p => { p.request.organizationId = "other-org"; }, "REQUEST_TARGET_MISMATCH"],
    ["imported source", p => { Object.assign(p.request, { import: "external" }); }, "REQUEST_NOT_EXACT_OR_HAS_SOURCE_FIELDS"],
    ["restored source", p => { Object.assign(p.request, { restore: true }); }, "REQUEST_NOT_EXACT_OR_HAS_SOURCE_FIELDS"],
    ["branch reused", p => { p.branch.id = "br-spring-shadow-b37rykzl"; }, "BRANCH_IDENTITY_MISMATCH"],
    ["branch child", p => { Object.assign(p.branch, { parent_id: "br-other" }); }, "BRANCH_SHAPE_INVALID"],
    ["branch not ready", p => { p.branch.state = "idle"; }, "BRANCH_IDENTITY_MISMATCH"],
    ["endpoint switched", p => { p.endpoint.id = "ep-silent-haze-b3pcaa3t"; }, "ENDPOINT_IDENTITY_MISMATCH"],
    ["wrong direct hostname", p => { p.endpoint.host = "ep-unrelated.neon.tech"; }, "ENDPOINT_IDENTITY_MISMATCH"],
    ["pooler enabled", p => { p.endpoint.poolerEnabled = true; }, "ENDPOINT_IDENTITY_MISMATCH"],
    ["paid plan", p => { p.project.plan = "launch"; }, "PROJECT_IDENTITY_MISMATCH"],
    ["wrong region", p => { p.project.regionId = "aws-us-east-1"; }, "PROJECT_IDENTITY_MISMATCH"],
    ["unknown operation", p => { p.operation.id = "ffffffff-ffff-ffff-ffff-ffffffffffff"; }, "OPERATION_MISMATCH"],
    ["missing operation", p => { Object.assign(p, { operation: null }); }, "OPERATION_SHAPE_INVALID"],
    ["timestamp invalid", p => { p.project.createdAtUtc = "2026-02-30T00:00:00Z"; }, "PROJECT_IDENTITY_MISMATCH"],
    ["forged self signature", p => { Object.assign(p, { providerAuthenticated: true }); }, "PACKET_SHAPE_INVALID"],
    ["fake synthetic proof", p => { Object.assign(p, { syntheticOnly: true }); }, "PACKET_SHAPE_INVALID"],
  ] as Array<[string, (p: ReturnType<typeof source>) => void, string]>)("rejects %s and cannot lift gate", (_label, change, code) => {
    const packet = source();
    change(packet);
    const result = assessSoloCandidateOffline(packet);
    expect(result.metadataConsistency).toBe("REJECTED");
    expect(result.failureCodes).toContain(code);
    expect(result.rootLineage).toBe("UNKNOWN");
    expect(result.syntheticOnly).toBe("UNKNOWN");
    expect(result.providerAuthentication).toBe("UNKNOWN");
    expect(result.approvedForCutover).toBe(false);
    expect(result.migrationAllowed).toBe(false);
  });

  it("fails closed when normalized packet is missing", () => {
    expect(assessSoloCandidateOffline(null)).toMatchObject({
      metadataConsistency: "REJECTED",
      failureCodes: ["PACKET_SHAPE_INVALID"],
      approvedForCutover: false,
    });
  });
});
