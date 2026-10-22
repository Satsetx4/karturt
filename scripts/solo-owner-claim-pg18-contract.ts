import assert from "node:assert/strict";
import { Pool } from "pg";
import { ticketDigest } from "./lib/solo-owner-approval-ledger";

/** Only ephemeral CI PostgreSQL 18; NOT a Neon or production script. */
const pwd = "CI_SYNTHETIC_TICKET_TEST_ONLY_20261022";
const issuerPwd = "CI_SYNTHETIC_ISSUER_ONLY_20261022";
const database = "karturt_ticket_contract_ci";
function stop(code: string): never { throw new Error("PG18_CLAIM_STOP:" + code); }
function guard(): void {
  if (process.env.GITHUB_ACTIONS !== "true" ||
      process.env.SOLO_TICKET_CONTRACT_ONLY !== "1" ||
      process.env.APP_ENV !== "test" || process.env.DATABASE_ENV !== "test") {
    stop("CI_ISOLATION_GUARD");
  }
  const raw = process.env.SOLO_TICKET_CI_URL;
  if (!raw) stop("LOCAL_TEST_URL_MISSING");
  let uri: URL;
  try { uri = new URL(raw); } catch { return stop("LOCAL_TEST_URL_INVALID"); }
  if (uri.protocol !== "postgresql:" || uri.hostname !== "127.0.0.1" ||
      uri.port !== "5432" || uri.pathname !== "/" + database ||
      uri.username !== "postgres" || uri.password !== pwd ||
      uri.search || uri.hash) stop("NONLOCAL_OR_UNAUTHORIZED_DATABASE");
}

