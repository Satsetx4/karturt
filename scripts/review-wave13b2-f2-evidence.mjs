import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

export const WAVE13B2_F2_QUERY_SHA256 =
  "bd4a9c725268dc80e3eab10d28da585da3399e6f75db676c29e9e014c5127c49";

const REQUIRED_CATALOG_SECTIONS = [
  "MEMBERSHIP_LIMIT_COUNT",
  "ROLE_MEMBERSHIP_INVENTORY",
  "SCHEMA_DIAGNOSTIC_COUNT",
  "SCHEMA_LIMIT_COUNT",
  "SCHEMA_INVENTORY",
  "RELATION_DIAGNOSTIC_COUNT",
  "RELATION_LIMIT_COUNT",
  "RELATION_INVENTORY",
  "TYPE_DIAGNOSTIC_COUNT",
  "TYPE_LIMIT_COUNT",
  "STANDALONE_APPLICATION_TYPE_COUNT",
  "STANDALONE_APPLICATION_TYPE_INVENTORY",
  "ROUTINE_DIAGNOSTIC_COUNT",
  "ROUTINE_LIMIT_COUNT",
  "ROUTINE_INVENTORY",
  "EXTENSION_LIMIT_COUNT",
  "EXTENSION_INVENTORY",
  "DEFAULT_ACL_LIMIT_COUNT",
  "DEFAULT_ACL_INVENTORY",
];

const SECTION_HEADERS = {
  MEMBERSHIP_LIMIT_COUNT: null,
  ROLE_MEMBERSHIP_INVENTORY: ["membership_role", "admin_option"],
  SCHEMA_DIAGNOSTIC_COUNT: ["non_system_schema_count", "non_public_schema_count"],
  SCHEMA_LIMIT_COUNT: null,
  SCHEMA_INVENTORY: ["schema_name", "schema_owner", "explicit_acl"],
  RELATION_DIAGNOSTIC_COUNT: [
    "non_system_relation_count",
    "drizzle_journal_relation_count",
    "current_role_owned_relation_count",
  ],
  RELATION_LIMIT_COUNT: null,
  RELATION_INVENTORY: [
    "schema_name",
    "relation_name",
    "relation_kind",
    "relation_owner",
    "is_drizzle_journal_candidate",
    "explicit_acl",
  ],
  TYPE_DIAGNOSTIC_COUNT: ["non_system_type_object_count"],
  TYPE_LIMIT_COUNT: null,
  STANDALONE_APPLICATION_TYPE_COUNT: null,
  STANDALONE_APPLICATION_TYPE_INVENTORY: [
    "schema_name",
    "type_name",
    "type_kind",
    "postgres_type_category",
    "is_array_type",
    "array_element_type",
    "type_origin",
    "associated_relation_kind",
    "associated_relation_name",
    "owning_extensions",
    "type_owner",
    "explicit_acl",
  ],
  ROUTINE_DIAGNOSTIC_COUNT: ["non_system_routine_count"],
  ROUTINE_LIMIT_COUNT: null,
  ROUTINE_INVENTORY: [
    "schema_name",
    "routine_name",
    "routine_kind",
    "routine_owner",
    "explicit_acl",
  ],
  EXTENSION_LIMIT_COUNT: null,
  EXTENSION_INVENTORY: [
    "extension_name",
    "extension_version",
    "extension_schema",
    "extension_owner",
  ],
  DEFAULT_ACL_LIMIT_COUNT: null,
  DEFAULT_ACL_INVENTORY: [
    "grantor_role",
    "schema_name",
    "object_type",
    "default_acl",
  ],
};

const OUTPUT_LIMITS = {
  ROLE_MEMBERSHIP_OUTPUT_LIMIT: 100,
  SCHEMA_OUTPUT_LIMIT: 200,
  RELATION_OUTPUT_LIMIT: 200,
  TYPE_OUTPUT_LIMIT: 200,
  ROUTINE_OUTPUT_LIMIT: 200,
  EXTENSION_OUTPUT_LIMIT: 100,
  DEFAULT_ACL_OUTPUT_LIMIT: 100,
};

const REQUIRED_PREAMBLE_HEADERS = [
  [
    "observed_database_name",
    "expected_database_name",
    "database_name_matches",
    "observed_role",
    "expected_role",
    "role_matches",
    "server_version",
    "server_major",
    "postgres_18",
    "transaction_read_only",
    "read_only_is_active",
  ],
  [
    "database_oid",
    "database_name",
    "database_owner",
    "database_acl",
    "connections_allowed",
    "is_template",
  ],
  ["tls_active", "tls_version", "tls_cipher", "tls_bits"],
  [
    "rolname",
    "rolcanlogin",
    "rolsuper",
    "rolinherit",
    "rolcreaterole",
    "rolcreatedb",
    "rolreplication",
    "rolbypassrls",
    "rolconnlimit",
  ],
];

