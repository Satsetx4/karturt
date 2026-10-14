import type { DisposablePostgresTarget } from "./disposable-postgres-identity";

export const PG18_REHEARSAL_BRANCH = "codex/wave12-3-pg18-rehearsal-20261014";
export const PG18_REHEARSAL_REPOSITORY = "Satsetx4/karturt";

const knownCatalogObjects = {
  constraints: [
    "households_rt_house_fk",
    "payment_allocations_active_owner_scope_uq",
    "waiver_actions_actor_scope_fk",
    "due_adjustments_due_scope_fk",
  ],
  enums: ["account_type", "monthly_due_status", "payment_request_status"],
  functions: [
    "assert_waiver_due_phase10_v1",
    "due_effective_target_phase11_v1",
    "guard_phase12_household_period_v1",
  ],
  indexes: [
    "active_due_settlements_due_idx",
    "due_adjustments_rt_actor_idempotency_uq",
    "households_rt_house_period_idx",
  ],
  triggers: [
    "active_due_settlements_reject_update_v1",
    "households_guard_phase12_period_v1",
    "monthly_dues_guard_waiver_transition_phase10_v1",
  ],
} as const;

const expectedTags = [
  "0000_messy_menace",
  "0001_classy_ricochet",
  "0002_monthly_due_period_guard",
  "0003_due_auth_audit_domain",
  "0004_phase_5_payment_request",
  "0005_phase_5_1_payment_request_items_immutable",
  "0006_phase_6_treasurer_payment_ledger",
  "0007_phase_7_reject_cancel",
  "0008_phase_7_1_post_resolution_lifecycle",
  "0009_phase_8_cash_payment",
  "0010_phase_9_payment_reversal",
  "0011_phase_10_waiver",
  "0012_phase_11_tariff_adjustment",
  "0013_phase_12_household_management",
] as const;

export type RehearsalEnvironment = NodeJS.ProcessEnv;

export type InitialDatabaseSnapshot = {
  currentDatabase: string;
  currentUser: string;
  identityMarker: string | null;
  serverVersionNum: number;
  userSchemaCount: number;
  userRelationCount: number;
};

export type MigrationLedgerExpectation = {
  hash: string;
  createdAt: string;
};

export type MigrationLedgerRow = {
  hash: string;
  created_at: string;
};

export type PostMigrationCatalog = {
  publicTableCount: number;
  constraintCount: number;
  indexCount: number;
  triggerCount: number;
  functionCount: number;
  enumCount: number;
  constraints: string[];
  indexes: string[];
  triggers: string[];
  functions: string[];
  enums: string[];
};

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validatePg18RehearsalEnvironment(env: RehearsalEnvironment): string {
  requireCondition(env.GITHUB_ACTIONS === "true", "PG18 rehearsal requires the isolated GitHub Actions service job.");
  requireCondition(env.GITHUB_REPOSITORY === PG18_REHEARSAL_REPOSITORY, "PG18 rehearsal repository identity is not allowed.");
  requireCondition(env.GITHUB_EVENT_NAME === "push", "PG18 rehearsal accepts only the exact branch push event.");
  requireCondition(
    env.GITHUB_REF === `refs/heads/${PG18_REHEARSAL_BRANCH}`,
    "PG18 rehearsal branch identity is not allowed.",
  );
  requireCondition(Boolean(env.GITHUB_RUN_ID && env.GITHUB_RUN_ATTEMPT), "PG18 rehearsal run identity is missing.");
  requireCondition(env.APP_ENV === "test" && env.DATABASE_ENV === "test", "PG18 rehearsal requires test-only application and database modes.");
  requireCondition(
    Boolean(env.PG18_SERVICE_ID && /^[a-f0-9]{64}$/.test(env.PG18_SERVICE_ID)),
    "The PostgreSQL 18 service container identity is missing or invalid.",
  );
  for (const forbiddenName of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DIRECT_URL", "POSTGRES_URL"]) {
    requireCondition(!env[forbiddenName], "PG18 rehearsal rejects general application database connection variables.");
  }
  requireCondition(Boolean(env.LAUNCH_SAFETY_POSTGRES_URL), "PG18 rehearsal requires its run-scoped disposable service URL.");
  return `${env.GITHUB_RUN_ID}_${env.GITHUB_RUN_ATTEMPT}`;
}

export function assertInitialDatabaseSnapshot(
  target: Pick<DisposablePostgresTarget, "databaseName" | "username" | "identityMarker">,
  snapshot: InitialDatabaseSnapshot,
): void {
  requireCondition(snapshot.currentDatabase === target.databaseName, "PostgreSQL service database name does not match the run-scoped target.");
  requireCondition(snapshot.currentUser === target.username, "PostgreSQL service user does not match the run-scoped target.");
  requireCondition(snapshot.identityMarker === target.identityMarker, "PostgreSQL service identity marker did not match the current run.");
  requireCondition(snapshot.serverVersionNum >= 180000 && snapshot.serverVersionNum < 190000, "The disposable PostgreSQL server is not major version 18.");
  requireCondition(snapshot.userSchemaCount === 0, "The disposable PostgreSQL target contains a user-defined schema before migration.");
  requireCondition(snapshot.userRelationCount === 0, "The disposable PostgreSQL target is not empty before migration.");
}

export function assertMigrationLedger(
  actual: MigrationLedgerRow[],
  expected: MigrationLedgerExpectation[],
): void {
  requireCondition(expected.length === 14, "The checked-in migration expectation must contain exactly 14 entries.");
  requireCondition(actual.length === expected.length, "The Drizzle migration ledger does not contain exactly 14 expected entries.");
  for (let index = 0; index < expected.length; index += 1) {
    const actualRow = actual[index];
    const expectedRow = expected[index];
    requireCondition(
      actualRow?.hash === expectedRow?.hash && actualRow?.created_at === expectedRow?.createdAt,
      "The Drizzle migration ledger differs from the checked-in journal and SQL files.",
    );
  }
}

export function assertPostMigrationCatalog(catalog: PostMigrationCatalog): void {
  requireCondition(catalog.publicTableCount === 27, "The migrated public schema does not contain exactly 27 tables.");
  requireCondition(catalog.constraintCount > 0, "The migrated public schema has no constraints.");
  requireCondition(catalog.indexCount > 0, "The migrated public schema has no indexes.");
  requireCondition(catalog.triggerCount > 0, "The migrated public schema has no user triggers.");
  requireCondition(catalog.functionCount > 0, "The migrated public schema has no functions.");
  requireCondition(catalog.enumCount > 0, "The migrated public schema has no enum types.");

  for (const [kind, expectedNames] of Object.entries(knownCatalogObjects) as Array<[
    keyof typeof knownCatalogObjects,
    readonly string[],
  ]>) {
    const actualNames = new Set(catalog[kind]);
    for (const expectedName of expectedNames) {
      requireCondition(actualNames.has(expectedName), `The migrated public schema is missing an expected ${kind} object.`);
    }
  }
}

export function expectedPg18CatalogObjects() {
  return knownCatalogObjects;
}

export function expectedPg18MigrationTags() {
  return expectedTags;
}
