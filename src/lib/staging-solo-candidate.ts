/**
 * #70: OFFLINE cross-check of the new Neon Free candidate's normalized
 * request/readback. Not wired into production, staging migration, Gate V1,
 * the CLI, or any protected workflow. Even a perfect match is UNAUTHENTICATED.
 */
export const SOLO_STAGING_CANDIDATE = Object.freeze({
  organizationId: "org-ancient-boat-57106549",
  projectId: "super-band-12770762",
  projectName: "karturt-v1-solo-provenance-20261022",
  branchId: "br-solitary-king-a1qdsiln",
  branchName: "karturt-solo-root-20261022",
  endpointId: "ep-falling-mountain-a1hlzrdb",
  directHostname: "ep-falling-mountain-a1hlzrdb.ap-southeast-1.aws.neon.tech",
  databaseName: "karturt",
  roleName: "karturt_owner",
  regionId: "aws-ap-southeast-1",
  postgresMajor: 18,
  computeCU: 0.25,
  plan: "free_v3",
  createdAtUtc: "2026-10-22T04:52:37Z",
  createTimelineOperationId: "287c6cc3-4c01-4622-8fdd-1f1d72f29f00",
} as const);

type JsonObject = Record<string, unknown>;
function object(input: unknown): input is JsonObject {
  return !!input && typeof input === "object" && !Array.isArray(input);
}
function exactFields(value: JsonObject, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}
function utcInstant(input: unknown): number | null {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input)) return null;
  const stamp = Date.parse(input);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === input.replace(/Z$/, ".000Z")
    ? stamp : null;
}

export type SoloCandidateAssessment = {
  // "MATCH" is only agreement between strings. It is NOT provider authenticity.
  metadataConsistency: "MATCH_UNAUTHENTICATED" | "REJECTED";
  failureCodes: string[];
  rootLineage: "UNKNOWN";
  syntheticOnly: "UNKNOWN";
  providerAuthentication: "UNKNOWN";
  tlsAndCatalog: "UNKNOWN";
  approvedForCutover: false;
  migrationAllowed: false;
};

export function assessSoloCandidateOffline(packet: unknown): SoloCandidateAssessment {
  const failures: string[] = [];
  const fail = (code: string) => { failures.push(code); };
  const c = SOLO_STAGING_CANDIDATE;

  if (!object(packet) || !exactFields(packet, ["schemaVersion", "request", "project", "branch", "endpoint", "operation"])) {
    fail("PACKET_SHAPE_INVALID");
  } else {
    if (packet.schemaVersion !== "karturt/solo-staging-candidate-offline/v1") fail("SCHEMA_INVALID");
    const request = packet.request;
    if (!object(request) || !exactFields(request, [
      "organizationId", "name", "regionId", "postgresMajor", "computeMinCU",
      "computeMaxCU", "branchName", "databaseName", "roleName",
    ])) {
      // Reject parent/clone/import/restore fields rather than assuming omission
      // from a user-supplied object proves what Neon actually received.
      fail("REQUEST_NOT_EXACT_OR_HAS_SOURCE_FIELDS");
    } else if (
      request.organizationId !== c.organizationId || request.name !== c.projectName ||
      request.regionId !== c.regionId || request.postgresMajor !== c.postgresMajor ||
      request.computeMinCU !== c.computeCU || request.computeMaxCU !== c.computeCU ||
      request.branchName !== c.branchName || request.databaseName !== c.databaseName ||
      request.roleName !== c.roleName
    ) fail("REQUEST_TARGET_MISMATCH");

    const project = packet.project;
    if (!object(project) || !exactFields(project, [
      "id", "organizationId", "name", "plan", "regionId", "postgresMajor",
      "computeMinCU", "computeMaxCU", "createdAtUtc",
    ])) fail("PROJECT_SHAPE_INVALID");
    else if (
      project.id !== c.projectId || project.organizationId !== c.organizationId ||
      project.name !== c.projectName || project.plan !== c.plan ||
      project.regionId !== c.regionId || project.postgresMajor !== c.postgresMajor ||
      project.computeMinCU !== c.computeCU || project.computeMaxCU !== c.computeCU ||
      project.createdAtUtc !== c.createdAtUtc || utcInstant(project.createdAtUtc) === null
    ) fail("PROJECT_IDENTITY_MISMATCH");

    const branch = packet.branch;
    if (!object(branch) || !exactFields(branch, [
      "id", "projectId", "name", "primary", "default", "state",
      "parentIdFieldObserved", "initSource", "createdAtUtc",
    ])) fail("BRANCH_SHAPE_INVALID");
    else if (
      branch.id !== c.branchId || branch.projectId !== c.projectId ||
      branch.name !== c.branchName || branch.primary !== true ||
      branch.default !== true || branch.state !== "ready" ||
      branch.parentIdFieldObserved !== false || branch.initSource !== "parent-data" ||
      branch.createdAtUtc !== c.createdAtUtc || utcInstant(branch.createdAtUtc) === null
    ) fail("BRANCH_IDENTITY_MISMATCH");

    const endpoint = packet.endpoint;
    if (!object(endpoint) || !exactFields(endpoint, [
      "id", "projectId", "branchId", "host", "regionId",
      "poolerEnabled", "computeMinCU", "computeMaxCU",
    ])) fail("ENDPOINT_SHAPE_INVALID");
    else if (
      endpoint.id !== c.endpointId || endpoint.projectId !== c.projectId ||
      endpoint.branchId !== c.branchId || endpoint.host !== c.directHostname ||
      endpoint.regionId !== c.regionId || endpoint.poolerEnabled !== false ||
      endpoint.computeMinCU !== c.computeCU || endpoint.computeMaxCU !== c.computeCU
    ) fail("ENDPOINT_IDENTITY_MISMATCH");

    const operation = packet.operation;
    if (!object(operation) || !exactFields(operation, ["id", "projectId", "branchId", "action", "status", "createdAtUtc"])) {
      fail("OPERATION_SHAPE_INVALID");
    } else if (
      operation.id !== c.createTimelineOperationId || operation.projectId !== c.projectId ||
      operation.branchId !== c.branchId || operation.action !== "create_timeline" ||
      operation.status !== "finished" || operation.createdAtUtc !== c.createdAtUtc ||
      utcInstant(operation.createdAtUtc) === null
    ) fail("OPERATION_MISMATCH");
  }
  return {
    metadataConsistency: failures.length ? "REJECTED" : "MATCH_UNAUTHENTICATED",
    failureCodes: failures,
    // Important: these stay UNKNOWN even for an internally consistent packet.
    rootLineage: "UNKNOWN",
    syntheticOnly: "UNKNOWN",
    providerAuthentication: "UNKNOWN",
    tlsAndCatalog: "UNKNOWN",
    approvedForCutover: false,
    migrationAllowed: false,
  };
}