const REQUIRED_CHECK_NAMES = [
  "TARGET_PROJECT_ID",
  "TARGET_BRANCH_ID",
  "TARGET_ENDPOINT_ID",
  "QUERY_PACKET_SHA256_FORMAT",
  "APPROVED_SOURCE_SHA_FORMAT",
  "DATABASE_NAME",
  "OWNER_ROLE",
  "POSTGRES_MAJOR",
  "TRANSACTION_READ_ONLY",
  "TLS_ACTIVE",
  ...Object.keys(OUTPUT_LIMITS),
  "EMPTY_BASELINE_STANDALONE_TYPES",
];

class ReviewFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ReviewFailure(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function strictUtf8(bytes, code) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(code);
  }
}

function parseCsvRecord(raw) {
  const fields = [];
  let field = "";
  let quoted = false;
  let fieldWasQuoted = false;
  let afterQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (character === '"') {
        if (raw[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        fields.push(field);
        field = "";
        fieldWasQuoted = false;
        afterQuote = false;
      } else {
        fail("F2_EVIDENCE_CSV_INVALID");
      }
      continue;
    }

    if (character === ",") {
      fields.push(field);
      field = "";
      fieldWasQuoted = false;
    } else if (character === '"') {
      if (field.length !== 0 || fieldWasQuoted) {
        fail("F2_EVIDENCE_CSV_INVALID");
      }
      quoted = true;
      fieldWasQuoted = true;
    } else {
      field += character;
    }
  }

  if (quoted) {
    fail("F2_EVIDENCE_CSV_UNTERMINATED_QUOTE");
  }
  fields.push(field);
  return fields;
}

function parseControlMarker(record) {
  if (/^F2_(?:FAIL|STOP)\b/.test(record) || /^ERROR:\s+F2_STOP\b/.test(record)) {
    return { type: "failure", value: record };
  }
  if (/^F2_DONE\b/.test(record)) {
    if (!/^F2_DONE PASS source=[a-f0-9]{40} query=[a-f0-9]{64}$/.test(record)) {
      fail("F2_DONE_MARKER_INVALID");
    }
    return { type: "done", value: record };
  }
  const catalogRead = /^F2_CATALOG_READ ([A-Z0-9_]+)$/.exec(record);
  if (catalogRead) {
    return { type: "catalogRead", name: catalogRead[1], value: record };
  }
  const check = /^F2_CHECK ([A-Z0-9_]+) (PASS|count=[0-9]+ (?:limit|expected)=[0-9]+)$/.exec(record);
  if (check) {
    return { type: "check", name: check[1], value: record };
  }
  if (/^F2_[A-Z0-9_]+\b/.test(record) || /^ERROR:\s+F2_/.test(record)) {
    fail("F2_EVIDENCE_UNKNOWN_CONTROL_MARKER");
  }
  return null;
}

export function parseWave13B2F2Evidence(text) {
  if (typeof text !== "string" || text.length === 0 || !text.endsWith("\n")) {
    fail("F2_EVIDENCE_TRUNCATED");
  }

  const records = [];
  let rawRecord = "";
  let insideQuotedField = false;
  let atFieldStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (insideQuotedField) {
      rawRecord += character;
      if (character === '"') {
        if (text[index + 1] === '"') {
          rawRecord += text[index + 1];
          index += 1;
        } else {
          insideQuotedField = false;
        }
      }
      continue;
    }

    if (character === '"' && atFieldStart) {
      insideQuotedField = true;
      atFieldStart = false;
      rawRecord += character;
    } else if (character === ",") {
      atFieldStart = true;
      rawRecord += character;
    } else if (character === "\n") {
      if (rawRecord.endsWith("\r")) {
        rawRecord = rawRecord.slice(0, -1);
      }
      if (rawRecord.length === 0) {
        fail("F2_EVIDENCE_UNKNOWN_OUTPUT");
      }
      records.push(rawRecord);
      rawRecord = "";
      atFieldStart = true;
    } else {
      if (character === '"') {
        fail("F2_EVIDENCE_CSV_INVALID");
      }
      atFieldStart = false;
      rawRecord += character;
    }
  }
  if (insideQuotedField) {
    fail("F2_EVIDENCE_CSV_UNTERMINATED_QUOTE");
  }
  if (rawRecord.length > 0) {
    fail("F2_EVIDENCE_TRUNCATED");
  }

  const preamble = [];
  const sections = new Map();
  const markers = [];
  const events = [];
  let activeSection = null;
  for (const raw of records) {
    const marker = parseControlMarker(raw);
    if (marker) {
      markers.push(marker);
      events.push({ kind: "marker", marker });
      if (marker.type === "catalogRead") {
        if (sections.has(marker.name)) {
          fail("F2_CATALOG_SECTION_DUPLICATE");
        }
        activeSection = marker.name;
        sections.set(activeSection, []);
      }
      continue;
    }

    const fields = parseCsvRecord(raw);
    const row = { fields, raw };
    if (activeSection === null) {
      preamble.push(row);
    } else {
      sections.get(activeSection).push(row);
    }
    events.push({ kind: "csv", row, section: activeSection });
  }

  if (events.length === 0 || events.at(-1)?.kind !== "marker" || events.at(-1)?.marker.type !== "done") {
    fail("F2_EVIDENCE_DONE_NOT_FINAL");
  }

  return { markers, preamble, sections, events };
}