const reserveSql = [
  "INSERT INTO ticket_gate.used_tickets",
  "(digest, candidate_sha, run_id, approved_at, expires_at)",
  "SELECT $1::text, $2::text, $3::text, $4::timestamptz, $5::timestamptz",
  "WHERE clock_timestamp() >= $4::timestamptz",
  "AND clock_timestamp() < $5::timestamptz",
  "AND $5::timestamptz > $4::timestamptz",
  "AND $5::timestamptz <= $4::timestamptz + interval '15 minutes'",
  "ON CONFLICT (digest) DO NOTHING RETURNING digest",
].join(" ");
function windowNow() {
  const now = Date.now();
  return [new Date(now-120000).toISOString(), new Date(now+480000).toISOString()];
}
async function deny(pool: Pool, statement: string, label: string) {
  try { await pool.query(statement); }
  catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error &&
        error.code === "42501") return;
    return stop("UNEXPECTED_SQL_FAILURE_" + label);
  }
  stop("FORBIDDEN_WRITE_SUCCEEDED_" + label);
}
async function main() {
  guard();
  const owner = new Pool({
    host: "127.0.0.1", port: 5432, database, user: "postgres",
    password: pwd, max: 2, connectionTimeoutMillis: 5000,
    statement_timeout: 6000,
  });
  let issuer: Pool | undefined;
  try {
    const v = await owner.query<{ server_version_num: string }>("SHOW server_version_num");
    assert.equal(Math.floor(Number(v.rows[0]?.server_version_num) / 10000), 18,
      "Disposable contract requires exactly PostgreSQL 18");
    await owner.query("CREATE SCHEMA ticket_gate AUTHORIZATION postgres");
    await owner.query([
      "CREATE TABLE ticket_gate.used_tickets (",
      "digest text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),",
      "candidate_sha text NOT NULL CHECK (candidate_sha ~ '^[a-f0-9]{40}$'),",
      "run_id text NOT NULL CHECK (run_id ~ '^[0-9]{1,18}$'),",
      "approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,",
      "claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),",
      "CONSTRAINT valid_window CHECK (expires_at > approved_at AND",
      "expires_at <= approved_at + interval '15 minutes'))",
    ].join(" "));
    await owner.query(
      "CREATE ROLE ticket_ci_issuer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT " +
      "NOREPLICATION NOBYPASSRLS PASSWORD '" + issuerPwd + "'"
    );
    await owner.query("REVOKE ALL ON SCHEMA ticket_gate FROM PUBLIC");
    await owner.query("REVOKE ALL ON ticket_gate.used_tickets FROM PUBLIC");
    await owner.query("GRANT USAGE ON SCHEMA ticket_gate TO ticket_ci_issuer");
    await owner.query(
      "GRANT INSERT (digest,candidate_sha,run_id,approved_at,expires_at) " +
      "ON ticket_gate.used_tickets TO ticket_ci_issuer"
    );
    // Conflict target and RETURNING require SELECT(digest), not full SELECT.
    await owner.query("GRANT SELECT (digest) ON ticket_gate.used_tickets TO ticket_ci_issuer");
    const permissions = await owner.query<{ ins: boolean; upd: boolean; del: boolean; trunc: boolean; owner: boolean }>([
      "SELECT has_column_privilege('ticket_ci_issuer','ticket_gate.used_tickets','digest','INSERT') ins,",
      "has_table_privilege('ticket_ci_issuer','ticket_gate.used_tickets','UPDATE') upd,",
      "has_table_privilege('ticket_ci_issuer','ticket_gate.used_tickets','DELETE') del,",
      "has_table_privilege('ticket_ci_issuer','ticket_gate.used_tickets','TRUNCATE') trunc,",
      "pg_get_userbyid(c.relowner) = 'ticket_ci_issuer' owner",
      "FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid",
      "WHERE c.relname='used_tickets' AND n.nspname='ticket_gate'",
    ].join(" "));
    assert.deepEqual(permissions.rows[0], {
      ins: true, upd: false, del: false, trunc: false, owner: false,
    });
    issuer = new Pool({
      host: "127.0.0.1", port: 5432, database,
      user: "ticket_ci_issuer", password: issuerPwd, max: 18,
      connectionTimeoutMillis: 5000, statement_timeout: 6000,
    });
    const [approvedAt, expiresAt] = windowNow();
    const digest = ticketDigest("a".repeat(32));
    const args = [digest, "b".repeat(40), "39758903096", approvedAt, expiresAt];
    const claims = await Promise.all(Array.from({ length: 16 }, () => issuer!.query(reserveSql, args)));
    assert.equal(claims.filter(x => x.rowCount === 1).length, 1);
    assert.equal(claims.filter(x => x.rowCount === 0).length, 15);
    const oldTicketNewRun = await issuer.query(reserveSql,
      [digest, "c".repeat(40), "99999999", approvedAt, expiresAt]);
    assert.equal(oldTicketNewRun.rowCount, 0);
    const count = await owner.query<{ n: string }>(
      "SELECT count(*)::text n FROM ticket_gate.used_tickets"
    );
    assert.equal(count.rows[0]?.n, "1");
    await deny(issuer, "UPDATE ticket_gate.used_tickets SET run_id='123'", "UPDATE");
    await deny(issuer, "DELETE FROM ticket_gate.used_tickets", "DELETE");
    await deny(issuer, "TRUNCATE ticket_gate.used_tickets", "TRUNCATE");
    await deny(issuer, "SELECT run_id FROM ticket_gate.used_tickets", "READ_OTHER_COLUMNS");
    await deny(issuer, "CREATE TABLE ticket_gate.unapproved(id int)", "CREATE_TABLE");
    const expired = await issuer.query(reserveSql, [
      ticketDigest("d".repeat(32)), "b".repeat(40), "987654321",
      new Date(Date.now()-20*60000).toISOString(), new Date(Date.now()-10*60000).toISOString(),
    ]);
    assert.equal(expired.rowCount, 0);
    const future = await issuer.query(reserveSql, [
      ticketDigest("e".repeat(32)), "b".repeat(40), "987654322",
      new Date(Date.now()+10*60000).toISOString(), new Date(Date.now()+20*60000).toISOString(),
    ]);
    assert.equal(future.rowCount, 0);
    const longWindow = await issuer.query(reserveSql, [
      ticketDigest("f".repeat(32)), "b".repeat(40), "987654323",
      new Date(Date.now()-10*60000).toISOString(), new Date(Date.now()+20*60000).toISOString(),
    ]);
    assert.equal(longWindow.rowCount, 0);
    process.stdout.write(
      "PG18_DISPOSABLE_ATOMIC_CLAIM_PASS: contenders=16 winners=1 " +
      "replays_blocked=YES update_delete_denied=YES expiry_enforced=YES\n"
    );
    process.stdout.write("TRUSTED_CAPTURE_STOP: NO_PERSISTENT_STORE_OR_VERIFIED_WRITER\n");
  } finally {
    if (issuer) await issuer.end();
    await owner.end();
  }
}
main().catch(() => {
  // Never print connector/network error messages or potentially private URLs.
  process.stderr.write("PG18_DISPOSABLE_CLAIM_STOP: FAIL_CLOSED\n");
  process.exitCode = 1;
});
