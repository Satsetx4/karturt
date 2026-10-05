# Staging Backup and Restore Drill

## Purpose and constraints

Prove that a logical backup of the representative Fase 3 staging dataset can be restored and read. This drill used staging only. The restore target was a disposable Neon branch/database, separate from the source. Production was not accessed or modified. The backup file remains outside the Git worktree and is not committed.

## Completed backup

- Status: **PASS**.
- Source: Neon staging project `wispy-sky-99637283`, branch `br-morning-wind-b3tektlf`, database `karturt_f3_uat`; source environment was staging.
- Format: PostgreSQL custom archive, PostgreSQL/pg_dump 18.6, `--format=custom --no-owner --no-privileges`.
- Archive size: 229,415 bytes.
- SHA-256: `032d2d0a876244d309d9f3adfecc1116b8988ee10a713b16fed866d31936499d`.
- The archive signature was `PGDMP`; the local file remains outside the repository. Its path and all connection details are omitted from committed evidence.

## Completed restore

- Status: **PASS**.
- Target: project `wispy-sky-99637283`, disposable branch `br-small-frog-b35k2i5h`, database `karturt_f3_restore_verification`.
- The target was empty before restore. Restore used `--no-owner --no-privileges --exit-on-error --no-password --single-transaction`; no clean/drop operation was used.
- Restored 27 public tables plus the Drizzle migration journal table.
- All 19 safe aggregate count and SHA-256 comparisons matched. Sensitive fields such as names, phone numbers, login identifiers, password hashes, session values, tokens, backup codes, and audit context were excluded.

## Restore verification

- Migration journal: 14 entries; head `0013_phase_12_household_management`; no 0014.
- Launch Integrity: 16/16 checks, zero anomalies.
- Gate C: 32/32 checks, zero anomalies.
- Lifecycle: 11/11 checks, zero anomalies.
- F13 financial/report oracle: PASS.
- Synthetic official login on the restored target: HTTP 200 with a verified session; no session cookie was persisted in evidence.
- Source-vs-restore SHA-256 values were captured in the successful pre-auth comparison and reused for the final restore verification because the allowlisted source fields did not change during the auth check.

## Evidence and cleanup

Sanitized metadata is in `docs/delivery-readiness-evidence/backup-summary.json`, `restore-summary.json`, and `restore-integrity.json`. The backup file and disposable verification branch were left in place after proof; neither was committed, and no production resource was selected. Evidence contains no passwords, PINs, TOTP secrets, session cookies, recovery codes, connection strings, password hashes, or real resident data.