function parseKeyValueAudit(text) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    if (fields.has(match[1])) {
      fail("F2_AUDIT_DUPLICATE_FIELD");
    }
    fields.set(match[1], match[2]);
  }
  return fields;
}

function requireField(fields, name) {
  const value = fields.get(name);
  if (value === undefined) fail("F2_AUDIT_REQUIRED_FIELD_MISSING");
  return value;
}

function validateAudit(auditFields, evidenceBytes, evidenceFileName, expectedStateBytes, expectedState) {
  const sourceSha = requireField(auditFields, "sourceSha");
  const querySha = requireField(auditFields, "queryPacketSha256");
  const evidenceSha = sha256(evidenceBytes);
  const expectedStateSha = sha256(expectedStateBytes);
  if (sourceSha !== expectedState.binding.finalSourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) {
    fail("F2_SOURCE_SHA_MISMATCH");
  }
  if (querySha !== WAVE13B2_F2_QUERY_SHA256 || querySha !== expectedState.binding.queryPacketSha256) {
    fail("F2_QUERY_SHA_MISMATCH");
  }
  if (requireField(auditFields, "status") !== "COMPLETED") {
    fail("F2_RUNNER_NOT_COMPLETED");
  }
  if (requireField(auditFields, "F2_AUDIT_FORMAT") !== "2") {
    fail("F2_AUDIT_FORMAT_INVALID");
  }
  if (requireField(auditFields, "psqlExitCode") !== "0") {
    fail("F2_PSQL_EXIT_CODE_INVALID");
  }
  if (requireField(auditFields, "psqlStarted") !== "true") {
    fail("F2_PSQL_NOT_STARTED");
  }
  if (requireField(auditFields, "expectedStateSha256") !== expectedStateSha) {
    fail("F2_EXPECTED_STATE_SHA256_MISMATCH");
  }
  const expectedStateByteCount = Number(requireField(auditFields, "expectedStateBytes"));
  if (!Number.isSafeInteger(expectedStateByteCount) || expectedStateByteCount !== expectedStateBytes.length) {
    fail("F2_EXPECTED_STATE_BYTE_LENGTH_MISMATCH");
  }
  if (requireField(auditFields, "outputFormat") !== "csv") {
    fail("F2_OUTPUT_FORMAT_INVALID");
  }
  if (requireField(auditFields, "evidenceVerified") !== "true") {
    fail("F2_EVIDENCE_NOT_VERIFIED");
  }
  if (requireField(auditFields, "evidenceFile") !== evidenceFileName) {
    fail("F2_EVIDENCE_FILENAME_MISMATCH");
  }
  const evidenceByteCount = Number(requireField(auditFields, "evidenceBytes"));
  if (!Number.isSafeInteger(evidenceByteCount) || evidenceByteCount !== evidenceBytes.length) {
    fail("F2_EVIDENCE_BYTE_LENGTH_MISMATCH");
  }
  if (requireField(auditFields, "evidenceSha256") !== evidenceSha) {
    fail("F2_EVIDENCE_SHA256_MISMATCH");
  }
  const failureCodes = requireField(auditFields, "failureCodes");
  if (failureCodes !== "") {
    fail("F2_AUDIT_FAILURE_CODE_PRESENT");
  }
  if (/\bF2_(?:FAIL|STOP)\b|\bERROR:\s+F2_STOP\b/.test([...auditFields.entries()].flat().join("\n"))) {
    fail("F2_AUDIT_FAILURE_MARKER_PRESENT");
  }
  return { sourceSha, querySha, evidenceSha, expectedStateSha, expectedStateBytes: expectedStateBytes.length };
}

function validateAttemptMarker(
  markerText,
  markerFileName,
  pins,
  evidenceFileName,
  evidenceBytes,
  auditFileName,
  auditBytes,
  expectedStateFileName,
) {
  const expectedMarkerName = `wave13b2-f2-query-attempt-${pins.sourceSha}.local.txt`;
  if (markerFileName !== expectedMarkerName) fail("F2_ATTEMPT_MARKER_FILENAME_MISMATCH");
  const fields = new Map();
  for (const line of markerText.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    if (match[1] === "status") {
      const values = fields.get("status") ?? [];
      values.push(match[2]);
      fields.set("status", values);
      continue;
    }
    if (fields.has(match[1])) fail("F2_ATTEMPT_MARKER_DUPLICATE_FIELD");
    fields.set(match[1], match[2]);
  }
  const statuses = fields.get("status");
  if (!Array.isArray(statuses) || JSON.stringify(statuses) !== JSON.stringify(["STARTED", "COMPLETED"])) {
    fail("F2_ATTEMPT_MARKER_STATUS_INVALID");
  }
  const required = (name) => {
    const value = fields.get(name);
    if (typeof value !== "string") fail("F2_ATTEMPT_MARKER_FIELD_MISSING");
    return value;
  };
  if (
    required("sourceSha") !== pins.sourceSha ||
    required("queryPacketSha256") !== pins.querySha ||
    required("outputFormat") !== "csv" ||
    required("psqlExitCode") !== "0" ||
    required("failureCodes") !== "" ||
    required("expectedStateFile") !== expectedStateFileName ||
    required("expectedStateBytes") !== String(pins.expectedStateBytes) ||
    required("expectedStateSha256") !== pins.expectedStateSha ||
    required("evidenceFile") !== evidenceFileName ||
    required("evidenceBytes") !== String(evidenceBytes.length) ||
    required("evidenceSha256") !== pins.evidenceSha ||
    required("evidenceVerified") !== "true" ||
    required("auditFile") !== auditFileName ||
    required("auditSha256") !== sha256(auditBytes)
  ) {
    fail("F2_ATTEMPT_MARKER_EVIDENCE_MISMATCH");
  }
}

