import { describe, expect, it } from "vitest";
import {
  assertInitialDatabaseSnapshot,
  assertMigrationLedger,
  assertPostMigrationCatalog,
  validatePg18RehearsalEnvironment,
} from "../../scripts/lib/pg18-migration-rehearsal";
import { disposablePostgresMarker, disposablePostgresNames } from "../../scripts/lib/disposable-postgres-identity";

const runId = "12345678_1";
const identityToken = "a".repeat(64);
const target = {
  ...disposablePostgresNames(runId),
  identityMarker: disposablePostgresMarker(runId, identityToken),
};

function validEnvironment(branchRef = "refs/heads/codex/wave12-3-pg18-rehearsal-20261014") {
  return {
    NODE_ENV: "test",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "Satsetx4/karturt",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: branchRef,
    GITHUB_RUN_ID: "12345678",
    GITHUB_RUN_ATTEMPT: "1",
    APP_ENV: "test",
    DATABASE_ENV: "test",
    PG18_SERVICE_ID: "b".repeat(64),
    LAUNCH_SAFETY_POSTGRES_URL: "present-only-for-test",
  } satisfies NodeJS.ProcessEnv;
}

describe("PostgreSQL 18 rehearsal safety assertions", () => {
  it.each([
    "refs/heads/codex/wave12-3-pg18-rehearsal-20261014",
    "refs/heads/verify/karturt-v1-rc-wave13b1s-20261015",
    "refs/heads/verify/karturt-v1-rc-quality-wave13b1t-20261015",
  ])("accepts the repository's exact branch push context: %s", (branchRef) => {
    expect(validatePg18RehearsalEnvironment(validEnvironment(branchRef))).toBe(runId);
  });

  it.each([
    ["missing GitHub run identity", (env: NodeJS.ProcessEnv) => { delete env.GITHUB_RUN_ID; }],
    ["wrong branch", (env: NodeJS.ProcessEnv) => { env.GITHUB_REF = "refs/heads/main"; }],
    ["unapproved sibling verify branch", (env: NodeJS.ProcessEnv) => { env.GITHUB_REF = "refs/heads/verify/karturt-v1-rc-other"; }],
    ["non-push event", (env: NodeJS.ProcessEnv) => { env.GITHUB_EVENT_NAME = "pull_request"; }],
    ["wrong repository", (env: NodeJS.ProcessEnv) => { env.GITHUB_REPOSITORY = "another/repository"; }],
    ["missing service container identity", (env: NodeJS.ProcessEnv) => { delete env.PG18_SERVICE_ID; }],
    ["invalid service container identity", (env: NodeJS.ProcessEnv) => { env.PG18_SERVICE_ID = "not-a-container-id"; }],
    ["general app database URL", (env: NodeJS.ProcessEnv) => { env.DATABASE_URL = "must-not-be-used"; }],
  ])("fails closed for %s", (_label, mutate) => {
    const env = validEnvironment();
    mutate(env);
    expect(() => validatePg18RehearsalEnvironment(env)).toThrow();
  });

  it("requires the exact run-owned target, marker, empty state, and PostgreSQL 18", () => {
    expect(() => assertInitialDatabaseSnapshot(target, {
      currentDatabase: target.databaseName,
      currentUser: target.username,
      identityMarker: target.identityMarker,
      serverVersionNum: 180006,
      userSchemaCount: 0,
      userRelationCount: 0,
    })).not.toThrow();
  });

  it.each([
    ["wrong database", { currentDatabase: "other_database" }],
    ["wrong user", { currentUser: "other_user" }],
    ["missing identity marker", { identityMarker: null }],
    ["wrong identity marker", { identityMarker: "another-run" }],
    ["wrong PostgreSQL major", { serverVersionNum: 170000 }],
    ["preexisting user schema", { userSchemaCount: 1 }],
    ["nonempty database", { userRelationCount: 1 }],
  ])("rejects %s before migration", (_label, change) => {
    expect(() => assertInitialDatabaseSnapshot(target, {
      currentDatabase: target.databaseName,
      currentUser: target.username,
      identityMarker: target.identityMarker,
      serverVersionNum: 180006,
      userSchemaCount: 0,
      userRelationCount: 0,
      ...change,
    })).toThrow();
  });

  it("requires the exact 14-row hash/timestamp ledger", () => {
    const expected = Array.from({ length: 14 }, (_, index) => ({ hash: `hash-${index}`, createdAt: String(index + 1) }));
    const actual = expected.map((row) => ({ hash: row.hash, created_at: row.createdAt }));
    expect(() => assertMigrationLedger(actual, expected)).not.toThrow();
    expect(() => assertMigrationLedger(actual.slice(1), expected)).toThrow();
    expect(() => assertMigrationLedger([{ ...actual[0]!, hash: "wrong" }, ...actual.slice(1)], expected)).toThrow();
    expect(() => assertMigrationLedger([...actual].reverse(), expected)).toThrow();
  });

  it("requires named cross-scope, period, ledger, and enum catalog objects", () => {
    const required = {
      publicTableCount: 27,
      constraintCount: 1,
      indexCount: 1,
      triggerCount: 1,
      functionCount: 1,
      enumCount: 1,
      constraints: ["households_rt_house_fk", "payment_allocations_active_owner_scope_uq", "waiver_actions_actor_scope_fk", "due_adjustments_due_scope_fk"],
      indexes: ["active_due_settlements_due_idx", "due_adjustments_rt_actor_idempotency_uq", "households_rt_house_period_idx"],
      triggers: ["active_due_settlements_reject_update_v1", "households_guard_phase12_period_v1", "monthly_dues_guard_waiver_transition_phase10_v1"],
      functions: ["assert_waiver_due_phase10_v1", "due_effective_target_phase11_v1", "guard_phase12_household_period_v1"],
      enums: ["account_type", "monthly_due_status", "payment_request_status"],
    };
    expect(() => assertPostMigrationCatalog(required)).not.toThrow();
    expect(() => assertPostMigrationCatalog({ ...required, publicTableCount: 26 })).toThrow();
    expect(() => assertPostMigrationCatalog({ ...required, triggers: [] })).toThrow();
  });
});
