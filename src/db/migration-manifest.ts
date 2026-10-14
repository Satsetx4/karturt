import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// SHA-256 over the raw Git blob bytes at Wave 13A's immutable source baseline.
export const APPROVED_MIGRATION_BLOB_SHA256 = Object.freeze({
  "drizzle/0000_messy_menace.sql": "22a2dc6d5834b3a491d929be3832e4a5194a3102931587f70920f00203fd527a",
  "drizzle/0001_classy_ricochet.sql": "6663de22b090fb66e008ef72959b54af857994b61e5347bffa0e6a99c791f161",
  "drizzle/0002_monthly_due_period_guard.sql": "fbccce0e1d134a1868ef0307599bde28bddff470887bd160b3a0913cd22a03a6",
  "drizzle/0003_due_auth_audit_domain.sql": "1349af24e1d094e0cc879181e57072d9bc880f2e0c4fda980a9acc934e05370f",
  "drizzle/0004_phase_5_payment_request.sql": "57c6c844673694fbe1fb0ccca89fb7de4b1ac4492b26656710fd4a8cd83368e2",
  "drizzle/0005_phase_5_1_payment_request_items_immutable.sql": "b72bd0c4ad4384d300029bbdb8eab4d80ef603e70b5262c6c5396ec0c0a4db67",
  "drizzle/0006_phase_6_treasurer_payment_ledger.sql": "b5bd5dd3fd5621e800a6ca66e8bc0bfbbe3b4905e7d42c0208c5e9167a553273",
  "drizzle/0007_phase_7_reject_cancel.sql": "66401840229155f0cfe85e3d2ebaf4eff93c10bf3c8c0d156ad782745ffb6d44",
  "drizzle/0008_phase_7_1_post_resolution_lifecycle.sql": "f5bb31f899b941c5417e71b8b4a6b28142bc74210487a967ef145d127428082f",
  "drizzle/0009_phase_8_cash_payment.sql": "1a2bacce06cedbbea3c2df755ae12d6f94cbef87d7fe340b5d9df35402ea2720",
  "drizzle/0010_phase_9_payment_reversal.sql": "bc58acabf918fd359613d1b039b4e466c0137f32c7a19f5e79660b14499ae0da",
  "drizzle/0011_phase_10_waiver.sql": "e0a6cd44b8b80f0b5398f7ff43d5a6249d3e0378b40d552fd3b040ce0a78ea77",
  "drizzle/0012_phase_11_tariff_adjustment.sql": "cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54",
  "drizzle/0013_phase_12_household_management.sql": "994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85",
  "drizzle/meta/_journal.json": "1e3ecdb836832da360aa944609287622da2188d06bfffdf4a16e8da18d341d5e",
} as const);

export type MigrationBlobPath = keyof typeof APPROVED_MIGRATION_BLOB_SHA256;

export function migrationManifestFingerprint(
  blobs: Readonly<Record<string, string>> = APPROVED_MIGRATION_BLOB_SHA256,
) {
  const entries = Object.entries(blobs).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

export function assertCheckedInMigrationSnapshot(repositoryRoot: string) {
  try {
    for (const [repositoryPath, expectedSha256] of Object.entries(APPROVED_MIGRATION_BLOB_SHA256)) {
      const blob = execFileSync("git", ["cat-file", "blob", `HEAD:${repositoryPath}`], {
        cwd: repositoryRoot,
        encoding: "buffer",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const actualSha256 = createHash("sha256").update(blob).digest("hex");
      if (actualSha256 !== expectedSha256) {
        throw new Error("migration snapshot mismatch");
      }
    }
  } catch {
    throw new Error("The checked-in migration files or journal do not match the reviewed immutable baseline.");
  }
}