function rowAsObject(headers, fields) {
  if (headers.length !== fields.length) {
    fail("F2_EVIDENCE_CSV_FIELD_COUNT_MISMATCH");
  }
  return Object.fromEntries(headers.map((header, index) => [header, fields[index]]));
}

function sectionObjects(parsed, sectionName, expectedHeader, minimumRows = 0) {
  const rows = parsed.sections.get(sectionName);
  if (rows === undefined) fail("F2_CATALOG_SECTION_MISSING");
  if (expectedHeader === null) {
    if (rows.length !== 0) fail("F2_CATALOG_SECTION_UNEXPECTED_ROWS");
    return [];
  }
  if (rows.length < minimumRows + 1) fail("F2_CATALOG_SECTION_INCOMPLETE");
  const actualHeader = rows[0].fields;
  if (JSON.stringify(actualHeader) !== JSON.stringify(expectedHeader)) {
    fail("F2_CATALOG_SECTION_HEADER_MISMATCH");
  }
  return rows.slice(1).map(({ fields }) => rowAsObject(expectedHeader, fields));
}

function requiredCheckMarkers(parsed) {
  const checkMarkers = parsed.markers.filter(({ type }) => type === "check");
  const byName = new Map();
  for (const marker of checkMarkers) {
    if (byName.has(marker.name)) fail("F2_CHECK_MARKER_DUPLICATE");
    byName.set(marker.name, marker.value);
  }
  if (JSON.stringify([...byName.keys()].sort()) !== JSON.stringify([...REQUIRED_CHECK_NAMES].sort())) {
    fail("F2_CHECK_MARKER_SET_MISMATCH");
  }
  for (const name of REQUIRED_CHECK_NAMES.filter((name) => !name.endsWith("_OUTPUT_LIMIT") && name !== "EMPTY_BASELINE_STANDALONE_TYPES")) {
    if (byName.get(name) !== `F2_CHECK ${name} PASS`) fail("F2_CHECK_MARKER_FAILED");
  }
  for (const [name, limit] of Object.entries(OUTPUT_LIMITS)) {
    const match = new RegExp(`^F2_CHECK ${name} count=([0-9]+) limit=${limit}$`).exec(byName.get(name) ?? "");
    if (!match) fail("F2_OUTPUT_LIMIT_MARKER_INVALID");
  }
  const standalone = /^F2_CHECK EMPTY_BASELINE_STANDALONE_TYPES count=([0-9]+) expected=0$/.exec(
    byName.get("EMPTY_BASELINE_STANDALONE_TYPES") ?? "",
  );
  if (!standalone) fail("F2_STANDALONE_TYPE_MARKER_INVALID");
  return { byName, standaloneCount: Number(standalone[1]) };
}

function parseCountMarker(marker, name, limit) {
  const match = new RegExp(`^F2_CHECK ${name} count=([0-9]+) limit=${limit}$`).exec(marker ?? "");
  if (!match) fail("F2_OUTPUT_LIMIT_MARKER_INVALID");
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value)) fail("F2_OUTPUT_COUNT_INVALID");
  return value;
}

function assertCompletedMarkers(parsed, sourceSha, querySha) {
  const done = parsed.markers.filter(({ type }) => type === "done");
  if (done.length !== 1 || done[0].value !== `F2_DONE PASS source=${sourceSha} query=${querySha}`) {
    fail("F2_DONE_MARKER_MISSING_OR_INVALID");
  }
  if (parsed.markers.some(({ type }) => type === "failure")) {
    fail("F2_FAILURE_MARKER_PRESENT");
  }
  const catalogReads = parsed.markers.filter(({ type }) => type === "catalogRead").map(({ name }) => name);
  if (JSON.stringify(catalogReads) !== JSON.stringify(REQUIRED_CATALOG_SECTIONS)) {
    fail("F2_CATALOG_SECTION_SET_MISMATCH");
  }
}

