export const officialMigrationTags = [
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
  "0014_handy_genesis",
  "0015_sheet2_opening_balance_import",
] as const;

export const officialMigrationCount = officialMigrationTags.length;
export const officialMigrationHeadTag = officialMigrationTags.at(-1)!;
