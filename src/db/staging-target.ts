export const stagingDatabaseTarget = {
  projectId: "flat-cloud-57657711",
  branchId: "br-sparkling-flower-azordm9k",
  endpointId: "ep-red-boat-azzqyf45",
  database: "karturt_staging",
  directHost: "ep-red-boat-azzqyf45.c-3.ap-southeast-1.aws.neon.tech",
  runtimeRole: "karturt_stg_runtime_v2",
  migrationRole: "karturt_stg_migrator_v2",
  migrationTags: [
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
  ],
  migrationCount: 14,
  migrationHeadTag: "0013_phase_12_household_management",
} as const;

export const stagingDatabaseTargetReference = `${stagingDatabaseTarget.projectId}/${stagingDatabaseTarget.branchId}/${stagingDatabaseTarget.endpointId}/${stagingDatabaseTarget.database}`;
