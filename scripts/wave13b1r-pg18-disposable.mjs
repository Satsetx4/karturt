import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const fixturePath = "tests/fixtures/wave13b1r-fixed-reference.md";
const expectedBlobSha1 = "e011f0e843d42d53c7c4c76ba479854644137fc9";
const expectedManifestSha256 = "ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0";
const targetRole = "karturt_staging_owner";
const databaseName = "karturt_staging";
const separator = "\u001f";

function assert(condition, message) {
  if (!condition) throw new ValidationFailure(message);
}

class ValidationFailure extends Error {}

function digest(algorithm, value) {
  return crypto.createHash(algorithm).update(value).digest("hex");
}

function gitFixtureBlobSha1() {
  const result = spawnSync("git", ["show", "HEAD:" + fixturePath], { maxBuffer: 4 * 1024 * 1024 });
  assert(result.status === 0 && result.stdout, "cannot read committed fixed-reference fixture");
  const content = result.stdout;
  return digest("sha1", Buffer.concat([Buffer.from("blob " + content.length + "\0"), content]));
}

function parseFrozenQueries() {
  const source = fs.readFileSync(fixturePath, "utf8").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const queries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^### (Q\d{2}) — /.exec(lines[i]);
    if (!heading) continue;
    assert(lines[i + 1] === "" && lines[i + 2] === "~~~sql", "unexpected SQL fixture format");
    const start = i + 3;
    let end = start;
    while (end < lines.length && lines[end] !== "~~~") end += 1;
    assert(end < lines.length, "unterminated SQL fixture block");
    queries.push({ id: heading[1], sql: lines.slice(start, end).join("\n") });
    i = end;
  }
  assert(queries.length === 26, "expected exactly 26 frozen SQL statements");

  const declared = new Map();
  for (const match of source.matchAll(/^\| (Q\d{2}) \| ([a-f0-9]{64}) \|$/gm)) {
    declared.set(match[1], match[2]);
  }
  assert(declared.size === queries.length, "declared fingerprint table does not contain 26 unique entries");

  const manifestLines = [];
  for (const query of queries) {
    const actual = digest("sha256", Buffer.from(query.sql, "utf8"));
    assert(declared.get(query.id) === actual, "frozen SQL fingerprint mismatch for " + query.id);
    manifestLines.push(query.id + ":" + actual);
  }
  const manifest = digest("sha256", Buffer.from(manifestLines.join("\n") + "\n", "utf8"));
  assert(manifest === expectedManifestSha256, "ordered manifest SHA-256 mismatch");
  assert(gitFixtureBlobSha1() === expectedBlobSha1, "fixed-reference Git blob SHA-1 mismatch");
  return queries;
}

function findPostgres18Container() {
  const result = spawnSync("docker", ["ps", "--filter", "ancestor=postgres:18", "--format", "{{.ID}}"], { encoding: "utf8" });
  assert(result.status === 0, "Docker service discovery failed");
  const ids = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(ids.length === 1, "expected exactly one running postgres:18 service container");
  return ids[0];
}

