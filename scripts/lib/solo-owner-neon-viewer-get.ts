/**
 * KartuRT V1: future Viewer-only, read-only Neon control-plane GET preflight.
 * This code is NOT called by the fail-closed phase-0 GitHub workflow.
 * The caller must supply the actual Viewer principal's token and a reviewed,
 * trusted HTTP transport. Test fakes are not authenticated provider evidence.
 *
 * A successful metadata preflight is NOT root lineage, synthetic-only proof,
 * SQL catalog authorization, migration permission, or release readiness.
 */
const EXPECTED = Object.freeze({
  projectId: "super-band-12770762",
  organizationId: "org-ancient-boat-57106549",
  projectName: "karturt-v1-solo-provenance-20261022",
  regionId: "aws-ap-southeast-1",
  postgresMajor: 18,
});
const URL = "https://console.neon.tech/api/v2/projects/" + EXPECTED.projectId;

type JsonObject = Record<string, unknown>;
const isRecord = (x: unknown): x is JsonObject =>
  x !== null && typeof x === "object" && !Array.isArray(x);

export type NeonViewerReadOnlyRequest = Readonly<{
  url: string;
  method: "GET";
  headers: Readonly<{ Accept: "application/json"; Authorization: string }>;
  redirect: "error";
}>;

export type NeonViewerReadOnlyTransport = (
  request: NeonViewerReadOnlyRequest,
) => Promise<{ status: number; body: unknown }>;

export class NeonViewerProbeRejected extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "NeonViewerProbeRejected";
  }
}

export type NeonViewerReadOnlyPreflight = {
  targetProjectId: "super-band-12770762";
  sourceSha: string;
  observedPermission: "VIEWER";
  check: "METADATA_MATCHES_BUT_UNATTESTED";
  principalTokenPersisted: false;
  providerAttested: false;
  rootLineageProven: false;
  syntheticOnlyProven: false;
  databaseCatalogChecked: false;
  canConnectDatabase: false;
  canMigrate: false;
  canDeploy: false;
};

export async function checkViewerOnlyNeonProjectGet(
  token: string,
  sourceSha: string,
  transport: NeonViewerReadOnlyTransport,
): Promise<NeonViewerReadOnlyPreflight> {
  if (typeof token !== "string" || token.length < 16 || /\s/.test(token)) {
    throw new NeonViewerProbeRejected("VIEWER_TOKEN_ABSENT_OR_INVALID");
  }
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new NeonViewerProbeRejected("VIEWER_SOURCE_SHA_INVALID");
  }

  let response: { status: number; body: unknown };
  try {
    response = await transport({
      url: URL,
      method: "GET",
      headers: { Accept: "application/json", Authorization: "Bearer " + token },
      redirect: "error",
    });
  } catch {
    // Deliberately suppress request/response errors which may include tokens.
    throw new NeonViewerProbeRejected("VIEWER_API_GET_UNAVAILABLE");
  }
  if (response?.status !== 200 || !isRecord(response.body) ||
      !isRecord(response.body.project)) {
    throw new NeonViewerProbeRejected("VIEWER_API_PROJECT_RESPONSE_INVALID");
  }
  const project = response.body.project;
  if (project.id !== EXPECTED.projectId ||
      project.org_id !== EXPECTED.organizationId ||
      project.name !== EXPECTED.projectName ||
      project.region_id !== EXPECTED.regionId ||
      project.pg_version !== EXPECTED.postgresMajor) {
    throw new NeonViewerProbeRejected("VIEWER_API_TARGET_MISMATCH");
  }
  if (project.effective_project_permission !== "VIEWER") {
    // Organization Admin, org Editor, project Editor and unknown are denied,
    // including an organization-wide token scoped to the right project.
    throw new NeonViewerProbeRejected("VIEWER_API_EFFECTIVE_PERMISSION_DENIED");
  }
  return {
    targetProjectId: EXPECTED.projectId,
    sourceSha,
    observedPermission: "VIEWER",
    check: "METADATA_MATCHES_BUT_UNATTESTED",
    principalTokenPersisted: false,
    providerAttested: false,
    rootLineageProven: false,
    syntheticOnlyProven: false,
    databaseCatalogChecked: false,
    canConnectDatabase: false,
    canMigrate: false,
    canDeploy: false,
  };
}
