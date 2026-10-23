# Fast Track V1 F4 Recovery and Rollback Runbook

**Status:** Draft procedure; not executed  
**Reference candidate:** PR #93, initial F1 SHA 48b21ad3d208c983584fb32618254c9599297c07  
**Release target:** PRODUCTION READY — AWAITING OWNER GO  
**Scope:** SINGLE-RT, synthetic staging only

This runbook defines the evidence and operator sequence required for a future Fast Track release candidate. It is not a database approval, migration authorization, deployment authorization, or production GO.

Working F4 artifacts: [candidate release notes draft](RELEASE-NOTES-DRAFT.md) and [release decision packet template](F4-RELEASE-DECISION-PACKET-TEMPLATE.md). Neither is release evidence until reviewed and bound to the final candidate SHA; the packet template must be completed before a final verdict.

## Evidence boundary

- Reconfirm the candidate SHA and all evidence after every source change. The reference SHA above is a starting point, not a permanent release identity.
- The F1 candidate contains no schema or migration changes. Record the result of a fresh main-to-candidate migration inventory for each release candidate; do not infer it from this statement.
- The backup/restore drill recorded in docs/backup-restore-drill.md belongs to a previous staging environment. Its backup, branch, database, hashes, and PASS result are historical evidence and cannot prove recovery readiness for the current Fast Track target.
- Current Neon metadata identifies a PostgreSQL 18 Singapore project created through the Neon MCP server. Provider readback shows that its default root has no `parent_id` and reports `init_source=parent-data`. Neon’s [Create Branch API](https://neon.com/docs/reference/api/branches/create-project-branch) defines `parent-data` as copying schema and data from a parent branch; the [Create Project API](https://api-docs.neon.tech/reference/createproject) describes project creation but does not establish the source or contents represented by this root readback. These metadata therefore prove neither a production parent nor synthetic-only contents. Current control-plane history shows no import/restore operation, but it does not certify contents or exclude out-of-band writes. Keep contents UNKNOWN. Do not open a database session until project-level separation from production and target-bound read-only authorization are independently established. Then limit the session to a read-only identity/content preflight. Do not mutate until that preflight passes and separate write authorization is present.
- Vercel Hobby status and a suitable Preview project/path are not currently confirmed. Do not deploy until plan and project scope are verified.

## Gate 1 — Freeze and identify the candidate

Before any non-production release operation:

1. Record the full candidate commit SHA, PR, protected-main SHA, exact-head Gate A run, and results for the full suite, schema checks, build, and independent PostgreSQL concurrency.
2. Confirm the candidate is still SINGLE-RT and contains no production credentials, real resident data, or unapproved service dependencies.
3. Compare the candidate with its base for schema and migration changes. Record the changed migration filenames and expected journal head, or record none.
4. If replacing an existing staging deployment, record the previous known-good deployment and source SHA; stop if that rollback target is not verified. For a first deployment, record that it is first use and confirm the target is disposable, contains no valuable data, and has a bounded discard/recreate recovery path covered by the existing operation authorization. Stop if neither a verified rollback target nor that disposable-target recovery path exists.

A skipped, mock, PGlite, or unrelated PostgreSQL job does not satisfy staging concurrency.

## Gate 2 — Prove and authorize the staging target

Complete the identity and plan checks before opening a database connection or making a provider change:

- Record the Neon project, root branch, database, region, PostgreSQL major version, and provider creation/lineage evidence. Establish that the project is distinct from production; for a root branch, interpret init_source together with parent_id, project creation source, and operation history. Do not treat init_source=parent-data alone as proof of a parent link or empty contents.
- Verify the application and database are separate from production and development. Record the exact resource identifiers and how the evidence was obtained.
- Confirm Neon Free and Vercel Hobby are the active plans. Stop if the required capability would require a paid tier or upgrade.
- Confirm the Vercel project is dedicated to staging, the deployment target is Preview, and APP_ENV, DATABASE_ENV, and VERCEL_ENV agree with that target.
- Obtain the required scoped authorization for the specific non-production operation. A green CI run, project label, or this document does not authorize provider changes.
- Only after project-level separation is independently verified and the operation authorization names the target and read-only scope, run a read-only preflight to verify database identity, PostgreSQL major version, endpoint binding, TLS certificate validation, effective role, and sanitized content classification. Keep raw catalogs and resident data out of evidence. If contents cannot be proven synthetic-only, stop before writes and keep F2 blocked.

If project-level separation, target identity, plan, or read-only authorization is unknown, stop before connecting. If content classification, role, or TLS evidence is unknown, stop before any write, migration, seed, or restore.

## Gate 3 — Establish and prove a recovery point

Only after Gate 2 passes and the specific staging operation is authorized:

1. Use the supported backup method available on the verified Free plan. If no suitable method is available, stop; do not upgrade.
2. Back up only the verified synthetic staging source. Keep the artifact outside the Git worktree in access-controlled storage; do not commit it or place it in CI logs.
3. Record sanitized evidence: source resource identifiers, candidate SHA, PostgreSQL client/server versions, backup method, exit status, file size, and checksum. Exclude connection strings, credentials, resident fields, and raw database contents.
4. Restore to a separate disposable staging-only target. Do not use a shared root, production resource, or destructive in-place restore.
5. Validate the restore with the migration journal and allowlisted financial/integrity aggregates. Record expected and actual results without exposing row data.
6. Preserve the backup and restore evidence until the owner-approved retention point. Do not delete provider resources without separate authorization.

The drill passes only when backup and restore both succeed on the current verified target and the independent checks match.

## Gate 4 — Preview and staging UAT

After the recovery point passes:

1. Deploy the exact candidate SHA to the verified Vercel Hobby Preview project. Use staging-only variables and synthetic accounts.
2. Confirm the Preview URL, deployment commit, HTTPS, and environment labels. Do not place secret values in logs or screenshots.
3. If the candidate has no schema changes, record migration as not applicable and verify schema/journal consistency. If it has migrations, run them only under the operation-specific staging authorization and preserve sanitized output.
4. Execute the real PostgreSQL 18 staging UAT for Resident, Treasurer, Chairman, and System Admin boundaries; annual dues and receipts; arrears; current/overdue online requests; future cash collection and oldest-first allocation; retries and duplicate-payment handling; and role/tenant denials.
5. Run independent PostgreSQL concurrency tests against this same approved staging lineage. Disposable CI PostgreSQL results are useful regression evidence but do not replace this gate.
6. Repeat financial and integrity checks after UAT. Capture responsive results at the required mobile, tablet, and desktop viewports.
7. Mark each test step PASS, FAIL, or NOT RUN with candidate SHA, deployment ID, sanitized evidence path, and verifier. Do not copy a result from an earlier SHA or environment.

## Stop triggers

Stop the Preview/UAT and preserve sanitized logs if any of these occur:

- Candidate SHA, Vercel deployment SHA, or database target differs from the approved record.
- Environment labels, role permissions, TLS validation, or project plan do not match the gate evidence.
- A migration fails, schema drift appears, restore verification differs, or financial/integrity checks report an anomaly.
- A payment is applied twice, allocated to the wrong period, visible across tenants, or accepted for a role that should be denied.
- The Preview is classified as Production, a production-scoped variable is present, or the application contacts a production target.
- Any step requires a paid plan, an unapproved provider change, production credentials, or data whose lineage is unknown.

## Recovery sequence

1. Stop tester activity and record the affected Preview deployment and candidate SHA. Keep evidence sanitized.
2. If the issue is application-only and the database remains valid, return the staging Preview to the recorded known-good staging deployment using a rollback action verified to be available on the Hobby plan. Re-run the critical login, payment, authorization, and financial checks.
3. If a migration or data change may have affected staging, do not assume an application rollback reverses it. Use the already authorized, target-scoped procedure for bounded non-destructive diagnosis or restore to a separate disposable target. Stop before destructive changes to shared staging; those require separate approval naming the target and action.
4. For recovery validation, restore the last verified synthetic backup to a separate disposable staging target. Compare the migration journal and allowlisted integrity/financial aggregates before considering that target recovered.
5. Never run a destructive down migration, drop/truncate operation, or in-place restore unless a separate operation-specific approval explicitly names the verified non-production target and recovery action.
6. Record the trigger, actions, start/end times, candidate and deployment SHAs, sanitized checks, final target identity, and unresolved anomalies. A failed recovery drill keeps the release at NO-GO.

## Production rollback strategy (not executed)

The current candidate has no schema migrations, so it does not require a schema rollback. After a future explicit owner GO, the code rollback candidate is the previously approved production deployment. Before that GO, the release packet must identify the deployment and SHA, verify that the Vercel Hobby account exposes a supported rollback path, and record the operator and owner decision channel. If no supported rollback path is available, do not release.

An application rollback does not reverse payment or receipt writes made by the candidate. The production runbook must include a freeze-and-reconcile step: stop new payment actions, compare candidate-period transactions with the authorized financial record, and use the audited in-app reversal flow when a correction is required. Never delete payment rows or restore a production backup to erase legitimate financial activity.

Any future candidate with database migrations needs a separate compatibility and recovery review before owner GO. The review must explain whether the prior application can run against the migrated schema, identify a tested forward-fix or restore strategy, and include a staging restore drill. An application rollback alone is not sufficient for an incompatible schema change.

No production deployment, database connection, backup, restore, migration, credential use, or cutover is authorized by this runbook. After F1–F4 evidence is complete, the final packet may state PRODUCTION READY — AWAITING OWNER GO; production remains untouched until the owner gives that separate GO.

## F4 evidence record

For each candidate, attach or link:

- Full source SHA, main SHA, open PRs, exact-head CI run IDs, and job conclusions.
- Dependency audit result and remediation PR SHA, if applicable.
- Neon lineage, isolation, plan, role, PostgreSQL, TLS, and backup/restore evidence.
- Vercel plan, Preview project, deployment SHA, and smoke evidence.
- UAT and concurrency results from the verified staging target.
- Recovery drill result, rollback target, operator record, and unresolved items.
- Reviewed candidate release notes and the completed decision packet, including the open risk register and exact owner decision required next. A blank template does not satisfy this record.
- Final verdict and the owner decision required next.

Never put secrets, connection strings, raw catalogs, or resident-identifying data in the repository or GitHub evidence.
