import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { requireDatabaseEnvironment } from "../src/lib/env";

const expectedTarget = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  branchName: "karturt-development",
  endpointId: "ep-quiet-cake-azrhjiyh",
  database: "neondb",
  migrationCount: 14,
  migrationHeadHash: "994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85",
} as const;

const historyKinds = [
  "paymentRequests",
  "paymentRequestItems",
  "paymentRequestClaims",
  "payments",
  "paymentAllocations",
  "activeDueSettlements",
  "paymentReversals",
  "dueAdjustments",
  "waiverActions",
  "waiverItems",
] as const;

type HistoryKind = (typeof historyKinds)[number];
type OwnerRow = { key: string; rtUnitId: string; householdId: string };
type FinancialContentProof = { fingerprint: string; rowCount: number };
type DueSnapshot = {
  id: string;
  billingYear: number;
  month: number;
  amount: number;
  dueDate: string;
  status: string;
  feeRateId: string | null;
  waivedReason: string | null;
};
type AuditManifest = {
  outcome: unknown;
  migrationHead: unknown;
  source?: Record<string, unknown>;
  scenarios?: Record<string, unknown>;
  authorizationEvidence?: unknown;
  target: {
    projectId?: unknown;
    branchId?: unknown;
    database?: unknown;
    databaseName?: unknown;
    endpointId?: unknown;
  };
  postSmokeAudit: {
    qaSeedAttempts: Array<{ rtUnitId: string; state: "reused" | "leftover_partial" }>;
    replacement: {
      oldHouseholdId: string;
      newHouseholdId: string;
      oldPersonId: string;
      oldResidentAccountId: string;
      newResidentAccountId: string;
      oldEndsOn: string;
      newStartsOn: string;
      oldHouseholdDueRowsBefore: DueSnapshot[];
      futureUntouchedDueIds: string[];
      oldHistoryOwnerRows: Record<HistoryKind, OwnerRow[]>;
    };
    conflict: {
      householdId: string;
      personId: string;
      residentAccountId: string;
      dueId: string;
      before: {
        householdStatus: string;
        householdEndsOn: string | null;
        personIsActive: boolean;
        residentAccountStatus: string;
        due: Omit<DueSnapshot, "id">;
        interactionCounts: Record<HistoryKind, number>;
        ownershipRows: Record<HistoryKind, OwnerRow[]>;
        activeSessionCount: number;
        lifecycleAuditCount: number;
        financialContent: FinancialContentProof;
      };
    };
  };
};

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid audit manifest: ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid audit manifest: ${label}.`);
  return value;
}

function asUuid(value: unknown, label: string): string {
  const result = asString(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error(`Invalid audit manifest: ${label} must be a UUID.`);
  }
  return result;
}

function asDate(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  const result = asString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error(`Invalid audit manifest: ${label} must be an ISO date.`);
  }
  return result;
}

function asFiniteNumber(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid audit manifest: ${label} must be numeric.`);
  return result;
}

function rejectSensitiveKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectSensitiveKeys(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (/(pin|password|token|hash|secret|credential)/i.test(key)) {
      throw new Error("Audit manifest contains a prohibited authentication-sensitive field name.");
    }
    rejectSensitiveKeys(child);
  }
}