function psql(containerId, user, database, sql, singleTransaction = false) {
  const args = [
    "exec", "-i", containerId, "psql", "-X", "-qAt", "-F", separator,
    "--set=ON_ERROR_STOP=on", "--set=ON_ERROR_ROLLBACK=off", "--set=VERBOSITY=verbose",
  ];
  if (singleTransaction) args.push("--single-transaction");
  args.push("--file=-", "-U", user, "-d", database);
  const result = spawnSync(
    "docker",
    args,
    { input: sql, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
  );
  assert(!result.error, "psql process could not complete");
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function executeSetup(containerId, database, sql, label) {
  const result = psql(containerId, "postgres", database, sql);
  assert(result.status === 0, "disposable setup failed: " + label + " (database output withheld)");
}

const columnCounts = new Map([
  ["Q01", 0], ["Q02", 1], ["Q03", 1], ["Q04", 3], ["Q05", 1], ["Q06", 1],
  ["Q07", 9], ["Q08", 6], ["Q09", 3], ["Q10", 3], ["Q11", 3], ["Q12", 4],
  ["Q13", 9], ["Q14", 5], ["Q15", 8], ["Q16", 6], ["Q17", 4], ["Q18", 4],
  ["Q19", 7], ["Q20", 8], ["Q21", 7], ["Q22", 8], ["Q23", 5], ["Q24", 4],
  ["Q25", 3], ["Q26", 4],
]);

function packetScript(queries) {
  const lines = ["\\set VERBOSITY verbose"];
  for (const query of queries) {
    lines.push("\\echo __" + query.id + "__");
    lines.push(query.sql);
  }
  return lines.join("\n") + "\n";
}

function runPacket(containerId, queries, label) {
  const result = psql(containerId, targetRole, databaseName, packetScript(queries), true);
  assert(result.status === 0, "fixed SQL packet failed: " + label + " (database output withheld)");
  const markers = Array.from(result.stdout.matchAll(/__(Q\d{2})__\r?\n/g));
  assert(markers.length === queries.length, "fixed SQL result marker count mismatch: " + label);
  const rowsById = new Map();
  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    assert(marker[1] === queries[i].id, "fixed SQL result order mismatch: " + label);
    const start = marker.index + marker[0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index : result.stdout.length;
    const rowLines = result.stdout.slice(start, end).split(/\r?\n/).filter((line) => line.length > 0);
    const rows = rowLines.map((line) => line.split(separator));
    const cap = queries[i].id === "Q25" ? 2 : 501;
    if (rows.length >= cap) {
      let counts = "returned_rows=" + rows.length;
      if (queries[i].id === "Q26") {
        const classes = ["database", "schema", "table", "column", "sequence", "routine", "type"];
        const classCounts = new Map(classes.map((name) => [name, 0]));
        let other = 0;
        for (const row of rows) {
          if (classCounts.has(row[0])) classCounts.set(row[0], classCounts.get(row[0]) + 1);
          else other += 1;
        }
        counts += "; class_counts=" + classes.map((name) => name + ":" + classCounts.get(name)).join(",") + ",other:" + other;
      }
      throw new ValidationFailure("result cap reached in " + queries[i].id + " during " + label + "; " + counts);
    }
    for (const row of rows) {
      assert(row.length === columnCounts.get(queries[i].id), "result column count mismatch in " + queries[i].id + " during " + label);
    }
    rowsById.set(queries[i].id, rows);
  }
  return rowsById;
}

function hasRow(rows, predicate) {
  return rows.some(predicate);
}

function validateCleanPacket(rows) {
  const versionNum = Number(rows.get("Q06")[0][0]);
  assert(rows.get("Q02")[0][0] === "1", "guard did not pass on the correct target");
  assert(rows.get("Q03")[0][0] === "on", "read-only transaction was not reported");
  assert(rows.get("Q04")[0].join(separator) === [databaseName, targetRole, targetRole].join(separator), "target identity result mismatch");
  assert(versionNum >= 180000 && versionNum <= 189999, "server version is outside PostgreSQL 18");
  assert(hasRow(rows.get("Q07"), (r) => r[0] === targetRole && r[1] === "f" && r[2] === "f" && r[5] === "t"), "target role attributes missing or unexpected");
  assert(rows.get("Q13").length === 0, "clean case unexpectedly contains user relations");
  assert(rows.get("Q25").length === 0, "clean case unexpectedly contains a migration ledger");
}

function validateSyntheticPacket(rows) {
  const memberships = rows.get("Q08");
  assert(hasRow(memberships, (r) => r[0] === "qa_parent" && r[1] === targetRole && r[2] === "postgres" && r[3] === "t" && r[4] === "f" && r[5] === "t"), "ADMIN/INHERIT/SET=false membership edge or grantor was not preserved");
  assert(hasRow(memberships, (r) => r[0] === "qa_reader" && r[1] === targetRole && r[2] === "postgres" && r[3] === "f" && r[4] === "t" && r[5] === "f"), "INHERIT=true/SET=false membership edge or grantor was not preserved");
  assert(hasRow(rows.get("Q10"), (r) => r[0] === databaseName && r[1] === "qa_owner" && r[2].includes("qa_reader=c*")), "database CONNECT grant-option ACL missing");
  assert(hasRow(rows.get("Q11"), (r) => r[0] === "app" && r[1] === "qa_owner" && r[2].includes("qa_reader=U")), "schema USAGE ACL missing");
  assert(hasRow(rows.get("Q13"), (r) => r[0] === "app" && r[1] === "records" && r[4] === "qa_owner" && r[5].includes("qa_reader=m*")), "table MAINTAIN grant-option ACL missing");
  assert(hasRow(rows.get("Q14"), (r) => r[0] === "app" && r[1] === "records" && r[2] === "id" && r[4].includes("qa_reader=r*")), "column SELECT grant-option evidence missing");
  assert(hasRow(rows.get("Q15"), (r) => r[0] === "app" && r[1] === "identity_fn" && r[4] === "qa_owner" && r[5].includes("qa_reader=X*")), "routine EXECUTE grant-option ACL missing");
  assert(hasRow(rows.get("Q16"), (r) => r[0] === "app" && r[1] === "status" && r[4] === "qa_owner" && r[5].includes("qa_reader=U*")), "type USAGE grant-option ACL missing");
  assert(hasRow(rows.get("Q17"), (r) => r[0] === "qa_owner" && r[1] === "app" && r[2] === "r" && r[3].includes("qa_reader")), "default ACL owner/schema evidence missing");
  const otherAcls = rows.get("Q18");
  for (const [objectClass, objectName] of [
    ["language", "plpgsql"],
    ["large_object", "900001"],
    ["tablespace", "pg_default"],
    ["configuration_parameter", "work_mem"],
  ]) {
    assert(hasRow(otherAcls, (r) => r[0] === objectClass && r[1] === objectName && r[3].includes("qa_reader=") && r[3].includes("*")), objectClass + " grant-option ACL missing");
  }
  assert(!hasRow(rows.get("Q19"), (r) => r[1] === "app" && r[2] === "records" && r[5] === "MAINTAIN"), "information-schema table view unexpectedly reported MAINTAIN instead of relying on raw ACL/effective checks");
  assert(hasRow(rows.get("Q20"), (r) => r[1] === "app" && r[2] === "records" && r[3] === "id" && r[5] === "qa_reader" && r[6] === "SELECT" && r[7] === "YES"), "information-schema column grant-option cross-check missing");
  assert(hasRow(rows.get("Q21"), (r) => r[1] === "app" && r[2] === "identity_fn" && r[4] === "qa_reader" && r[5] === "EXECUTE" && r[6] === "YES"), "information-schema routine grant-option cross-check missing");
  assert(hasRow(rows.get("Q22"), (r) => r[1] === "app" && r[2] === "records_seq" && r[3] === "SEQUENCE" && r[5] === "qa_reader" && r[6] === "USAGE" && r[7] === "YES"), "information-schema sequence usage grant-option cross-check missing");
  assert(hasRow(rows.get("Q22"), (r) => r[1] === "app" && r[2] === "status" && r[3] === "TYPE" && r[5] === "qa_reader" && r[6] === "USAGE" && r[7] === "YES"), "information-schema type usage grant-option cross-check missing");
  const privileges = rows.get("Q26");
  assert(hasRow(privileges, (r) => r[0] === "schema" && r[1] === "app" && r[2] === "USAGE" && r[3] === "t"), "inherited schema USAGE was not effective");
  assert(hasRow(privileges, (r) => r[0] === "schema" && r[1] === "app" && r[2] === "CREATE" && r[3] === "f"), "non-inherited schema CREATE became effective");
  assert(hasRow(privileges, (r) => r[0] === "table" && r[1] === "app.records" && r[2] === "MAINTAIN" && r[3] === "t"), "inherited MAINTAIN was not effective");
  assert(hasRow(privileges, (r) => r[0] === "column" && r[1] === "app.records.id" && r[2] === "SELECT" && r[3] === "t"), "inherited column SELECT was not effective");
  assert(hasRow(privileges, (r) => r[0] === "column" && r[1] === "app.records.secret" && r[2] === "UPDATE" && r[3] === "f"), "non-inherited column UPDATE became effective");
  assert(hasRow(privileges, (r) => r[0] === "sequence" && r[1] === "app.records_seq" && r[2] === "USAGE" && r[3] === "t"), "inherited sequence USAGE was not effective");
  assert(hasRow(privileges, (r) => r[0] === "routine" && r[1].startsWith("app.identity_fn#") && r[2] === "EXECUTE" && r[3] === "t"), "inherited routine EXECUTE was not effective");
  assert(hasRow(privileges, (r) => r[0] === "type" && r[1].startsWith("app.status#") && r[2] === "USAGE" && r[3] === "t"), "inherited type USAGE was not effective");
  assert(rows.get("Q25").length === 0, "synthetic grant case unexpectedly contains a migration ledger");
}

function validateExtensionOwnership(rows) {
  assert(hasRow(rows.get("Q12"), (r) => r[0] === "plpgsql" && r[3] === "postgres"), "default plpgsql extension ownership evidence missing");
}

function expectGuardFailure(containerId, user, database, sql, label) {
  const result = psql(containerId, user, database, sql, true);
  assert(result.status !== 0, "guard unexpectedly succeeded: " + label);
  assert(/22012/.test(result.stderr), "guard failure SQLSTATE was not division-by-zero for " + label);
  assert(!result.stdout.includes("__AFTER_GUARD__"), "client continued after the first guard error: " + label);
}

function validatePsqlRollback(containerId) {
  // TEST ONLY: this synthetic DML is intentionally outside the frozen read-only SQL packet.
  const probe = [
    "\\echo __ROLLBACK_INSERT__",
    "INSERT INTO public.__wave13b1r_rollback_probe (marker) VALUES (1);",
    "SELECT 1 / 0;",
    "\\echo __AFTER_ROLLBACK_ERROR__",
  ].join("\n") + "\n";
  const failed = psql(containerId, "postgres", databaseName, probe, true);
  assert(failed.status !== 0, "single-transaction rollback probe unexpectedly succeeded");
  assert(/22012/.test(failed.stderr), "rollback probe did not stop on the deliberate first SQL error");
  assert(failed.stdout.includes("__ROLLBACK_INSERT__"), "rollback probe did not reach its synthetic insert");
  assert(!failed.stdout.includes("__AFTER_ROLLBACK_ERROR__"), "psql continued after the deliberate first SQL error");

  // A separate psql invocation verifies that --single-transaction rolled the insert back.
  const check = psql(containerId, "postgres", databaseName,
    "SELECT count(*) FROM public.__wave13b1r_rollback_probe;\n");
  assert(check.status === 0 && check.stdout.trim() === "0", "single-transaction did not roll back the synthetic marker row");
}

function main() {
  const queries = parseFrozenQueries();
  const containerId = findPostgres18Container();
  executeSetup(containerId, "postgres", [
    "CREATE ROLE qa_owner NOLOGIN;",
    "CREATE ROLE " + targetRole + " LOGIN NOINHERIT;",
    "CREATE ROLE qa_wrong LOGIN NOINHERIT;",
    "CREATE DATABASE " + databaseName + " OWNER qa_owner;",
    "GRANT CONNECT ON DATABASE " + databaseName + " TO " + targetRole + ", qa_wrong;",
    "GRANT CONNECT ON DATABASE postgres TO " + targetRole + ", qa_wrong;",
  ].join("\n"), "initial roles and disposable database");

  const clean = runPacket(containerId, queries, "clean catalog");
  validateCleanPacket(clean);
  validateExtensionOwnership(clean);

  executeSetup(containerId, databaseName, [
    "CREATE ROLE qa_parent NOLOGIN;",
    "CREATE ROLE qa_reader NOLOGIN;",
    "GRANT qa_parent TO " + targetRole + " WITH ADMIN TRUE, INHERIT FALSE, SET TRUE;",
    "GRANT qa_reader TO " + targetRole + " WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;",
    "CREATE SCHEMA app AUTHORIZATION qa_owner;",
    "GRANT USAGE ON SCHEMA app TO qa_reader;",
    "GRANT CREATE ON SCHEMA app TO qa_parent;",
    "GRANT CREATE ON DATABASE " + databaseName + " TO qa_parent;",
    "ALTER DEFAULT PRIVILEGES FOR ROLE qa_owner IN SCHEMA app GRANT SELECT ON TABLES TO qa_reader;",
    "SET ROLE qa_owner;",
    "CREATE TABLE app.records (id integer PRIMARY KEY, secret text);",
    "CREATE TABLE app.default_acl_probe (id integer);",
    "CREATE SEQUENCE app.records_seq;",
    "CREATE TYPE app.status AS ENUM ('ready');",
    "CREATE FUNCTION app.identity_fn(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT $1';",
    "REVOKE EXECUTE ON FUNCTION app.identity_fn(integer) FROM PUBLIC;",
    "REVOKE USAGE ON TYPE app.status FROM PUBLIC;",
    "RESET ROLE;",
    "GRANT SELECT (id) ON app.records TO qa_reader WITH GRANT OPTION;",
    "GRANT UPDATE (secret) ON app.records TO qa_parent;",
    "GRANT MAINTAIN ON TABLE app.records TO qa_reader WITH GRANT OPTION;",
    "GRANT USAGE, SELECT, UPDATE ON SEQUENCE app.records_seq TO qa_reader WITH GRANT OPTION;",
    "GRANT EXECUTE ON FUNCTION app.identity_fn(integer) TO qa_reader WITH GRANT OPTION;",
    "GRANT USAGE ON TYPE app.status TO qa_reader WITH GRANT OPTION;",
    "GRANT CONNECT ON DATABASE " + databaseName + " TO qa_reader WITH GRANT OPTION;",
    "GRANT USAGE ON LANGUAGE plpgsql TO qa_reader WITH GRANT OPTION;",
    "GRANT CREATE ON TABLESPACE pg_default TO qa_reader WITH GRANT OPTION;",
    "GRANT SET ON PARAMETER work_mem TO qa_reader WITH GRANT OPTION;",
    "SELECT lo_create(900001);",
    "GRANT SELECT, UPDATE ON LARGE OBJECT 900001 TO qa_reader WITH GRANT OPTION;",
  ].join("\n"), "synthetic grants, objects, and membership options");

  const synthetic = runPacket(containerId, queries, "synthetic privilege matrix");
  validateSyntheticPacket(synthetic);

  expectGuardFailure(containerId, targetRole, "postgres", ["\\set VERBOSITY verbose", queries[0].sql, queries[1].sql, "\\echo __AFTER_GUARD__"].join("\n") + "\n", "wrong database");

  const wrongRoleGuard = ["\\set VERBOSITY verbose", queries[0].sql, queries[1].sql, "\\echo __AFTER_GUARD__"].join("\n") + "\n";
  expectGuardFailure(containerId, "qa_wrong", databaseName, wrongRoleGuard, "wrong role");

  const readWriteGuard = ["\\set VERBOSITY verbose", queries[1].sql, "\\echo __AFTER_GUARD__"].join("\n") + "\n";
  expectGuardFailure(containerId, targetRole, databaseName, readWriteGuard, "read-write transaction");

  executeSetup(containerId, databaseName,
    "CREATE TABLE public.__wave13b1r_rollback_probe (marker integer PRIMARY KEY);",
    "test-only rollback marker table");
  validatePsqlRollback(containerId);

  executeSetup(containerId, databaseName, [
    "CREATE SCHEMA unexpected_probe AUTHORIZATION qa_owner;",
    "CREATE TABLE unexpected_probe.notice (id integer);",
    "CREATE TABLE public.__drizzle_migrations (id integer);",
  ].join("\n"), "unexpected schema and ledger object");
  const unexpected = runPacket(containerId, queries, "unexpected catalog and ledger");
  assert(hasRow(unexpected.get("Q13"), (r) => r[0] === "unexpected_probe" && r[1] === "notice"), "unexpected user relation was not visible");
  assert(hasRow(unexpected.get("Q25"), (r) => r[0] === "public" && r[1] === "__drizzle_migrations"), "unexpected migration ledger object was not visible");

  const version = clean.get("Q05")[0][0];
  const versionNum = clean.get("Q06")[0][0];
  console.log("result=PASS");
  console.log("postgres_server_version=" + version);
  console.log("postgres_server_version_num=" + versionNum);
  console.log("fixed_reference_blob_sha1=" + expectedBlobSha1);
  console.log("ordered_manifest_sha256=" + expectedManifestSha256);
  console.log("statements=26");
}

try {
  main();
} catch (error) {
  const diagnostic = error instanceof ValidationFailure ? error.message : "unexpected validation error";
  console.error("result=FAIL; " + diagnostic + "; database output withheld");
  process.exitCode = 1;
}