function checkPreamble(parsed, expectedState) {
  if (parsed.preamble.length !== REQUIRED_PREAMBLE_HEADERS.length * 2) {
    fail("F2_PREAMBLE_INCOMPLETE");
  }
  const tables = [];
  for (let index = 0; index < REQUIRED_PREAMBLE_HEADERS.length; index += 1) {
    const header = parsed.preamble[index * 2]?.fields;
    const data = parsed.preamble[index * 2 + 1]?.fields;
    const expectedHeader = REQUIRED_PREAMBLE_HEADERS[index];
    if (JSON.stringify(header) !== JSON.stringify(expectedHeader) || !data) {
      fail("F2_PREAMBLE_HEADER_MISMATCH");
    }
    tables.push(rowAsObject(expectedHeader, data));
  }
  const [identity, database, tls, role] = tables;
  const expectedDb = expectedState.providerObserved?.databaseName ?? expectedState.binding.databaseName;
  const expectedRole = expectedState.providerObserved?.ownerRole ?? expectedState.binding.ownerRole;
  if (
    identity.observed_database_name !== expectedDb ||
    identity.expected_database_name !== expectedDb ||
    identity.observed_role !== expectedRole ||
    identity.expected_role !== expectedRole ||
    database.database_name !== expectedDb ||
    database.database_owner !== expectedRole ||
    identity.database_name_matches !== "t" ||
    identity.role_matches !== "t" ||
    identity.postgres_18 !== "t" ||
    identity.read_only_is_active !== "t" ||
    identity.transaction_read_only !== "on" ||
    database.connections_allowed !== "t" ||
    database.is_template !== "f" ||
    tls.tls_active !== "t" ||
    role.rolname !== expectedRole
  ) {
    fail("F2_PREAMBLE_EXPECTED_STATE_CONTRACT_FAILED");
  }
  const major = Number(identity.server_major);
  if (!Number.isSafeInteger(major)) fail("F2_POSTGRES_MAJOR_INVALID");
  return { identity, database, tls, role, postgresMajor: major };
}

function expectedStateFailures(expectedState, checks, sections, preamble) {
  const actual = {
    applicationOwnedRelationCount: Number(sections.RELATION_DIAGNOSTIC_COUNT[0]?.current_role_owned_relation_count),
    standaloneApplicationTypeCount: checks.standaloneCount,
    drizzleJournalPresent: Number(sections.RELATION_DIAGNOSTIC_COUNT[0]?.drizzle_journal_relation_count) > 0,
    tlsVerified: preamble.tls.tls_active === "t",
    transactionReadOnly: preamble.identity.read_only_is_active === "t",
    postgresMajor: preamble.postgresMajor,
  };
  const matchedFields = [];
  const mismatchedFields = [];
  for (const [key, expectedValue] of Object.entries(expectedState.catalogExpected)) {
    if (actual[key] === expectedValue) matchedFields.push(key);
    else mismatchedFields.push(key);
  }
  return { actual, matchedFields, mismatchedFields };
}

