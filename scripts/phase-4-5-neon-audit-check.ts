import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { requireDatabaseEnvironment } from "../src/lib/env";

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "UNKNOWN";
}

async function expectSqlState(
  client: PoolClient,
  name: string,
  operation: () => Promise<unknown>,
  expectedState: string,
) {
  await client.query("SAVEPOINT audit_probe_guard");
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT audit_probe_guard");
  await client.query("RELEASE SAVEPOINT audit_probe_guard");
  const state = failure ? errorCode(failure) : "SUCCEEDED";
  if (state !== expectedState) {
    throw new Error(`${name} expected SQLSTATE ${expectedState} but received ${state}.`);
  }
  return state;
}

async function main() {
  loadEnvConfig(process.cwd());
  const environment = requireDatabaseEnvironment();
  const expectedProjectId = process.env.KARTURT_NEON_DEV_PROJECT_ID;
  const expectedBranchId = process.env.KARTURT_NEON_DEV_BRANCH_ID;
  const expectedEndpointId = process.env.KARTURT_NEON_DEV_ENDPOINT_ID;
  if (environment.appEnv !== "development" || environment.databaseEnv !== "development") {
    throw new Error("Neon audit checks require APP_ENV and DATABASE_ENV to both be development.");
  }
  if (!expectedProjectId || !/^[a-z0-9-]+$/.test(expectedProjectId)) {
    throw new Error("Set the verified Neon development project ID before running this check.");
  }
  if (!expectedBranchId?.startsWith("br-") || !expectedEndpointId?.startsWith("ep-")) {
    throw new Error("Set the verified Neon development branch and endpoint IDs before running this check.");
  }

  const databaseUrl = new URL(environment.databaseUrl);
  const hostnameEndpointId = databaseUrl.hostname.split(".")[0];
  if (hostnameEndpointId !== expectedEndpointId || hostnameEndpointId.endsWith("-pooler")) {
    throw new Error("DATABASE_URL does not match the verified direct Neon development endpoint.");
  }

  const pool = new Pool({ connectionString: environment.databaseUrl, max: 2, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  const probeId = randomUUID();
  const invalidActorId = randomUUID();
  const actions = {
    auditInsertFailure: `phase4_5_probe.audit_insert_failure.${probeId}`,
    domainFailure: `phase4_5_probe.domain_failure.${probeId}`,
    forcedRollback: `phase4_5_probe.forced_rollback.${probeId}`,
  };
  let transactionStarted = false;

  try {
    const identity = await client.query<{ database_name: string; role_name: string }>(
      "SELECT current_database() AS database_name, current_user AS role_name",
    );
    if (identity.rows[0]?.database_name !== "neondb") {
      throw new Error("Neon audit checks require the verified neondb database.");
    }

    const actor = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM public.app_accounts ORDER BY created_at LIMIT 1",
    );
    const actorAppAccountId = actor.rows[0]?.id;
    if (!actorAppAccountId) throw new Error("Neon development has no app account to use for a rolled-back probe.");

    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      `INSERT INTO public.audit_events (id, actor_app_account_id, action, entity_type, entity_id, reason, context)
       VALUES ($1, $2, $3, 'phase4_5_probe', $4, 'append-only probe; rolled back', '{}'::jsonb)`,
      [probeId, actorAppAccountId, `phase4_5_probe.append_only.${probeId}`, probeId],
    );

    const rejected = {
      update: await expectSqlState(
        client,
        "UPDATE audit_events",
        () => client.query("UPDATE public.audit_events SET reason = 'tampered' WHERE id = $1", [probeId]),
        "55000",
      ),
      delete: await expectSqlState(
        client,
        "DELETE audit_events",
        () => client.query("DELETE FROM public.audit_events WHERE id = $1", [probeId]),
        "55000",
      ),
      truncate: await expectSqlState(
        client,
        "TRUNCATE audit_events",
        () => client.query("TRUNCATE public.audit_events"),
        "55000",
      ),
    };

    await client.query("CREATE TEMP TABLE audit_atomicity_probe (id integer PRIMARY KEY, value integer NOT NULL CHECK (value >= 0))");
    await client.query("INSERT INTO audit_atomicity_probe (id, value) VALUES (1, 1)");

    const auditInsertFailure = await expectSqlState(
      client,
      "audit insert with invalid actor",
      async () => {
        await client.query("UPDATE audit_atomicity_probe SET value = 2 WHERE id = 1");
        await client.query(
          `INSERT INTO public.audit_events (actor_app_account_id, action, entity_type, entity_id, context)
           VALUES ($1, $2, 'phase4_5_probe', $3, '{}'::jsonb)`,
          [invalidActorId, actions.auditInsertFailure, randomUUID()],
        );
      },
      "23503",
    );
    const afterInsertFailure = await client.query<{ value: number }>(
      "SELECT value FROM audit_atomicity_probe WHERE id = 1",
    );
    const failedAuditCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.audit_events WHERE action = $1",
      [actions.auditInsertFailure],
    );
    if (afterInsertFailure.rows[0]?.value !== 1 || failedAuditCount.rows[0]?.count !== "0") {
      throw new Error("An audit insert failure left part of the domain mutation behind.");
    }

    const domainFailure = await expectSqlState(
      client,
      "domain constraint after audit insert",
      async () => {
        await client.query(
          `INSERT INTO public.audit_events (actor_app_account_id, action, entity_type, entity_id, context)
           VALUES ($1, $2, 'phase4_5_probe', $3, '{}'::jsonb)`,
          [actorAppAccountId, actions.domainFailure, randomUUID()],
        );
        await client.query("UPDATE audit_atomicity_probe SET value = -1 WHERE id = 1");
      },
      "23514",
    );
    const failedDomainAuditCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.audit_events WHERE action = $1",
      [actions.domainFailure],
    );
    if (failedDomainAuditCount.rows[0]?.count !== "0") {
      throw new Error("A failed domain mutation left a success audit event behind.");
    }

    await client.query("SAVEPOINT forced_domain_and_audit_rollback");
    await client.query("UPDATE audit_atomicity_probe SET value = 3 WHERE id = 1");
    await client.query(
      `INSERT INTO public.audit_events (actor_app_account_id, action, entity_type, entity_id, context)
       VALUES ($1, $2, 'phase4_5_probe', $3, '{}'::jsonb)`,
      [actorAppAccountId, actions.forcedRollback, randomUUID()],
    );
    await client.query("ROLLBACK TO SAVEPOINT forced_domain_and_audit_rollback");
    await client.query("RELEASE SAVEPOINT forced_domain_and_audit_rollback");
    const afterForcedRollback = await client.query<{ value: number }>(
      "SELECT value FROM audit_atomicity_probe WHERE id = 1",
    );
    const rolledBackAuditCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.audit_events WHERE action = $1",
      [actions.forcedRollback],
    );
    if (afterForcedRollback.rows[0]?.value !== 1 || rolledBackAuditCount.rows[0]?.count !== "0") {
      throw new Error("A forced rollback did not remove both the domain write and the success audit.");
    }

    const probeStillPresent = await client.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM public.audit_events WHERE id = $1) AS present",
      [probeId],
    );
    if (!probeStillPresent.rows[0]?.present) throw new Error("Append-only probes changed unexpectedly before rollback.");

    await client.query("ROLLBACK");
    transactionStarted = false;

    const residue = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.audit_events
       WHERE id = $1 OR action = ANY($2::text[])`,
      [probeId, [actions.auditInsertFailure, actions.domainFailure, actions.forcedRollback]],
    );
    if (residue.rows[0]?.count !== "0") throw new Error("The Neon development check left an audit probe row behind.");

    console.info(JSON.stringify({
      event: "phase_4_5.neon_audit_check",
      environment: "development",
      projectId: expectedProjectId,
      branchId: expectedBranchId,
      endpointId: expectedEndpointId,
      database: identity.rows[0].database_name,
      databaseRole: identity.rows[0].role_name,
      appendOnlySqlStates: rejected,
      auditInsertFailureSqlState: auditInsertFailure,
      domainFailureSqlState: domainFailure,
      forcedRollback: "domain and audit event both absent after rollback",
      probeResidue: "none",
    }));
  } finally {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected database check failure.";
  console.error(`Neon development audit check failed: ${message}`);
  process.exitCode = 1;
});
