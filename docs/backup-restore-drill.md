# Staging Backup and Restore Drill

## Purpose and constraints

Prove that a logical backup of the representative Fase 3 staging dataset can be restored and read before production is considered. Back up staging only. Restore only into a disposable restore-verification database or branch; never into the original staging database or production. Keep the backup file outside the Git worktree and uncommitted. Production remains untouched.

## Preconditions

- The staging project/branch/database identifiers are verified against the Fase 3 isolation evidence; source environment labels are staging.
- Migration head is 0013_phase_12_household_management, with exactly 14 journal entries.
- The single-RT synthetic fixture and representative financial flows are complete. Freeze staging mutations while the backup/restore comparison runs.
- The PostgreSQL client version supports pg_dump and pg_restore custom format. Record versions, but never log credentials or connection strings.
- The restore target has an independent endpoint/branch identity and an empty database named for restore verification. Do not point tools at the source endpoint/database for restore.

## Backup procedure

1. Use pg_dump against the staging database with custom format, no owner and no privileges (for example, --format=custom --no-owner --no-acl).
2. Write the dump to a temporary directory outside the repository. Restrict access to the local operator account.
3. Compute and record UTC timestamp, byte size, SHA-256, pg_dump version, safe source project/branch/database identifiers, source environment staging, and migration head. Do not record a connection string, user/host secret, auth data, password hashes, or PII.
4. Verify the file is nonempty and the checksum can be recomputed.

## Restore procedure

1. Provision a disposable restore-verification target independent from the original staging database. Create an empty target database in the disposable branch or project; confirm safe identifiers immediately before use.
2. Restore with pg_restore into that target using the original database role/schema requirements, without restoring ownership or privileges. Do not use --clean against staging; never run pg_restore with the staging source endpoint selected.
3. Capture safe aggregate counts/checksums from both source and restored DB for: RT units, houses, households, people, app accounts, official assignments, billing years, fee rates, monthly dues, payment requests, request items, claims, payments, allocations, reversals, waivers, audit events, and migration journal.
4. Compare migration journal row count/head/hash and run journal consistency, Launch Integrity 16/16, Gate C 32/32, Lifecycle 11/11, F13 financial/report oracle, and one synthetic account login against the restored target.
5. Require every requested comparison and check to pass. Any mismatch, invalid credential/session state, missing table/data, or nonzero anomaly is a Fase 3 launch blocker; investigate without mutating source staging.
6. After successful proof and durable recording of safe metadata, delete the disposable restore database/branch and local backup file only as authorized by the Fase 3 request. Confirm that the original staging and production resources were not selected or altered.

## Evidence

Write sanitized backup-summary.json, restore-summary.json, and restore-integrity.json under docs/delivery-readiness-evidence/. Include safe resource IDs, timestamp, file size/hash, migration metadata, expected/actual aggregate results, per-check status, and tool versions. Exclude secrets, connection strings, authentication artifacts, hashes of password material, and real resident data.

Current status: NOT RUN. This file is the procedure only; no backup or restore result is claimed until the controlled drill is completed.