function validateExpectedStateShape(expectedState) {
  if (
    expectedState?.schemaVersion !== 1 ||
    expectedState.state !== "ROOT_VERIFIED_CATALOG_UNKNOWN" ||
    !/^[a-f0-9]{40}$/.test(expectedState.binding?.finalSourceSha ?? "") ||
    !/^[a-f0-9]{64}$/.test(expectedState.binding?.queryPacketSha256 ?? "") ||
    !expectedState.catalogExpected ||
    !expectedState.catalogObserved
  ) {
    fail("F2_EXPECTED_STATE_INVALID");
  }
  if (expectedState.binding.queryPacketSha256 !== WAVE13B2_F2_QUERY_SHA256) {
    fail("F2_QUERY_SHA_MISMATCH");
  }
  if (Object.values(expectedState.catalogObserved).some((value) => value !== null)) {
    fail("F2_EXPECTED_STATE_HAS_STALE_OBSERVATIONS");
  }
  const expectedKeys = [
    "applicationOwnedRelationCount",
    "standaloneApplicationTypeCount",
    "drizzleJournalPresent",
    "tlsVerified",
    "transactionReadOnly",
    "postgresMajor",
  ];
  if (JSON.stringify(Object.keys(expectedState.catalogExpected).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    fail("F2_EXPECTED_STATE_FIELDS_INVALID");
  }
  if (
    !Number.isSafeInteger(expectedState.catalogExpected.applicationOwnedRelationCount) ||
    !Number.isSafeInteger(expectedState.catalogExpected.standaloneApplicationTypeCount) ||
    typeof expectedState.catalogExpected.drizzleJournalPresent !== "boolean" ||
    typeof expectedState.catalogExpected.tlsVerified !== "boolean" ||
    typeof expectedState.catalogExpected.transactionReadOnly !== "boolean" ||
    !Number.isSafeInteger(expectedState.catalogExpected.postgresMajor)
  ) {
    fail("F2_EXPECTED_STATE_FIELDS_INVALID");
  }
}

function makeFailureResult(code) {
  return {
    status: "FAILED",
    failureCodes: [code],
    matchedFields: [],
    mismatchedFields: [],
  };
}

export function evaluateWave13B2F2Evidence({
  evidenceBytes,
  auditBytes,
  attemptMarkerBytes,
  expectedStateBytes,
  evidenceFileName,
  auditFileName,
  attemptMarkerFileName,
  expectedStateFileName,
}) {
  try {
    const evidenceText = strictUtf8(evidenceBytes, "F2_EVIDENCE_UTF8_INVALID");
    const auditText = strictUtf8(auditBytes, "F2_AUDIT_UTF8_INVALID");
    const attemptMarkerText = strictUtf8(attemptMarkerBytes, "F2_ATTEMPT_MARKER_UTF8_INVALID");
    const expectedStateText = strictUtf8(expectedStateBytes, "F2_EXPECTED_STATE_UTF8_INVALID");
    const expectedState = JSON.parse(expectedStateText);
    validateExpectedStateShape(expectedState);
    const auditFields = parseKeyValueAudit(auditText);
    const pins = validateAudit(auditFields, evidenceBytes, evidenceFileName, expectedStateBytes, expectedState);
    if (auditFileName !== `wave13b2-f2-audit-${pins.sourceSha}-${pins.querySha}.local.txt`) {
      fail("F2_AUDIT_FILENAME_MISMATCH");
    }
    if (evidenceFileName !== `wave13b2-f2-catalog-evidence-${pins.sourceSha}-${pins.querySha}.local.txt`) {
      fail("F2_EVIDENCE_FILENAME_MISMATCH");
    }
    if (expectedStateFileName !== "wave13b2-staging-expected-state.local.json") {
      fail("F2_EXPECTED_STATE_FILENAME_MISMATCH");
    }
    validateAttemptMarker(
      attemptMarkerText,
      attemptMarkerFileName,
      pins,
      evidenceFileName,
      evidenceBytes,
      auditFileName,
      auditBytes,
      expectedStateFileName,
    );
    const parsed = parseWave13B2F2Evidence(evidenceText);
    assertCompletedMarkers(parsed, pins.sourceSha, pins.querySha);

    const markerBlock = /^sanitizedMarkersBegin\r?\n([\s\S]*?)\r?\nsanitizedMarkersEnd(?:\r?\n|$)/m.exec(auditText);
    if (!markerBlock) fail("F2_AUDIT_MARKER_BLOCK_INVALID");
    const auditedMarkers = markerBlock[1] === "" ? [] : markerBlock[1].split(/\r?\n/);
    const auditedMarkerCount = Number(requireField(auditFields, "sanitizedMarkerCount"));
    if (!Number.isSafeInteger(auditedMarkerCount) || auditedMarkerCount !== auditedMarkers.length) {
      fail("F2_AUDIT_MARKER_COUNT_MISMATCH");
    }
    const rawMarkers = parsed.markers.map(({ value }) => value);
    if (JSON.stringify(auditedMarkers) !== JSON.stringify(rawMarkers)) {
      fail("F2_AUDIT_MARKER_EVIDENCE_MISMATCH");
    }
    const auditDone = [...auditText.matchAll(/^F2_DONE PASS source=[a-f0-9]{40} query=[a-f0-9]{64}$/gm)].map((match) => match[0]);
    if (auditDone.length !== 1 || auditDone[0] !== `F2_DONE PASS source=${pins.sourceSha} query=${pins.querySha}`) {
      fail("F2_AUDIT_DONE_MARKER_MISMATCH");
    }
    if (/\bF2_(?:FAIL|STOP)\b|\bERROR:\s+F2_STOP\b/.test(auditText)) {
      fail("F2_AUDIT_FAILURE_MARKER_PRESENT");
    }

    const checks = requiredCheckMarkers(parsed);
    const preamble = checkPreamble(parsed, expectedState);
    const sections = {};
    for (const sectionName of REQUIRED_CATALOG_SECTIONS) {
      const header = SECTION_HEADERS[sectionName];
      sections[sectionName] = sectionObjects(parsed, sectionName, header);
    }

    const limitForSection = {
      ROLE_MEMBERSHIP_INVENTORY: "ROLE_MEMBERSHIP_OUTPUT_LIMIT",
      SCHEMA_INVENTORY: "SCHEMA_OUTPUT_LIMIT",
      RELATION_INVENTORY: "RELATION_OUTPUT_LIMIT",
      STANDALONE_APPLICATION_TYPE_INVENTORY: "TYPE_OUTPUT_LIMIT",
      ROUTINE_INVENTORY: "ROUTINE_OUTPUT_LIMIT",
      EXTENSION_INVENTORY: "EXTENSION_OUTPUT_LIMIT",
      DEFAULT_ACL_INVENTORY: "DEFAULT_ACL_OUTPUT_LIMIT",
    };
    for (const [sectionName, checkName] of Object.entries(limitForSection)) {
      const checkValue = parseCountMarker(checks.byName.get(checkName), checkName, OUTPUT_LIMITS[checkName]);
      if (sections[sectionName].length !== checkValue) fail("F2_CATALOG_OUTPUT_COUNT_MISMATCH");
    }
    const diagnosticPairs = [
      ["SCHEMA_DIAGNOSTIC_COUNT", "non_system_schema_count", "SCHEMA_OUTPUT_LIMIT"],
      ["RELATION_DIAGNOSTIC_COUNT", "non_system_relation_count", "RELATION_OUTPUT_LIMIT"],
      ["TYPE_DIAGNOSTIC_COUNT", "non_system_type_object_count", "TYPE_OUTPUT_LIMIT"],
      ["ROUTINE_DIAGNOSTIC_COUNT", "non_system_routine_count", "ROUTINE_OUTPUT_LIMIT"],
    ];
    for (const [sectionName, fieldName, checkName] of diagnosticPairs) {
      const count = Number(sections[sectionName][0]?.[fieldName]);
      const checkCount = parseCountMarker(checks.byName.get(checkName), checkName, OUTPUT_LIMITS[checkName]);
      if (!Number.isSafeInteger(count) || count !== checkCount) fail("F2_CATALOG_DIAGNOSTIC_COUNT_MISMATCH");
    }

    const { actual, matchedFields, mismatchedFields } = expectedStateFailures(expectedState, checks, sections, preamble);
    return {
      status: mismatchedFields.length === 0 ? "MATCH" : "MISMATCH",
      failureCodes: mismatchedFields.map((field) =>
        `F2_EXPECTED_STATE_MISMATCH_${field.replace(/[A-Z]/g, (char) => `_${char}`).replace(/^_/, "").toUpperCase()}`,
      ),
      matchedFields,
      mismatchedFields,
      sourceSha: pins.sourceSha,
      querySha256: pins.querySha,
      evidenceSha256: pins.evidenceSha,
      auditSha256: sha256(auditBytes),
      expectedStateSha256: sha256(expectedStateBytes),
      evidenceBytes: evidenceBytes.length,
      auditBytes: auditBytes.length,
      expectedStateBytes: expectedStateBytes.length,
      evidenceFileName,
      auditFileName,
      expectedStateFileName,
      comparisonValues: actual,
    };
  } catch (error) {
    return makeFailureResult(error instanceof ReviewFailure ? error.code : "F2_EVIDENCE_REVIEW_INPUT_INVALID");
  }
}

function parseArguments(argv) {
  const values = new Map();
  let recordOwnerReview = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--record-owner-review") {
      if (recordOwnerReview) fail("F2_REVIEW_ARGUMENT_DUPLICATE");
      recordOwnerReview = true;
      continue;
    }
    if (!["--evidence", "--audit", "--expected-state"].includes(argument)) {
      fail("F2_REVIEW_ARGUMENT_INVALID");
    }
    if (values.has(argument) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      fail("F2_REVIEW_ARGUMENT_INVALID");
    }
    values.set(argument, argv[index + 1]);
    index += 1;
  }
  for (const required of ["--evidence", "--audit", "--expected-state"]) {
    if (!values.has(required)) fail("F2_REVIEW_ARGUMENT_REQUIRED");
  }
  return {
    evidencePath: resolve(values.get("--evidence")),
    auditPath: resolve(values.get("--audit")),
    expectedStatePath: resolve(values.get("--expected-state")),
    recordOwnerReview,
  };
}

