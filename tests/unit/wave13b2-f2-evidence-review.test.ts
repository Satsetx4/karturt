import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const QUERY_SHA256 = "bd4a9c725268dc80e3eab10d28da585da3399e6f75db676c29e9e014c5127c49";
const SOURCE_SHA = "1".repeat(40);
const AUDIT_DONE = `F2_DONE PASS source=${SOURCE_SHA} query=${QUERY_SHA256}`;
const EVIDENCE_FILE = `wave13b2-f2-catalog-evidence-${SOURCE_SHA}-${QUERY_SHA256}.local.txt`;
const AUDIT_FILE = `wave13b2-f2-audit-${SOURCE_SHA}-${QUERY_SHA256}.local.txt`;
const ATTEMPT_MARKER_FILE = `wave13b2-f2-query-attempt-${SOURCE_SHA}.local.txt`;
const EXPECTED_STATE_FILE = "wave13b2-staging-expected-state.local.json";

type CatalogSection = {
  name: string;
  header: string[] | null;
  rows: string[][];
};

type ReviewInput = {
  evidenceBytes: Buffer;
  auditBytes: Buffer;
  attemptMarkerBytes: Buffer;
  expectedStateBytes: Buffer;
  evidenceFileName: string;
  auditFileName: string;
  attemptMarkerFileName: string;
  expectedStateFileName: string;
};

type ReviewResult = {
  status: "MATCH" | "MISMATCH" | "FAILED";
  failureCodes: string[];
  matchedFields: string[];
  mismatchedFields: string[];
  [key: string]: unknown;
};

type ReviewerModule = {
  evaluateWave13B2F2Evidence: (input: ReviewInput) => ReviewResult;
  parseWave13B2F2Evidence: (text: string) => {
    markers: Array<{ type: string; name?: string; value: string }>;
    preamble: unknown[];
    sections: Map<string, unknown[]>;
  };
};

const reviewerModulePath = process.env.WAVE13B2_F2_REVIEWER_MODULE_PATH
  ? resolve(process.env.WAVE13B2_F2_REVIEWER_MODULE_PATH)
  : resolve(process.cwd(), "scripts/review-wave13b2-f2-evidence.mjs");
const reviewerModulePromise = import(pathToFileURL(reviewerModulePath).href) as Promise<ReviewerModule>;

const preamble = [
  [
    [
      "observed_database_name", "expected_database_name", "database_name_matches", "observed_role",
      "expected_role", "role_matches", "server_version", "server_major", "postgres_18",
      "transaction_read_only", "read_only_is_active",
    ],
    ["neondb", "neondb", "t", "neondb_owner", "neondb_owner", "t", "18.6.synthetic", "18", "t", "on", "t"],
  ],
  [
    ["database_oid", "database_name", "database_owner", "database_acl", "connections_allowed", "is_template"],
    ["49152", "neondb", "neondb_owner", "=Tc/neondb_owner", "t", "f"],
  ],
  [
    ["tls_active", "tls_version", "tls_cipher", "tls_bits"],
    ["t", "TLSv1.3", "TLS_AES_256_GCM_SHA384", "256"],
  ],
  [
    [
      "rolname", "rolcanlogin", "rolsuper", "rolinherit", "rolcreaterole", "rolcreatedb",
      "rolreplication", "rolbypassrls", "rolconnlimit",
    ],
    ["neondb_owner", "t", "f", "t", "f", "f", "f", "f", "-1"],
  ],
];