function readManifest(): AuditManifest {
  const evidenceRoot = resolve(process.cwd(), "docs/phase-12-1-acceptance-evidence");
  const requested = process.argv[2] ?? resolve(evidenceRoot, "household-smoke-manifest.json");
  const filename = resolve(requested);
  const rel = relative(evidenceRoot, filename);
  if (isAbsolute(rel) || rel.startsWith("..") || !filename.toLowerCase().endsWith(".json")) {
    throw new Error("Audit manifest must be a JSON file inside docs/phase-12-1-acceptance-evidence/.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filename, "utf8"));
  } catch {
    throw new Error("Audit manifest could not be read as valid JSON from the evidence directory.");
  }

  const root = asObject(parsed, "root");
  if (root.outcome !== "PASS") {
    throw new Error("Audit manifest must record a successful authenticated browser smoke outcome.");
  }
  if (root.migrationHead !== "0013_phase_12_household_management") {
    throw new Error("Audit manifest must target the frozen 0013 household-management migration head.");
  }
  const source = asObject(root.source, "source");
  if (
    source.branch !== "fix/phase-12-1-acceptance-closure" ||
    source.baseline !== "b933cc9a279d91191d6d7fa8c76f6202fbb68da5"
  ) {
    throw new Error("Audit manifest source branch or baseline does not match the frozen F12.1 contract.");
  }
  const sourceHead = asString(source.head, "source.head");
  if (!/^[0-9a-f]{40}$/i.test(sourceHead)) {
    throw new Error("Audit manifest source.head must be a 40-character Git SHA.");
  }
  const provenance = asObject(source.provenanceSha256, "source.provenanceSha256");
  const provenancePaths = [
    "scripts/phase-12-household-browser-smoke.ts",
    "src/components/chairman-household-management.tsx",
    "src/app/api/chairman/households/[householdId]/replace/route.ts",
    "src/app/api/chairman/households/[householdId]/deactivate/route.ts",
    "src/app/api/chairman/adjustments/route.ts",
  ];
  const provenanceKeys = Object.keys(provenance);
  if (
    provenanceKeys.length !== provenancePaths.length ||
    provenancePaths.some((path) => !/^[0-9a-f]{64}$/i.test(asString(provenance[path], `source.provenanceSha256.${path}`)))
  ) {
    throw new Error("Audit manifest must contain valid SHA-256 provenance hashes for every frozen smoke source file.");
  }

  const scenarios = asObject(root.scenarios, "scenarios");
  const mandatoryPassScenarios = [
    "chairmanLoginListSearch",
    "addResident",
    "editResidentAndDatabasePersistence",
    "pinResetAndOldSessionRevocation",
    "oldPinRejectedAndNewPinResidentLogin",
    "sameHouseReplacementAndDebtPreservation",
    "interactedDueConflictNoPartialMutation",
    "deactivationAndSessionRevocation",
    "treasurerManagementAndPinReset",
  ];
  for (const field of mandatoryPassScenarios) {
    const value = asString(scenarios[field], `scenarios.${field}`);
    if (!/^PASS(?:$|[;:]\s+\S)/.test(value)) {
      throw new Error(`Audit manifest scenario ${field} must have a PASS result.`);
    }
  }
  const crossRtScenario = asString(scenarios.crossRtChairman, "scenarios.crossRtChairman");
  const authorizationEvidence = asObject(root.authorizationEvidence, "authorizationEvidence");
  const crossRtEvidence = asObject(authorizationEvidence.crossRt, "authorizationEvidence.crossRt");
  if (/^PASS(?:$|[;:]\s+\S)/.test(crossRtScenario)) {
    const status = asFiniteNumber(crossRtEvidence.status, "authorizationEvidence.crossRt.status");
    if (
      ![403, 404].includes(status) ||
      crossRtEvidence.genericError !== true ||
      crossRtEvidence.noMutation !== true ||
      crossRtEvidence.internalLeak !== false
    ) {
      throw new Error("A PASS cross-RT scenario must include a generic denial, no mutation, and no internal leak.");
    }
  } else if (/^NOT_RUN:\s+\S/.test(crossRtScenario)) {
    const reason = asString(crossRtEvidence.reason, "authorizationEvidence.crossRt.reason");
    const reasonText = `${crossRtScenario} ${reason}`;
    if (
      crossRtEvidence.status !== "NOT_RUN" ||
      !/no active synthetic (?:foreign-rt )?household|no active synthetic household exists in the other qa rt/i.test(reasonText)
    ) {
      throw new Error("Cross-RT may be NOT_RUN only with evidence that no active synthetic foreign household fixture was available.");
    }
  } else {
    throw new Error("Cross-RT scenario must PASS or be NOT_RUN with an explicit no-fixture reason.");
  }

  const target = asObject(root.target, "target");
  const targetDb = target.database ?? target.databaseName;
  if (
    target.projectId !== expectedTarget.projectId ||
    target.branchId !== expectedTarget.branchId ||
    targetDb !== expectedTarget.database ||
    (target.branchName !== undefined && target.branchName !== expectedTarget.branchName) ||
    (target.endpointId !== undefined && target.endpointId !== expectedTarget.endpointId)
  ) {
    throw new Error("Audit manifest target does not match the frozen Neon development target.");
  }

  const audit = asObject(root.postSmokeAudit, "postSmokeAudit");
  rejectSensitiveKeys(audit);
  if (!Array.isArray(audit.qaSeedAttempts) || audit.qaSeedAttempts.length !== 2) {
    throw new Error("Audit manifest must inventory the two synthetic QA seed attempts.");
  }
  const seedStates = audit.qaSeedAttempts.map((value, index) => {
    const item = asObject(value, `postSmokeAudit.qaSeedAttempts[${index}]`);
    const state = asString(item.state, `postSmokeAudit.qaSeedAttempts[${index}].state`);
    if (state !== "reused" && state !== "leftover_partial") {
      throw new Error("Audit manifest contains an unsupported synthetic seed state.");
    }
    return state;
  });
  if (seedStates.filter((state) => state === "reused").length !== 1 || seedStates.filter((state) => state === "leftover_partial").length !== 1) {
    throw new Error("Audit manifest must mark one QA seed attempt as reused and one as leftover_partial.");
  }
  const replacement = asObject(audit.replacement, "postSmokeAudit.replacement");
  const conflict = asObject(audit.conflict, "postSmokeAudit.conflict");
  const replacementOldHistory = asObject(replacement.oldHistoryOwnerRows, "replacement.oldHistoryOwnerRows");
  const conflictBefore = asObject(conflict.before, "conflict.before");
  const conflictCounts = asObject(conflictBefore.interactionCounts, "conflict.before.interactionCounts");
  const conflictOwnership = asObject(conflictBefore.ownershipRows, "conflict.before.ownershipRows");
  if (!Array.isArray(replacement.oldHouseholdDueRowsBefore) || replacement.oldHouseholdDueRowsBefore.length < 2) {
    throw new Error("Audit manifest must contain the complete pre-replacement old-household due snapshot set.");
  }
  if (!Array.isArray(replacement.futureUntouchedDueIds) || replacement.futureUntouchedDueIds.length === 0) {
    throw new Error("Audit manifest must contain the complete future untouched due ID partition.");
  }
  const activeSessionCount = asFiniteNumber(conflictBefore.activeSessionCount, "conflict.before.activeSessionCount");
  const lifecycleAuditCount = asFiniteNumber(conflictBefore.lifecycleAuditCount, "conflict.before.lifecycleAuditCount");
  if (!Number.isInteger(activeSessionCount) || activeSessionCount < 0 || !Number.isInteger(lifecycleAuditCount) || lifecycleAuditCount < 0) {
    throw new Error("Audit manifest conflict session and lifecycle audit counts must be non-negative integers.");
  }
  const financialContent = asObject(conflictBefore.financialContent, "conflict.before.financialContent");
  const financialContentFingerprint = asString(financialContent.fingerprint, "conflict.before.financialContent.fingerprint");
  const financialContentRowCount = asFiniteNumber(financialContent.rowCount, "conflict.before.financialContent.rowCount");
  if (!/^[0-9a-f]{64}$/.test(financialContentFingerprint) || !Number.isInteger(financialContentRowCount) || financialContentRowCount <= 0) {
    throw new Error("Audit manifest must contain a non-empty conflict financial-content SHA-256 fingerprint and row count.");
  }

  for (const kind of historyKinds) {
    if (!Array.isArray(replacementOldHistory[kind])) {
      throw new Error(`Invalid audit manifest: replacement.oldHistoryOwnerRows.${kind} must be an array.`);
    }
    if (!Array.isArray(conflictOwnership[kind])) {
      throw new Error(`Invalid audit manifest: conflict.before.ownershipRows.${kind} must be an array.`);
    }
    if (conflictCounts[kind] === undefined || !Number.isFinite(Number(conflictCounts[kind]))) {
      throw new Error(`Invalid audit manifest: conflict.before.interactionCounts.${kind} must be numeric.`);
    }
  }

  return root as unknown as AuditManifest;
}

function validateOwnerRows(rows: OwnerRow[], label: string, expectedHouseholdId: string): OwnerRow[] {
  const normalized = rows.map((row, index) => {
    const item = asObject(row, `${label}[${index}]`);
    const key = asString(item.key, `${label}[${index}].key`);
    const rtUnitId = asUuid(item.rtUnitId, `${label}[${index}].rtUnitId`);
    const householdId = asUuid(item.householdId, `${label}[${index}].householdId`);
    if (householdId !== expectedHouseholdId) throw new Error(`Invalid audit manifest: ${label} contains a different household.`);
    return { key, rtUnitId, householdId };
  });
  return normalized.sort((a, b) => a.key.localeCompare(b.key));
}

function validateDueSnapshot(value: unknown, label: string, id?: string): DueSnapshot {
  const item = asObject(value, label);
  const dueId = id ?? asUuid(item.id, `${label}.id`);
  const feeRateId = item.feeRateId === null ? null : asUuid(item.feeRateId, `${label}.feeRateId`);
  const waivedReason = item.waivedReason === null ? null : asString(item.waivedReason, `${label}.waivedReason`);
  return {
    id: dueId,
    billingYear: asFiniteNumber(item.billingYear, `${label}.billingYear`),
    month: asFiniteNumber(item.month, `${label}.month`),
    amount: asFiniteNumber(item.amount, `${label}.amount`),
    dueDate: asDate(item.dueDate, `${label}.dueDate`)!,
    status: asString(item.status, `${label}.status`),
    feeRateId,
    waivedReason,
  };
}

async function count(client: PoolClient, sql: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(sql, values);
  const raw = result.rows[0]?.count;
  if (raw === undefined) throw new Error("Read-only audit query did not return an aggregate count.");
  return Number(raw);
}

const globalChecks: Array<{ name: string; sql: string }> = [
  {
    name: "overlapping_household_periods",
    sql: `SELECT count(*)::text AS count FROM (
      SELECT first_period.id
      FROM public.households first_period
      JOIN public.households second_period
        ON second_period.rt_unit_id = first_period.rt_unit_id
       AND second_period.house_id = first_period.house_id
       AND second_period.id > first_period.id
       AND first_period.starts_on <= coalesce(second_period.ends_on, 'infinity'::date)
       AND (first_period.ends_on IS NULL OR first_period.ends_on >= second_period.starts_on)
    ) overlaps`,
  },
  {
    name: "multiple_active_households_same_house",
    sql: `SELECT count(*)::text AS count FROM (
      SELECT rt_unit_id, house_id FROM public.households
      WHERE status = 'active' GROUP BY rt_unit_id, house_id HAVING count(*) > 1
    ) duplicate_active`,
  },
  {
    name: "multiple_current_residents_same_household",
    sql: `SELECT count(*)::text AS count FROM (
      SELECT rt_unit_id, household_id FROM public.app_accounts
      WHERE account_type = 'resident' AND status <> 'disabled'
      GROUP BY rt_unit_id, household_id HAVING count(*) > 1
    ) duplicate_residents`,
  },
  {
    name: "duplicate_current_resident_login_same_rt",
    sql: `SELECT count(*)::text AS count FROM (
      SELECT rt_unit_id, lower(login_identifier) FROM public.app_accounts
      WHERE account_type = 'resident' AND status <> 'disabled'
      GROUP BY rt_unit_id, lower(login_identifier) HAVING count(*) > 1
    ) duplicate_logins`,
  },
  {
    name: "ambiguous_current_resident_login_across_rt",
    sql: `SELECT count(*)::text AS count FROM (
      SELECT lower(login_identifier) FROM public.app_accounts
      WHERE account_type = 'resident' AND status <> 'disabled'
      GROUP BY lower(login_identifier) HAVING count(DISTINCT rt_unit_id) > 1
    ) ambiguous_logins`,
  },
  {
    name: "active_resident_linked_to_inactive_household",
    sql: `SELECT count(*)::text AS count FROM public.app_accounts account
      LEFT JOIN public.households household
        ON household.rt_unit_id = account.rt_unit_id AND household.id = account.household_id
      WHERE account.account_type = 'resident' AND account.status = 'active'
        AND (household.id IS NULL OR household.status <> 'active')`,
  },
  {
    name: "active_resident_linked_to_inactive_person",
    sql: `SELECT count(*)::text AS count FROM public.app_accounts account
      LEFT JOIN public.people person
        ON person.rt_unit_id = account.rt_unit_id AND person.id = account.person_id
      WHERE account.account_type = 'resident' AND account.status = 'active'
        AND (person.id IS NULL OR person.is_active = false)`,
  },
  {
    name: "disabled_resident_with_unexpired_session",
    sql: `SELECT count(DISTINCT account.id)::text AS count
      FROM public.app_accounts account
      JOIN public."session" session ON session."userId" = account.auth_user_id
      WHERE account.account_type = 'resident' AND account.status = 'disabled'
        AND session."expiresAt" > now()`,
  },
  {
    name: "financial_rows_with_household_scope_mismatch",
    sql: `SELECT count(*)::text AS count FROM (
      SELECT 1 FROM public.payment_requests request
      JOIN public.households household ON household.id = request.household_id
      WHERE request.rt_unit_id <> household.rt_unit_id
      UNION ALL
      SELECT 1 FROM public.payments payment
      JOIN public.payment_requests request ON request.id = payment.payment_request_id
      WHERE payment.rt_unit_id <> request.rt_unit_id OR payment.household_id <> request.household_id
      UNION ALL
      SELECT 1 FROM public.payment_request_items item
      JOIN public.payment_requests request ON request.id = item.request_id
      JOIN public.monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.rt_unit_id <> request.rt_unit_id OR item.household_id <> request.household_id
         OR item.rt_unit_id <> due.rt_unit_id OR item.household_id <> due.household_id
      UNION ALL
      SELECT 1 FROM public.payment_allocations allocation
      JOIN public.payments payment ON payment.id = allocation.payment_id
      JOIN public.monthly_dues due ON due.id = allocation.monthly_due_id
      WHERE allocation.rt_unit_id <> payment.rt_unit_id OR allocation.household_id <> payment.household_id
         OR allocation.rt_unit_id <> due.rt_unit_id OR allocation.household_id <> due.household_id
      UNION ALL
      SELECT 1 FROM public.active_due_settlements settlement
      JOIN public.monthly_dues due ON due.id = settlement.monthly_due_id
      JOIN public.payments payment ON payment.id = settlement.payment_id
      JOIN public.payment_allocations allocation ON allocation.id = settlement.allocation_id
      WHERE settlement.rt_unit_id <> due.rt_unit_id OR settlement.household_id <> due.household_id
         OR settlement.rt_unit_id <> payment.rt_unit_id OR settlement.household_id <> payment.household_id
         OR settlement.rt_unit_id <> allocation.rt_unit_id OR settlement.household_id <> allocation.household_id
         OR settlement.payment_id <> allocation.payment_id
         OR settlement.monthly_due_id <> allocation.monthly_due_id
         OR settlement.amount <> allocation.amount
      UNION ALL
      SELECT 1 FROM public.waiver_actions action
      JOIN public.households household ON household.id = action.household_id
      WHERE action.rt_unit_id <> household.rt_unit_id
      UNION ALL
      SELECT 1 FROM public.payment_reversals reversal
      JOIN public.payments payment ON payment.id = reversal.payment_id
      WHERE reversal.rt_unit_id <> payment.rt_unit_id OR reversal.household_id <> payment.household_id
      UNION ALL
      SELECT 1 FROM public.due_adjustments adjustment
      JOIN public.monthly_dues due ON due.id = adjustment.monthly_due_id
      WHERE adjustment.rt_unit_id <> due.rt_unit_id OR adjustment.household_id <> due.household_id
      UNION ALL
      SELECT 1 FROM public.waiver_items item
      JOIN public.waiver_actions action ON action.id = item.waiver_action_id
      JOIN public.monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.rt_unit_id <> action.rt_unit_id OR item.household_id <> action.household_id
         OR item.rt_unit_id <> due.rt_unit_id OR item.household_id <> due.household_id
    ) bad_scope`,
  },
  {
    name: "not_due_financial_activity",
    sql: `SELECT count(DISTINCT due.id)::text AS count
      FROM public.monthly_dues due
      WHERE due.status = 'not_due' AND (
        EXISTS (SELECT 1 FROM public.payment_allocations item WHERE item.monthly_due_id = due.id)
        OR EXISTS (SELECT 1 FROM public.payment_request_items item WHERE item.monthly_due_id = due.id)
        OR EXISTS (SELECT 1 FROM public.payment_request_claims item WHERE item.monthly_due_id = due.id)
        OR EXISTS (SELECT 1 FROM public.waiver_items item WHERE item.monthly_due_id = due.id)
        OR EXISTS (SELECT 1 FROM public.due_adjustments item WHERE item.monthly_due_id = due.id)
      )`,
  },
  {
    name: "post_end_interacted_due_rewritten_to_not_due",
    sql: `SELECT count(DISTINCT due.id)::text AS count
      FROM public.monthly_dues due
      JOIN public.households household
        ON household.rt_unit_id = due.rt_unit_id AND household.id = due.household_id
      JOIN public.billing_years year
        ON year.rt_unit_id = due.rt_unit_id AND year.id = due.billing_year_id
      WHERE household.ends_on IS NOT NULL AND due.status = 'not_due'
        AND year.year * 100 + due.month >
            extract(year FROM household.ends_on)::integer * 100 + extract(month FROM household.ends_on)::integer
        AND (
          EXISTS (SELECT 1 FROM public.payment_allocations item WHERE item.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.payment_request_items item WHERE item.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.payment_request_claims item WHERE item.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.waiver_items item WHERE item.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.due_adjustments item WHERE item.monthly_due_id = due.id)
        )`,
  },
];

async function inspectTarget(client: PoolClient) {
  const identity = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
  if (identity.rows[0]?.database_name !== expectedTarget.database) {
    throw new Error("The guarded Neon endpoint did not resolve to the expected development database.");
  }
  const migration = await client.query<{ entry_count: string; head_hash: string | null }>(`
    SELECT count(*)::text AS entry_count,
      (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS head_hash
    FROM drizzle.__drizzle_migrations
  `);
  const current = migration.rows[0];
  if (
    current?.entry_count !== String(expectedTarget.migrationCount) ||
    current.head_hash?.toLowerCase() !== expectedTarget.migrationHeadHash
  ) {
    throw new Error("Neon development migration journal is not the frozen F12 head (14 entries / expected 0013 hash).");
  }
  return { database: identity.rows[0].database_name, migrationEntries: Number(current.entry_count) };
}

function expectedOwnerRows(source: unknown, label: string, householdId: string): Record<HistoryKind, OwnerRow[]> {
  const object = asObject(source, label);
  return Object.fromEntries(historyKinds.map((kind) => [
    kind,
    validateOwnerRows(object[kind] as OwnerRow[], `${label}.${kind}`, householdId),
  ])) as Record<HistoryKind, OwnerRow[]>;
}

async function readOwnerRows(
  client: PoolClient,
  scope: { kind: "household"; rtUnitId: string; householdId: string } | { kind: "due"; dueId: string },
): Promise<Record<HistoryKind, OwnerRow[]>> {
  const v = scope.kind === "household" ? [scope.rtUnitId, scope.householdId] : [scope.dueId];
  const housePredicate = (alias: string) => scope.kind === "household"
    ? `${alias}.rt_unit_id = $1::uuid AND ${alias}.household_id = $2::uuid`
    : `${alias}.monthly_due_id = $1::uuid`;
  const queries: Record<HistoryKind, string> = {
    paymentRequests: scope.kind === "household"
      ? `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.payment_requests WHERE ${housePredicate("payment_requests")}`
      : `SELECT DISTINCT request.id::text AS key, request.rt_unit_id::text AS "rtUnitId", request.household_id::text AS "householdId"
         FROM public.payment_requests request JOIN public.payment_request_items item ON item.request_id = request.id
         WHERE item.monthly_due_id = $1::uuid`,
    paymentRequestItems: scope.kind === "household"
      ? `SELECT request_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.payment_request_items WHERE ${housePredicate("payment_request_items")}`
      : `SELECT request_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.payment_request_items WHERE monthly_due_id = $1::uuid`,
    paymentRequestClaims: scope.kind === "household"
      ? `SELECT claim.request_id::text || '/' || claim.monthly_due_id::text AS key, due.rt_unit_id::text AS "rtUnitId", due.household_id::text AS "householdId"
         FROM public.payment_request_claims claim JOIN public.monthly_dues due ON due.id = claim.monthly_due_id
         WHERE due.rt_unit_id = $1::uuid AND due.household_id = $2::uuid`
      : `SELECT claim.request_id::text || '/' || claim.monthly_due_id::text AS key, due.rt_unit_id::text AS "rtUnitId", due.household_id::text AS "householdId"
         FROM public.payment_request_claims claim JOIN public.monthly_dues due ON due.id = claim.monthly_due_id
         WHERE claim.monthly_due_id = $1::uuid`,
    payments: scope.kind === "household"
      ? `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.payments WHERE ${housePredicate("payments")}`
      : `SELECT DISTINCT payment.id::text AS key, payment.rt_unit_id::text AS "rtUnitId", payment.household_id::text AS "householdId"
         FROM public.payments payment JOIN public.payment_allocations allocation ON allocation.payment_id = payment.id
         WHERE allocation.monthly_due_id = $1::uuid`,
    paymentAllocations: scope.kind === "household"
      ? `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.payment_allocations WHERE ${housePredicate("payment_allocations")}`
      : `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.payment_allocations WHERE monthly_due_id = $1::uuid`,
    activeDueSettlements: scope.kind === "household"
      ? `SELECT allocation_id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.active_due_settlements WHERE ${housePredicate("active_due_settlements")}`
      : `SELECT allocation_id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.active_due_settlements WHERE monthly_due_id = $1::uuid`,
    paymentReversals: scope.kind === "household"
      ? `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.payment_reversals WHERE ${housePredicate("payment_reversals")}`
      : `SELECT DISTINCT reversal.id::text AS key, reversal.rt_unit_id::text AS "rtUnitId", reversal.household_id::text AS "householdId"
         FROM public.payment_reversals reversal JOIN public.payment_allocations allocation ON allocation.payment_id = reversal.payment_id
         WHERE allocation.monthly_due_id = $1::uuid`,
    dueAdjustments: scope.kind === "household"
      ? `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.due_adjustments WHERE ${housePredicate("due_adjustments")}`
      : `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.due_adjustments WHERE monthly_due_id = $1::uuid`,
    waiverActions: scope.kind === "household"
      ? `SELECT id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.waiver_actions WHERE ${housePredicate("waiver_actions")}`
      : `SELECT DISTINCT action.id::text AS key, action.rt_unit_id::text AS "rtUnitId", action.household_id::text AS "householdId"
         FROM public.waiver_actions action JOIN public.waiver_items item ON item.waiver_action_id = action.id
         WHERE item.monthly_due_id = $1::uuid`,
    waiverItems: scope.kind === "household"
      ? `SELECT waiver_action_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.waiver_items WHERE ${housePredicate("waiver_items")}`
      : `SELECT waiver_action_id::text || '/' || monthly_due_id::text AS key, rt_unit_id::text AS "rtUnitId", household_id::text AS "householdId"
         FROM public.waiver_items WHERE monthly_due_id = $1::uuid`,
  };

  const result = {} as Record<HistoryKind, OwnerRow[]>;
  for (const kind of historyKinds) {
    const rows = await client.query<OwnerRow>(queries[kind], v);
    result[kind] = rows.rows
      .map(({ key, rtUnitId, householdId }) => ({ key, rtUnitId, householdId }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
  return result;
}

async function readHouseholdRtUnitId(client: PoolClient, householdId: string): Promise<string> {
  const result = await client.query<{ rt_unit_id: string }>(
    "SELECT rt_unit_id::text AS rt_unit_id FROM public.households WHERE id = $1::uuid",
    [householdId],
  );
  const rtUnitId = result.rows[0]?.rt_unit_id;
  if (!rtUnitId) throw new Error("Expected smoke household fixture is absent from Neon development.");
  return rtUnitId;
}

function ownerMismatchCount(expected: Record<HistoryKind, OwnerRow[]>, actual: Record<HistoryKind, OwnerRow[]>): number {
  return historyKinds.reduce((total, kind) => total + Number(JSON.stringify(expected[kind]) !== JSON.stringify(actual[kind])), 0);
}

async function readDueSnapshots(client: PoolClient, dueIds: string[], householdId: string): Promise<DueSnapshot[]> {
  if (dueIds.length === 0) return [];
  const result = await client.query<{
    id: string; billing_year: number; month: number; amount: number; due_date: string; status: string;
    fee_rate_id: string | null; waived_reason: string | null;
  }>(`
    SELECT due.id::text AS id, year.year::integer AS billing_year, due.month::integer AS month,
      due.amount::integer AS amount, due.due_date::text AS due_date, due.status::text AS status,
      due.fee_rate_id::text AS fee_rate_id, due.waived_reason
    FROM public.monthly_dues due
    JOIN public.billing_years year ON year.rt_unit_id = due.rt_unit_id AND year.id = due.billing_year_id
    WHERE due.id = ANY($1::uuid[]) AND due.household_id = $2::uuid
    ORDER BY due.id`, [dueIds, householdId]);
  return result.rows.map((row) => ({
    id: row.id,
    billingYear: Number(row.billing_year),
    month: Number(row.month),
    amount: Number(row.amount),
    dueDate: row.due_date,
    status: row.status,
    feeRateId: row.fee_rate_id,
    waivedReason: row.waived_reason,
  }));
}

async function readHouseholdDueSnapshots(client: PoolClient, householdId: string): Promise<DueSnapshot[]> {
  const result = await client.query<{
    id: string; billing_year: number; month: number; amount: number; due_date: string; status: string;
    fee_rate_id: string | null; waived_reason: string | null;
  }>(`
    SELECT due.id::text AS id, year.year::integer AS billing_year, due.month::integer AS month,
      due.amount::integer AS amount, due.due_date::text AS due_date, due.status::text AS status,
      due.fee_rate_id::text AS fee_rate_id, due.waived_reason
    FROM public.monthly_dues due
    JOIN public.billing_years year ON year.rt_unit_id = due.rt_unit_id AND year.id = due.billing_year_id
    WHERE due.household_id = $1::uuid
    ORDER BY due.id`, [householdId]);
  return result.rows.map((row) => ({
    id: row.id,
    billingYear: Number(row.billing_year),
    month: Number(row.month),
    amount: Number(row.amount),
    dueDate: row.due_date,
    status: row.status,
    feeRateId: row.fee_rate_id,
    waivedReason: row.waived_reason,
  }));
}

type FinancialContentRow = { rowKey: string; content: Array<string | null> };
type FinancialContentSnapshot = { fingerprint: string; rowCount: number };

async function readFinancialContent(client: PoolClient, dueId: string): Promise<FinancialContentSnapshot> {
  const isoUtc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const row = (rowKey: string, fields: string[]) => `SELECT ${rowKey} AS "rowKey", ARRAY[${fields.join(", ")}]::text[] AS content`;
  const queries: Record<HistoryKind, string> = {
    paymentRequests: `${row("request.id::text", ["request.id::text", "request.rt_unit_id::text", "request.household_id::text", "request.status::text", "request.total_amount::text", "request.item_count::text", isoUtc("request.verified_at"), isoUtc("request.resolved_at"), isoUtc("request.created_at")])}
      FROM public.payment_requests request JOIN public.payment_request_items item ON item.request_id = request.id
      WHERE item.monthly_due_id = $1::uuid`,
    paymentRequestItems: `${row("item.request_id::text || '/' || item.monthly_due_id::text", ["item.request_id::text", "item.rt_unit_id::text", "item.household_id::text", "item.monthly_due_id::text", "item.period::text", "item.amount::text", isoUtc("item.created_at")])}
      FROM public.payment_request_items item WHERE item.monthly_due_id = $1::uuid`,
    paymentRequestClaims: `${row("claim.request_id::text || '/' || claim.monthly_due_id::text", ["claim.request_id::text", "claim.monthly_due_id::text", "due.rt_unit_id::text", "due.household_id::text", isoUtc("claim.claimed_at")])}
      FROM public.payment_request_claims claim JOIN public.monthly_dues due ON due.id = claim.monthly_due_id
      WHERE claim.monthly_due_id = $1::uuid`,
    payments: `${row("payment.id::text", ["payment.id::text", "payment.rt_unit_id::text", "payment.household_id::text", "payment.payment_request_id::text", "payment.amount::text", "payment.method::text", isoUtc("payment.verified_at"), isoUtc("payment.created_at")])}
      FROM public.payments payment JOIN public.payment_allocations allocation ON allocation.payment_id = payment.id
      WHERE allocation.monthly_due_id = $1::uuid`,
    paymentAllocations: `${row("allocation.id::text", ["allocation.id::text", "allocation.rt_unit_id::text", "allocation.household_id::text", "allocation.payment_request_id::text", "allocation.payment_id::text", "allocation.monthly_due_id::text", "allocation.amount::text", isoUtc("allocation.created_at")])}
      FROM public.payment_allocations allocation WHERE allocation.monthly_due_id = $1::uuid`,
    activeDueSettlements: `${row("settlement.allocation_id::text", ["settlement.allocation_id::text", "settlement.rt_unit_id::text", "settlement.household_id::text", "settlement.payment_id::text", "settlement.monthly_due_id::text", "settlement.amount::text", isoUtc("settlement.created_at")])}
      FROM public.active_due_settlements settlement WHERE settlement.monthly_due_id = $1::uuid`,
    paymentReversals: `${row("reversal.id::text", ["reversal.id::text", "reversal.rt_unit_id::text", "reversal.household_id::text", "reversal.payment_id::text", isoUtc("reversal.reversed_at")])}
      FROM public.payment_reversals reversal JOIN public.payment_allocations allocation ON allocation.payment_id = reversal.payment_id
      WHERE allocation.monthly_due_id = $1::uuid`,
    dueAdjustments: `${row("adjustment.id::text", ["adjustment.id::text", "adjustment.rt_unit_id::text", "adjustment.household_id::text", "adjustment.monthly_due_id::text", "adjustment.amount_delta::text", "adjustment.effective_target_after::text", "adjustment.reason::text", "adjustment.adjusted_by_account_id::text", "adjustment.adjusted_by_account_type::text", "adjustment.idempotency_key::text", "adjustment.request_fingerprint::text", isoUtc("adjustment.created_at")])}
      FROM public.due_adjustments adjustment WHERE adjustment.monthly_due_id = $1::uuid`,
    waiverActions: `${row("action.id::text", ["action.id::text", "action.rt_unit_id::text", "action.household_id::text", "action.item_count::text", "action.total_amount::text", isoUtc("action.created_at")])}
      FROM public.waiver_actions action JOIN public.waiver_items item ON item.waiver_action_id = action.id
      WHERE item.monthly_due_id = $1::uuid`,
    waiverItems: `${row("item.waiver_action_id::text || '/' || item.monthly_due_id::text", ["item.waiver_action_id::text", "item.rt_unit_id::text", "item.household_id::text", "item.monthly_due_id::text", "item.period::text", "item.amount::text", isoUtc("item.created_at")])}
      FROM public.waiver_items item WHERE item.monthly_due_id = $1::uuid`,
  };
  const grouped = {} as Record<HistoryKind, FinancialContentRow[]>;
  for (const kind of historyKinds) {
    const result = await client.query<FinancialContentRow>(queries[kind], [dueId]);
    grouped[kind] = result.rows.map((item) => ({
      rowKey: item.rowKey,
      content: item.content.map((value) => value === null ? null : String(value)),
    })).sort((a, b) => a.rowKey.localeCompare(b.rowKey));
  }
  const canonical = historyKinds.map((kind) => [kind, grouped[kind].map((item) => item.content)]);
  const rowCount = historyKinds.reduce((total, kind) => total + grouped[kind].length, 0);
  return { fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), rowCount };
}

async function readConflictResidentSessionCount(client: PoolClient, residentAccountId: string): Promise<number> {
  return count(client, `
    SELECT count(*)::text AS count
    FROM public.app_accounts account
    JOIN public."session" session ON session."userId" = account.auth_user_id
    WHERE account.id = $1::uuid AND account.account_type = 'resident'
      AND session."expiresAt" > now()
  `, [residentAccountId]);
}

async function readHouseholdLifecycleAuditCount(client: PoolClient, householdId: string): Promise<number> {
  return count(client, `
    SELECT count(*)::text AS count
    FROM public.audit_events
    WHERE entity_type = 'household' AND entity_id = $1::text
      AND action IN ('household.deactivated', 'household.resident_replaced')
  `, [householdId]);
}

async function readConflictState(client: PoolClient, fixture: AuditManifest["postSmokeAudit"]["conflict"]) {
  const result = await client.query<{
    household_status: string; household_ends_on: string | null; person_is_active: boolean; account_status: string;
  }>(`
    SELECT household.status::text AS household_status, household.ends_on::text AS household_ends_on,
      person.is_active AS person_is_active, account.status::text AS account_status
    FROM public.households household
    JOIN public.people person ON person.rt_unit_id = household.rt_unit_id AND person.id = $2::uuid
    JOIN public.app_accounts account ON account.rt_unit_id = household.rt_unit_id AND account.id = $3::uuid
    WHERE household.id = $1::uuid AND person.household_id = household.id
      AND account.household_id = household.id AND account.person_id = person.id
  `, [fixture.householdId, fixture.personId, fixture.residentAccountId]);
  const row = result.rows[0];
  const dueRows = await readDueSnapshots(client, [fixture.dueId], fixture.householdId);
  const ownershipRows = await readOwnerRows(client, { kind: "due", dueId: fixture.dueId });
  const interactionCounts = Object.fromEntries(historyKinds.map((kind) => [kind, ownershipRows[kind].length])) as Record<HistoryKind, number>;
  const activeSessionCount = await readConflictResidentSessionCount(client, fixture.residentAccountId);
  const lifecycleAuditCount = await readHouseholdLifecycleAuditCount(client, fixture.householdId);
  const financialContent = await readFinancialContent(client, fixture.dueId);
  return { row, dueRows, ownershipRows, interactionCounts, activeSessionCount, lifecycleAuditCount, financialContent };
}

async function main() {
  const manifest = readManifest();
  const replacement = manifest.postSmokeAudit.replacement;
  const conflict = manifest.postSmokeAudit.conflict;
  const oldHouseholdId = asUuid(replacement.oldHouseholdId, "replacement.oldHouseholdId");
  const newHouseholdId = asUuid(replacement.newHouseholdId, "replacement.newHouseholdId");
  const oldPersonId = asUuid(replacement.oldPersonId, "replacement.oldPersonId");
  const oldResidentAccountId = asUuid(replacement.oldResidentAccountId, "replacement.oldResidentAccountId");
  const newResidentAccountId = asUuid(replacement.newResidentAccountId, "replacement.newResidentAccountId");
  const oldEndsOn = asDate(replacement.oldEndsOn, "replacement.oldEndsOn")!;
  const newStartsOn = asDate(replacement.newStartsOn, "replacement.newStartsOn")!;
  const oldHouseholdDueSnapshots = replacement.oldHouseholdDueRowsBefore.map((row, index) =>
    validateDueSnapshot(row, `replacement.oldHouseholdDueRowsBefore[${index}]`));
  const futureUntouchedDueIds = replacement.futureUntouchedDueIds.map((id, index) =>
    asUuid(id, `replacement.futureUntouchedDueIds[${index}]`));
  const oldHistoryExpected = expectedOwnerRows(replacement.oldHistoryOwnerRows, "replacement.oldHistoryOwnerRows", oldHouseholdId);
  const baselineDueIds = new Set(oldHouseholdDueSnapshots.map((due) => due.id));
  const futureDueIds = new Set(futureUntouchedDueIds);
  const oldEndPeriod = Number(oldEndsOn.slice(0, 4)) * 100 + Number(oldEndsOn.slice(5, 7));
  if (
    baselineDueIds.size !== oldHouseholdDueSnapshots.length ||
    futureDueIds.size !== futureUntouchedDueIds.length ||
    futureUntouchedDueIds.some((id) => !baselineDueIds.has(id)) ||
    oldHouseholdDueSnapshots.some((due) => futureDueIds.has(due.id) && due.billingYear * 100 + due.month <= oldEndPeriod)
  ) {
    throw new Error("Audit manifest old-household dues do not form a complete, unique pre-replacement snapshot and future-due partition.");
  }
  const preservedDueSnapshots = oldHouseholdDueSnapshots.filter((due) => !futureDueIds.has(due.id));
  if (
    preservedDueSnapshots.length === 0 ||
    !oldHouseholdDueSnapshots.some((due) => due.billingYear * 100 + due.month <= oldEndPeriod && due.status === "unpaid" && due.amount > 0)
  ) {
    throw new Error("Audit manifest must prove preserved arrears and untouched future dues in the same old household.");
  }

  const conflictFixture = {
    householdId: asUuid(conflict.householdId, "conflict.householdId"),
    personId: asUuid(conflict.personId, "conflict.personId"),
    residentAccountId: asUuid(conflict.residentAccountId, "conflict.residentAccountId"),
    dueId: asUuid(conflict.dueId, "conflict.dueId"),
    before: conflict.before,
  };
  const conflictDueExpected = validateDueSnapshot(conflict.before.due, "conflict.before.due", conflictFixture.dueId);
  const conflictOwnershipExpected = expectedOwnerRows(conflict.before.ownershipRows, "conflict.before.ownershipRows", conflictFixture.householdId);
  const conflictActiveSessionCountExpected = asFiniteNumber(conflict.before.activeSessionCount, "conflict.before.activeSessionCount");
  const conflictLifecycleAuditCountExpected = asFiniteNumber(conflict.before.lifecycleAuditCount, "conflict.before.lifecycleAuditCount");
  const conflictFinancialContent = asObject(conflict.before.financialContent, "conflict.before.financialContent");
  const conflictFinancialFingerprintExpected = asString(conflictFinancialContent.fingerprint, "conflict.before.financialContent.fingerprint");
  const conflictFinancialRowCountExpected = asFiniteNumber(conflictFinancialContent.rowCount, "conflict.before.financialContent.rowCount");

  loadEnvConfig(process.cwd());
  const environment = requireDatabaseEnvironment();
  if (environment.appEnv !== "development" || environment.databaseEnv !== "development") {
    throw new Error("Lifecycle audit requires APP_ENV and DATABASE_ENV to both be development.");
  }
  if (
    process.env.KARTURT_NEON_DEV_PROJECT_ID !== expectedTarget.projectId ||
    process.env.KARTURT_NEON_DEV_BRANCH_ID !== expectedTarget.branchId ||
    process.env.KARTURT_NEON_DEV_ENDPOINT_ID !== expectedTarget.endpointId
  ) {
    throw new Error("Explicit Neon development project, branch, and endpoint IDs must match the frozen target.");
  }
  const databaseUrl = new URL(environment.databaseUrl);
  const hostname = databaseUrl.hostname.toLowerCase();
  const endpointId = hostname.split(".")[0];
  if (
    endpointId !== expectedTarget.endpointId ||
    !hostname.endsWith(".neon.tech") ||
    hostname.includes("pooler") ||
    databaseUrl.pathname !== `/${expectedTarget.database}`
  ) {
    throw new Error("DATABASE_URL must use the exact frozen direct development endpoint on .neon.tech and neondb database path.");
  }

  const pool = new Pool({ connectionString: environment.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '20s'");
    const target = await inspectTarget(client);

    const global = [];
    for (const check of globalChecks) global.push({ name: check.name, count: await count(client, check.sql) });

    const qaSeedAttemptInventory = [];
    for (const [index, rawAttempt] of manifest.postSmokeAudit.qaSeedAttempts.entries()) {
      const rtUnitId = asUuid(rawAttempt.rtUnitId, `postSmokeAudit.qaSeedAttempts[${index}].rtUnitId`);
      const result = await client.query<{
        houses: string; households: string; active_households: string; inactive_households: string;
        people: string; active_people: string; app_accounts: string; resident_accounts: string;
        fee_rates: string; monthly_dues: string; payment_requests: string; payment_request_items: string;
        payment_request_claims: string; payments: string; payment_allocations: string;
        active_due_settlements: string; payment_reversals: string; due_adjustments: string;
        waiver_actions: string; waiver_items: string;
      }>(`
        SELECT
          (SELECT count(*)::text FROM public.houses WHERE rt_unit_id = $1::uuid) AS houses,
          (SELECT count(*)::text FROM public.households WHERE rt_unit_id = $1::uuid) AS households,
          (SELECT count(*)::text FROM public.households WHERE rt_unit_id = $1::uuid AND status = 'active') AS active_households,
          (SELECT count(*)::text FROM public.households WHERE rt_unit_id = $1::uuid AND status = 'inactive') AS inactive_households,
          (SELECT count(*)::text FROM public.people WHERE rt_unit_id = $1::uuid) AS people,
          (SELECT count(*)::text FROM public.people WHERE rt_unit_id = $1::uuid AND is_active) AS active_people,
          (SELECT count(*)::text FROM public.app_accounts WHERE rt_unit_id = $1::uuid) AS app_accounts,
          (SELECT count(*)::text FROM public.app_accounts WHERE rt_unit_id = $1::uuid AND account_type = 'resident') AS resident_accounts,
          (SELECT count(*)::text FROM public.fee_rates WHERE rt_unit_id = $1::uuid) AS fee_rates,
          (SELECT count(*)::text FROM public.monthly_dues WHERE rt_unit_id = $1::uuid) AS monthly_dues,
          (SELECT count(*)::text FROM public.payment_requests WHERE rt_unit_id = $1::uuid) AS payment_requests,
          (SELECT count(*)::text FROM public.payment_request_items WHERE rt_unit_id = $1::uuid) AS payment_request_items,
          (SELECT count(*)::text FROM public.payment_request_claims claim JOIN public.monthly_dues due ON due.id = claim.monthly_due_id WHERE due.rt_unit_id = $1::uuid) AS payment_request_claims,
          (SELECT count(*)::text FROM public.payments WHERE rt_unit_id = $1::uuid) AS payments,
          (SELECT count(*)::text FROM public.payment_allocations WHERE rt_unit_id = $1::uuid) AS payment_allocations,
          (SELECT count(*)::text FROM public.active_due_settlements WHERE rt_unit_id = $1::uuid) AS active_due_settlements,
          (SELECT count(*)::text FROM public.payment_reversals WHERE rt_unit_id = $1::uuid) AS payment_reversals,
          (SELECT count(*)::text FROM public.due_adjustments WHERE rt_unit_id = $1::uuid) AS due_adjustments,
          (SELECT count(*)::text FROM public.waiver_actions WHERE rt_unit_id = $1::uuid) AS waiver_actions,
          (SELECT count(*)::text FROM public.waiver_items WHERE rt_unit_id = $1::uuid) AS waiver_items
      `, [rtUnitId]);
      const row = result.rows[0];
      if (!row) throw new Error("QA seed inventory query did not return its aggregate row.");
      qaSeedAttemptInventory.push({
        state: rawAttempt.state,
        counts: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])),
      });
    }

    const replacementPairRows = await count(client, `
      SELECT count(*)::text AS count
      FROM public.households old_household
      JOIN public.households new_household
        ON old_household.rt_unit_id = new_household.rt_unit_id
       AND old_household.house_id = new_household.house_id
      WHERE old_household.id = $1::uuid AND new_household.id = $2::uuid
    `, [oldHouseholdId, newHouseholdId]);
    const replacementOverlap = await count(client, `
      SELECT count(*)::text AS count
      FROM public.households old_household
      JOIN public.households new_household
        ON old_household.rt_unit_id = new_household.rt_unit_id
       AND old_household.house_id = new_household.house_id
      WHERE old_household.id = $1::uuid AND new_household.id = $2::uuid
        AND old_household.starts_on <= coalesce(new_household.ends_on, 'infinity'::date)
        AND (old_household.ends_on IS NULL OR old_household.ends_on >= new_household.starts_on)
    `, [oldHouseholdId, newHouseholdId]);
    const replacementState = await count(client, `
      SELECT count(*)::text AS count
      FROM public.households old_household
      JOIN public.households new_household
        ON old_household.rt_unit_id = new_household.rt_unit_id AND old_household.house_id = new_household.house_id
      JOIN public.people old_person
        ON old_person.rt_unit_id = old_household.rt_unit_id AND old_person.id = $3::uuid
       AND old_person.household_id = old_household.id
      JOIN public.app_accounts old_account
        ON old_account.rt_unit_id = old_household.rt_unit_id AND old_account.id = $4::uuid
       AND old_account.household_id = old_household.id AND old_account.person_id = old_person.id
      JOIN public.app_accounts new_account
        ON new_account.rt_unit_id = new_household.rt_unit_id AND new_account.id = $5::uuid
       AND new_account.household_id = new_household.id AND new_account.account_type = 'resident'
      WHERE old_household.id = $1::uuid AND new_household.id = $2::uuid
        AND old_household.status = 'inactive' AND old_household.ends_on = $6::date
        AND new_household.status = 'active' AND new_household.starts_on = $7::date
        AND old_person.is_active = false AND old_account.status = 'disabled' AND new_account.status = 'active'
    `, [oldHouseholdId, newHouseholdId, oldPersonId, oldResidentAccountId, newResidentAccountId, oldEndsOn, newStartsOn]);

    const oldHouseholdDueActual = await readHouseholdDueSnapshots(client, oldHouseholdId);
    const expectedOldHouseholdDueAfter = oldHouseholdDueSnapshots.map((due) => futureDueIds.has(due.id)
      ? { ...due, amount: 0, status: "not_due", feeRateId: null, waivedReason: null }
      : due).sort((a, b) => a.id.localeCompare(b.id));
    const oldHouseholdDueSnapshotMismatch = Number(JSON.stringify(oldHouseholdDueActual) !== JSON.stringify(expectedOldHouseholdDueAfter));
    const preservedDueActual = oldHouseholdDueActual.filter((due) => !futureDueIds.has(due.id));
    const preservedDueMismatch = Number(JSON.stringify(preservedDueActual) !== JSON.stringify(preservedDueSnapshots.sort((a, b) => a.id.localeCompare(b.id))));
    const futureDueInvalid = await count(client, `
      SELECT count(*)::text AS count
      FROM unnest($1::uuid[]) expected(id)
      LEFT JOIN public.monthly_dues due ON due.id = expected.id AND due.household_id = $2::uuid
      WHERE due.id IS NULL OR due.status <> 'not_due' OR due.amount <> 0
         OR due.fee_rate_id IS NOT NULL OR due.waived_reason IS NOT NULL
    `, [futureUntouchedDueIds, oldHouseholdId]);
    const oldHistoryActual = await readOwnerRows(client, {
      kind: "household", rtUnitId: await readHouseholdRtUnitId(client, oldHouseholdId), householdId: oldHouseholdId,
    });
    const oldHistoryMismatch = ownerMismatchCount(oldHistoryExpected, oldHistoryActual);
    const newHistoryActual = await readOwnerRows(client, {
      kind: "household", rtUnitId: await readHouseholdRtUnitId(client, newHouseholdId), householdId: newHouseholdId,
    });
    const newHouseholdHistoryRows = historyKinds.reduce((sum, kind) => sum + newHistoryActual[kind].length, 0);
    const newHouseholdPreStartDueCount = await count(client, `
      SELECT count(*)::text AS count
      FROM public.monthly_dues due
      JOIN public.households household
        ON household.rt_unit_id = due.rt_unit_id AND household.id = due.household_id
      WHERE household.id = $1::uuid AND due.due_date < household.starts_on
    `, [newHouseholdId]);
    const newHouseholdPreStartDueInvalid = await count(client, `
      SELECT count(*)::text AS count
      FROM public.monthly_dues due
      JOIN public.households household
        ON household.rt_unit_id = due.rt_unit_id AND household.id = due.household_id
      WHERE household.id = $1::uuid AND due.due_date < household.starts_on
        AND (due.status <> 'not_due' OR due.amount <> 0
          OR due.fee_rate_id IS NOT NULL OR due.waived_reason IS NOT NULL)
    `, [newHouseholdId]);

    const conflictBefore = asObject(conflict.before, "conflict.before");
    const conflictHouseholdStatus = asString(conflictBefore.householdStatus, "conflict.before.householdStatus");
    const conflictHouseholdEndsOn = asDate(conflictBefore.householdEndsOn, "conflict.before.householdEndsOn", true);
    const conflictPersonIsActive = conflictBefore.personIsActive;
    const conflictAccountStatus = asString(conflictBefore.residentAccountStatus, "conflict.before.residentAccountStatus");
    if (typeof conflictPersonIsActive !== "boolean") throw new Error("Invalid audit manifest: conflict.before.personIsActive must be boolean.");
    const conflictCurrent = await readConflictState(client, conflictFixture);
    const conflictStateMismatch = Number(
      !conflictCurrent.row ||
      conflictCurrent.row.household_status !== conflictHouseholdStatus ||
      conflictCurrent.row.household_ends_on !== conflictHouseholdEndsOn ||
      conflictCurrent.row.person_is_active !== conflictPersonIsActive ||
      conflictCurrent.row.account_status !== conflictAccountStatus ||
      JSON.stringify(conflictCurrent.dueRows[0] ?? null) !== JSON.stringify(conflictDueExpected),
    );
    const conflictOwnerMismatch = ownerMismatchCount(conflictOwnershipExpected, conflictCurrent.ownershipRows);
    const conflictInteractionCounts = asObject(conflictBefore.interactionCounts, "conflict.before.interactionCounts");
    const conflictCountMismatch = historyKinds.reduce((sum, kind) =>
      sum + Number(Number(conflictInteractionCounts[kind]) !== conflictCurrent.interactionCounts[kind]), 0);
    const conflictActiveSessionMismatch = Number(conflictActiveSessionCountExpected !== conflictCurrent.activeSessionCount);
    const conflictLifecycleAuditMismatch = Number(conflictLifecycleAuditCountExpected !== conflictCurrent.lifecycleAuditCount);
    const conflictFinancialContentMatches = conflictFinancialRowCountExpected === conflictCurrent.financialContent.rowCount &&
      conflictFinancialFingerprintExpected === conflictCurrent.financialContent.fingerprint;
    const conflictFinancialContentMismatch = Number(!conflictFinancialContentMatches);

    const journal = { ...target, migrationHead: "0013_phase_12_household_management" };
    const fixtureChecks = [
      { name: "replacement_pair_same_house_and_rt_mismatch", count: Number(replacementPairRows !== 1) },
      { name: "replacement_old_new_period_overlap", count: replacementOverlap },
      { name: "replacement_account_and_household_lifecycle_state_mismatch", count: Number(replacementState !== 1) },
      { name: "replacement_complete_due_partition_snapshot_mismatch", count: oldHouseholdDueSnapshotMismatch },
      { name: "replacement_preserved_due_snapshot_mismatch", count: preservedDueMismatch },
      { name: "replacement_future_untouched_due_not_not_due", count: futureDueInvalid },
      { name: "replacement_old_financial_owner_rows_mismatch", count: oldHistoryMismatch },
      { name: "replacement_new_household_inherited_financial_rows", count: newHouseholdHistoryRows },
      { name: "replacement_new_household_pre_start_due_invalid", count: newHouseholdPreStartDueInvalid },
      { name: "conflict_lifecycle_or_due_snapshot_partial_mutation", count: conflictStateMismatch },
      { name: "conflict_financial_owner_rows_changed", count: conflictOwnerMismatch },
      { name: "conflict_financial_interaction_counts_changed", count: conflictCountMismatch },
      { name: "conflict_resident_session_count_changed", count: conflictActiveSessionMismatch },
      { name: "conflict_lifecycle_audit_count_changed", count: conflictLifecycleAuditMismatch },
      { name: "conflict_financial_content_changed", count: conflictFinancialContentMismatch },
    ];
    const nonzeroGlobal = global.filter((check) => check.count !== 0);
    const nonzeroFixtures = fixtureChecks.filter((check) => check.count !== 0);
    console.info(JSON.stringify({
      event: "phase_12_1.post_smoke_lifecycle_neon_read_only_audit",
      environment: "development",
      projectId: expectedTarget.projectId,
      branchName: expectedTarget.branchName,
      branchId: expectedTarget.branchId,
      endpointId: expectedTarget.endpointId,
      ...journal,
      operationMode: "BEGIN READ ONLY; SELECT-only; no fixtures, writes, or schema changes",
      qaSeedAttemptInventory,
      householdAuthAndLedgerAnomalies: global,
      replacementSnapshotCounts: {
        oldHouseholdDueRowsBefore: oldHouseholdDueSnapshots.length,
        oldHouseholdDueRowsAfter: oldHouseholdDueActual.length,
        preservedDueRowsExpected: preservedDueSnapshots.length,
        futureUntouchedDueRowsExpected: futureUntouchedDueIds.length,
        newHouseholdPreStartDueRows: newHouseholdPreStartDueCount,
        newHouseholdPreStartDueRowsInvalid: newHouseholdPreStartDueInvalid,
      },
      conflictSnapshotCounts: {
        activeResidentSessionsBefore: conflictActiveSessionCountExpected,
        activeResidentSessionsAfter: conflictCurrent.activeSessionCount,
        lifecycleAuditEventsBefore: conflictLifecycleAuditCountExpected,
        lifecycleAuditEventsAfter: conflictCurrent.lifecycleAuditCount,
        financialRowsBefore: conflictFinancialRowCountExpected,
        financialRowsAfter: conflictCurrent.financialContent.rowCount,
        financialContentMatches: conflictFinancialContentMatches,
      },
      fixtureIntegrityChecks: fixtureChecks,
      nonzeroGlobalAnomalyKeys: nonzeroGlobal.map(({ name }) => name),
      nonzeroFixtureCheckKeys: nonzeroFixtures.map(({ name }) => name),
      result: nonzeroGlobal.length === 0 && nonzeroFixtures.length === 0 ? "PASS" : "FAIL",
    }, null, 2));
    if (nonzeroGlobal.length > 0 || nonzeroFixtures.length > 0) process.exitCode = 2;
    await client.query("ROLLBACK");
    transactionStarted = false;
  } finally {
    if (transactionStarted) await client?.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await pool.end();
  }
}

main().catch(() => {
  console.error("Phase 12.1 Neon development lifecycle audit failed; details suppressed to protect fixture and authentication data.");
  process.exitCode = 1;
});