function assertProtectedLocalFiles(paths, repoRoot) {
  if (process.platform !== "win32") fail("F2_OWNER_REVIEW_REQUIRES_WINDOWS_ACL");
  const checker = resolve(repoRoot, "scripts/check-wave13b2-secret-acl.ps1");
  for (const path of paths) {
    let result = "";
    try {
      result = execFileSync("pwsh", ["-NoProfile", "-File", checker, "-Path", path, "-RequireProtected"], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      fail("F2_OWNER_ACL_OR_REPARSE_CHECK_FAILED");
    }
    if (result !== "PASS") fail("F2_OWNER_ACL_OR_REPARSE_CHECK_FAILED");
  }
}

function assertAttemptDirectory(paths, sourceSha) {
  const evidenceDirectory = dirname(paths.evidencePath);
  if (dirname(paths.auditPath) !== evidenceDirectory || dirname(paths.expectedStatePath) !== evidenceDirectory) {
    fail("F2_REVIEW_INPUT_DIRECTORY_MISMATCH");
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) fail("F2_LOCALAPPDATA_UNAVAILABLE");
  const expectedDirectory = resolve(localAppData, "KarturtStageOperator", `f2-attempt-${sourceSha}`);
  if (evidenceDirectory.toLowerCase() !== expectedDirectory.toLowerCase()) {
    fail("F2_REVIEW_INPUT_DIRECTORY_MISMATCH");
  }
  return resolve(evidenceDirectory, `wave13b2-f2-query-attempt-${sourceSha}.local.txt`);
}

async function confirmOwnerReview(result) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail("F2_OWNER_REVIEW_INTERACTIVE_CONSOLE_REQUIRED");
  const source12 = result.sourceSha.slice(0, 12);
  const query12 = result.querySha256.slice(0, 12);
  const phrase = `REVIEW WAVE13B2 F2 ${source12} ${query12} ${result.status}`;
  process.stdout.write(`Offline comparison: ${result.status}\n`);
  process.stdout.write(`Review fields matched: ${result.matchedFields.join(",") || "none"}\n`);
  process.stdout.write(`Review fields mismatched: ${result.mismatchedFields.join(",") || "none"}\n`);
  process.stdout.write(`Evidence SHA-256: ${result.evidenceSha256}\n`);
  process.stdout.write("Inspect the full owner-only evidence file separately. This utility does not display catalog output.\n");
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let answer = "";
  try {
    answer = await readline.question(`Type exactly: ${phrase}\n> `);
  } finally {
    readline.close();
  }
  if (answer !== phrase) fail("F2_OWNER_REVIEW_CONFIRMATION_MISMATCH");
  return phrase;
}