const catalogSections: CatalogSection[] = [
  { name: "MEMBERSHIP_LIMIT_COUNT", header: null, rows: [] },
  { name: "ROLE_MEMBERSHIP_INVENTORY", header: ["membership_role", "admin_option"], rows: [] },
  {
    name: "SCHEMA_DIAGNOSTIC_COUNT",
    header: ["non_system_schema_count", "non_public_schema_count"],
    rows: [["0", "0"]],
  },
  { name: "SCHEMA_LIMIT_COUNT", header: null, rows: [] },
  { name: "SCHEMA_INVENTORY", header: ["schema_name", "schema_owner", "explicit_acl"], rows: [] },
  {
    name: "RELATION_DIAGNOSTIC_COUNT",
    header: ["non_system_relation_count", "drizzle_journal_relation_count", "current_role_owned_relation_count"],
    rows: [["0", "0", "0"]],
  },
  { name: "RELATION_LIMIT_COUNT", header: null, rows: [] },
  {
    name: "RELATION_INVENTORY",
    header: ["schema_name", "relation_name", "relation_kind", "relation_owner", "is_drizzle_journal_candidate", "explicit_acl"],
    rows: [],
  },
  { name: "TYPE_DIAGNOSTIC_COUNT", header: ["non_system_type_object_count"], rows: [["0"]] },
  { name: "TYPE_LIMIT_COUNT", header: null, rows: [] },
  { name: "STANDALONE_APPLICATION_TYPE_COUNT", header: null, rows: [] },
  {
    name: "STANDALONE_APPLICATION_TYPE_INVENTORY",
    header: [
      "schema_name", "type_name", "type_kind", "postgres_type_category", "is_array_type", "array_element_type",
      "type_origin", "associated_relation_kind", "associated_relation_name", "owning_extensions", "type_owner", "explicit_acl",
    ],
    rows: [],
  },
  { name: "ROUTINE_DIAGNOSTIC_COUNT", header: ["non_system_routine_count"], rows: [["0"]] },
  { name: "ROUTINE_LIMIT_COUNT", header: null, rows: [] },
  { name: "ROUTINE_INVENTORY", header: ["schema_name", "routine_name", "routine_kind", "routine_owner", "explicit_acl"], rows: [] },
  { name: "EXTENSION_LIMIT_COUNT", header: null, rows: [] },
  { name: "EXTENSION_INVENTORY", header: ["extension_name", "extension_version", "extension_schema", "extension_owner"], rows: [] },
  { name: "DEFAULT_ACL_LIMIT_COUNT", header: null, rows: [] },
  { name: "DEFAULT_ACL_INVENTORY", header: ["grantor_role", "schema_name", "object_type", "default_acl"], rows: [] },
];

const checkMarkers = [
  "F2_CHECK TARGET_PROJECT_ID PASS",
  "F2_CHECK TARGET_BRANCH_ID PASS",
  "F2_CHECK TARGET_ENDPOINT_ID PASS",
  "F2_CHECK QUERY_PACKET_SHA256_FORMAT PASS",
  "F2_CHECK APPROVED_SOURCE_SHA_FORMAT PASS",
  "F2_CHECK DATABASE_NAME PASS",
  "F2_CHECK OWNER_ROLE PASS",
  "F2_CHECK POSTGRES_MAJOR PASS",
  "F2_CHECK TRANSACTION_READ_ONLY PASS",
  "F2_CHECK TLS_ACTIVE PASS",
  "F2_CHECK ROLE_MEMBERSHIP_OUTPUT_LIMIT count=0 limit=100",
  "F2_CHECK SCHEMA_OUTPUT_LIMIT count=0 limit=200",
  "F2_CHECK RELATION_OUTPUT_LIMIT count=0 limit=200",
  "F2_CHECK TYPE_OUTPUT_LIMIT count=0 limit=200",
  "F2_CHECK ROUTINE_OUTPUT_LIMIT count=0 limit=200",
  "F2_CHECK EXTENSION_OUTPUT_LIMIT count=0 limit=100",
  "F2_CHECK DEFAULT_ACL_OUTPUT_LIMIT count=0 limit=100",
  "F2_CHECK EMPTY_BASELINE_STANDALONE_TYPES count=0 expected=0",
];

function csvRecord(fields: string[]): string {
  return fields.map((field) => {
    if (/[",\r\n]/.test(field)) return `"${field.replaceAll('"', '""')}"`;
    return field;
  }).join(",");
}

function makeEvidenceText(): string {
  const records: string[] = [];
  for (const [header, row] of preamble) {
    records.push(csvRecord(header), csvRecord(row));
  }
  for (const section of catalogSections) {
    records.push(`F2_CATALOG_READ ${section.name}`);
    if (section.header) {
      records.push(csvRecord(section.header));
      for (const row of section.rows) records.push(csvRecord(row));
    }
  }
  // Rebuild in query order: connection checks precede catalog output; each count check follows its count query.
  const firstCatalog = records.findIndex((record) => record === "F2_CATALOG_READ MEMBERSHIP_LIMIT_COUNT");
  records.splice(firstCatalog, 0, ...checkMarkers.slice(0, 10));
  const checkBySection = new Map([
    ["MEMBERSHIP_LIMIT_COUNT", checkMarkers[10]],
    ["SCHEMA_LIMIT_COUNT", checkMarkers[11]],
    ["RELATION_LIMIT_COUNT", checkMarkers[12]],
    ["TYPE_LIMIT_COUNT", checkMarkers[13]],
    ["ROUTINE_LIMIT_COUNT", checkMarkers[14]],
    ["EXTENSION_LIMIT_COUNT", checkMarkers[15]],
    ["DEFAULT_ACL_LIMIT_COUNT", checkMarkers[16]],
    ["STANDALONE_APPLICATION_TYPE_COUNT", checkMarkers[17]],
  ]);
  const fixedRecords: string[] = [];
  for (const record of records) {
    fixedRecords.push(record);
    if (record.startsWith("F2_CATALOG_READ ")) {
      const sectionName = record.slice("F2_CATALOG_READ ".length);
      const check = checkBySection.get(sectionName);
      if (check) fixedRecords.push(check);
    }
  }
  fixedRecords.push(AUDIT_DONE);
  return `${fixedRecords.join("\n")}\n`;
}

function makeExpectedState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const otherOverrides = { ...overrides };
  delete otherOverrides.catalogExpected;
  const catalogExpected = {
    applicationOwnedRelationCount: 0,
    standaloneApplicationTypeCount: 0,
    drizzleJournalPresent: false,
    tlsVerified: true,
    transactionReadOnly: true,
    postgresMajor: 18,
    ...(overrides.catalogExpected as Record<string, unknown> | undefined),
  };
  return {
    ...otherOverrides,
    schemaVersion: 1,
    state: "ROOT_VERIFIED_CATALOG_UNKNOWN",
    binding: {
      finalSourceSha: SOURCE_SHA,
      queryPacketSha256: QUERY_SHA256,
      databaseName: "neondb",
      ownerRole: "neondb_owner",
    },
    catalogExpected,
    catalogObserved: {
      applicationOwnedRelationCount: null,
      standaloneApplicationTypeCount: null,
      drizzleJournalPresent: null,
      tlsVerified: null,
      transactionReadOnly: null,
      postgresMajor: null,
    },
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeFixture(options: {
  evidenceText?: string;
  expectedState?: Record<string, unknown>;
  auditOverrides?: Record<string, string>;
  evidenceFileName?: string;
  auditFileName?: string;
  expectedStateFileName?: string;
} = {}): ReviewInput {
  const evidenceBytes = Buffer.from(options.evidenceText ?? makeEvidenceText(), "utf8");
  const expectedState = options.expectedState ?? makeExpectedState();
  const expectedStateBytes = Buffer.from(JSON.stringify(expectedState), "utf8");
  const evidenceFileName = options.evidenceFileName ?? EVIDENCE_FILE;
  const auditFileName = options.auditFileName ?? AUDIT_FILE;
  const attemptMarkerFileName = ATTEMPT_MARKER_FILE;
  const expectedStateFileName = options.expectedStateFileName ?? EXPECTED_STATE_FILE;
  const evidenceMarkers = evidenceBytes.toString("utf8")
    .split(/\r?\n/)
    .filter((line) => /^F2_(?:CHECK|CATALOG_READ|DONE|FAIL|STOP)\b/.test(line));
  const auditFields: Record<string, string> = {
    F2_AUDIT_FORMAT: "2",
    sourceSha: SOURCE_SHA,
    queryPacketSha256: QUERY_SHA256,
    outputFormat: "csv",
    psqlStarted: "true",
    psqlExitCode: "0",
    status: "COMPLETED",
    failureCodes: "",
    expectedStateSha256: sha256(expectedStateBytes),
    expectedStateBytes: String(expectedStateBytes.length),
    evidenceVerified: "true",
    evidenceFile: evidenceFileName,
    evidenceBytes: String(evidenceBytes.length),
    evidenceSha256: sha256(evidenceBytes),
    sanitizedMarkerCount: String(evidenceMarkers.length),
    ...options.auditOverrides,
  };
  const auditText = [
    ...Object.entries(auditFields).map(([key, value]) => `${key}=${value}`),
    "sanitizedMarkersBegin",
    ...evidenceMarkers,
    "sanitizedMarkersEnd",
    "",
  ].join("\n");
  const auditBytes = Buffer.from(auditText, "utf8");
  const attemptMarkerText = [
    "status=STARTED",
    `sourceSha=${SOURCE_SHA}`,
    `queryPacketSha256=${QUERY_SHA256}`,
    `expectedStateFile=${expectedStateFileName}`,
    `expectedStateBytes=${expectedStateBytes.length}`,
    `expectedStateSha256=${sha256(expectedStateBytes)}`,
    "status=COMPLETED",
    "psqlExitCode=0",
    "failureCodes=",
    "outputFormat=csv",
    `evidenceFile=${evidenceFileName}`,
    `evidenceBytes=${evidenceBytes.length}`,
    `evidenceSha256=${sha256(evidenceBytes)}`,
    "evidenceVerified=true",
    `auditFile=${auditFileName}`,
    `auditSha256=${sha256(auditBytes)}`,
    "",
  ].join("\n");
  return {
    evidenceBytes,
    auditBytes,
    attemptMarkerBytes: Buffer.from(attemptMarkerText, "utf8"),
    expectedStateBytes,
    evidenceFileName,
    auditFileName,
    attemptMarkerFileName,
    expectedStateFileName,
  };
}

describe("Wave 13B.2 F2 owner evidence review", () => {
  it("matches a complete synthetic CSV evidence file to expected state and the sanitized audit", async () => {
    const reviewer = await reviewerModulePromise;
    const fixture = makeFixture();
    const result = reviewer.evaluateWave13B2F2Evidence(fixture);
    const parsed = reviewer.parseWave13B2F2Evidence(fixture.evidenceBytes.toString("utf8"));

    expect(parsed.sections.size).toBe(19);
    expect(parsed.markers.filter(({ type }) => type === "check")).toHaveLength(18);
    expect(result.status).toBe("MATCH");
    expect(result.failureCodes).toEqual([]);
    expect(result.mismatchedFields).toEqual([]);
    expect(result.matchedFields).toHaveLength(6);
  });

  it.each([
    ["applicationOwnedRelationCount", 1],
    ["standaloneApplicationTypeCount", 1],
    ["drizzleJournalPresent", true],
    ["tlsVerified", false],
    ["transactionReadOnly", false],
    ["postgresMajor", 17],
  ])("reports expected-state mismatch for %s", async (field, value) => {
    const reviewer = await reviewerModulePromise;
    const fixture = makeFixture({ expectedState: makeExpectedState({ catalogExpected: { [field]: value } }) });
    const result = reviewer.evaluateWave13B2F2Evidence(fixture);

    expect(result.status).toBe("MISMATCH");
    expect(result.mismatchedFields).toEqual([field]);
    expect(result.matchedFields).toHaveLength(5);
    expect(result.failureCodes).toHaveLength(1);
  });

  it("rejects modified evidence when the audit still pins the original digest", async () => {
    const reviewer = await reviewerModulePromise;
    const fixture = makeFixture();
    fixture.evidenceBytes[fixture.evidenceBytes.indexOf(Buffer.from("18.6.synthetic"))] ^= 1;
    const result = reviewer.evaluateWave13B2F2Evidence(fixture);

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toContain("F2_EVIDENCE_SHA256_MISMATCH");
  });

  it("rejects truncated output even when the audit is rebound to the truncated bytes", async () => {
    const reviewer = await reviewerModulePromise;
    const complete = makeFixture();
    const truncatedText = complete.evidenceBytes.toString("utf8").slice(0, -1);
    const fixture = makeFixture({ evidenceText: truncatedText });
    const result = reviewer.evaluateWave13B2F2Evidence(fixture);

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toContain("F2_EVIDENCE_TRUNCATED");
  });

  it("rejects an injected failure marker inside otherwise complete evidence", async () => {
    const reviewer = await reviewerModulePromise;
    const evidenceText = makeEvidenceText().replace(AUDIT_DONE, `F2_FAIL SYNTHETIC_MARKER_INJECTION\n${AUDIT_DONE}`);
    const result = reviewer.evaluateWave13B2F2Evidence(makeFixture({ evidenceText }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toContain("F2_FAILURE_MARKER_PRESENT");
  });

  it("rejects missing and malformed catalog sections", async () => {
    const reviewer = await reviewerModulePromise;
    const complete = makeEvidenceText();
    const missingSection = complete.replace("F2_CATALOG_READ RELATION_INVENTORY\n", "");
    const malformedHeader = complete.replace(
      "schema_name,relation_name,relation_kind,relation_owner,is_drizzle_journal_candidate,explicit_acl",
      "schema_name,relation_name,relation_kind,relation_owner,changed_header,explicit_acl",
    );

    expect(reviewer.evaluateWave13B2F2Evidence(makeFixture({ evidenceText: missingSection })).failureCodes)
      .toContain("F2_CATALOG_SECTION_SET_MISMATCH");
    expect(reviewer.evaluateWave13B2F2Evidence(makeFixture({ evidenceText: malformedHeader })).failureCodes)
      .toContain("F2_CATALOG_SECTION_HEADER_MISMATCH");
  });

  it("does not accept F2_DONE without the complete expected sections and catalog checks", async () => {
    const reviewer = await reviewerModulePromise;
    const result = reviewer.evaluateWave13B2F2Evidence(makeFixture({ evidenceText: `${AUDIT_DONE}\n` }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).not.toEqual([]);
  });

  it("rejects malformed audit fields and incorrect file bindings", async () => {
    const reviewer = await reviewerModulePromise;
    const duplicateAudit = makeFixture();
    duplicateAudit.auditBytes = Buffer.concat([duplicateAudit.auditBytes, Buffer.from("status=COMPLETED\n", "utf8")]);
    const wrongName = makeFixture({ evidenceFileName: "wrong-evidence.local.txt" });

    expect(reviewer.evaluateWave13B2F2Evidence(duplicateAudit).failureCodes).toContain("F2_AUDIT_DUPLICATE_FIELD");
    expect(reviewer.evaluateWave13B2F2Evidence(wrongName).failureCodes).toContain("F2_EVIDENCE_FILENAME_MISMATCH");
  });

  it("does not accept completed evidence when psql did not start", async () => {
    const reviewer = await reviewerModulePromise;
    const result = reviewer.evaluateWave13B2F2Evidence(makeFixture({
      auditOverrides: { psqlStarted: "false" },
    }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toContain("F2_PSQL_NOT_STARTED");
  });

  it("rejects expected-state bytes that differ from the signed-preflight pin recorded in audit and marker", async () => {
    const reviewer = await reviewerModulePromise;
    const fixture = makeFixture();
    const majorValueIndex =
      fixture.expectedStateBytes.indexOf(Buffer.from('"postgresMajor":18')) +
      Buffer.byteLength('"postgresMajor":1');
    fixture.expectedStateBytes[majorValueIndex] ^= 1;
    const result = reviewer.evaluateWave13B2F2Evidence(fixture);

    expect(result.status).toBe("FAILED");
    expect(result.failureCodes).toContain("F2_EXPECTED_STATE_SHA256_MISMATCH");
  });
});