function writeOwnerReviewReceipt({ result, phrase, receiptPath, repoRoot }) {
  const wrapper = resolve(repoRoot, "scripts/write-wave13b2-f2-owner-review.ps1");
  const receipt = {
    schemaVersion: 1,
    recordType: "INTERACTIVE_LOCAL_OWNER_CONFIRMATION_NOT_SIGNATURE",
    sourceSha: result.sourceSha,
    querySha256: result.querySha256,
    evidenceFile: result.evidenceFileName,
    evidenceSha256: result.evidenceSha256,
    evidenceBytes: result.evidenceBytes,
    auditFile: result.auditFileName,
    auditSha256: result.auditSha256,
    auditBytes: result.auditBytes,
    expectedStateFile: result.expectedStateFileName,
    expectedStateSha256: result.expectedStateSha256,
    expectedStateBytes: result.expectedStateBytes,
    comparisonStatus: result.status,
    matchedFields: result.matchedFields,
    mismatchedFields: result.mismatchedFields,
    reviewedAtUtc: new Date().toISOString(),
    confirmationPhrase: phrase,
  };
  const contentBase64 = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8").toString("base64");
  try {
    execFileSync("pwsh", [
      "-NoProfile",
      "-File",
      wrapper,
      "-Path",
      receiptPath,
      "-SourceSha",
      result.sourceSha,
      "-QuerySha256",
      result.querySha256,
      "-ContentBase64",
      contentBase64,
    ], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    fail("F2_OWNER_REVIEW_RECEIPT_CREATE_FAILED");
  }
}

export async function runWave13B2F2EvidenceReview(argv = process.argv.slice(2)) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let paths;
  try {
    paths = parseArguments(argv);
    assertProtectedLocalFiles([dirname(paths.evidencePath), paths.evidencePath, paths.auditPath, paths.expectedStatePath], repoRoot);
    const expectedStateBytes = readFileSync(paths.expectedStatePath);
    const expectedStateText = strictUtf8(expectedStateBytes, "F2_EXPECTED_STATE_UTF8_INVALID");
    const expectedState = JSON.parse(expectedStateText);
    if (!/^[a-f0-9]{40}$/.test(expectedState?.binding?.finalSourceSha ?? "")) {
      fail("F2_EXPECTED_STATE_INVALID");
    }
    const attemptMarkerPath = assertAttemptDirectory(paths, expectedState.binding.finalSourceSha);
    assertProtectedLocalFiles([dirname(paths.evidencePath), paths.evidencePath, paths.auditPath, paths.expectedStatePath, attemptMarkerPath], repoRoot);
    const evidenceBytes = readFileSync(paths.evidencePath);
    const auditBytes = readFileSync(paths.auditPath);
    const attemptMarkerBytes = readFileSync(attemptMarkerPath);
    const result = evaluateWave13B2F2Evidence({
      evidenceBytes,
      auditBytes,
      attemptMarkerBytes,
      expectedStateBytes,
      evidenceFileName: basename(paths.evidencePath),
      auditFileName: basename(paths.auditPath),
      attemptMarkerFileName: basename(attemptMarkerPath),
      expectedStateFileName: basename(paths.expectedStatePath),
    });
    if (result.status === "FAILED") {
      process.stdout.write(`Offline comparison: FAILED ${result.failureCodes.join(",")}\n`);
      return 2;
    }

    assertAttemptDirectory(paths, result.sourceSha);
    assertProtectedLocalFiles([dirname(paths.evidencePath), paths.evidencePath, paths.auditPath, attemptMarkerPath, paths.expectedStatePath], repoRoot);

    process.stdout.write(`Offline comparison: ${result.status}\n`);
    process.stdout.write(`Matched fields: ${result.matchedFields.join(",") || "none"}\n`);
    process.stdout.write(`Mismatched fields: ${result.mismatchedFields.join(",") || "none"}\n`);
    process.stdout.write(`Evidence SHA-256: ${result.evidenceSha256}\n`);
    process.stdout.write(`Audit SHA-256: ${result.auditSha256}\n`);
    if (!paths.recordOwnerReview) return result.status === "MATCH" ? 0 : 2;

    const phrase = await confirmOwnerReview(result);
    const receiptPath = resolve(
      dirname(paths.evidencePath),
      `wave13b2-f2-owner-review-${result.sourceSha}-${result.querySha256}.local.json`,
    );
    writeOwnerReviewReceipt({ result, phrase, receiptPath, repoRoot });
    assertProtectedLocalFiles([receiptPath], repoRoot);
    process.stdout.write(`Owner review receipt: created sha256=${sha256(readFileSync(receiptPath))}\n`);
    return result.status === "MATCH" ? 0 : 2;
  } catch (error) {
    const code = error instanceof ReviewFailure ? error.code : "F2_EVIDENCE_REVIEW_INPUT_INVALID";
    process.stdout.write(`Offline comparison: FAILED ${code}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runWave13B2F2EvidenceReview().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
