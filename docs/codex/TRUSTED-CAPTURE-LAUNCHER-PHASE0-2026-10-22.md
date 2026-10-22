# KartuRT V1 — Solo Owner Gate phase-0 launcher (fail-closed)

**Date:** 2026-10-22 (Asia/Jakarta). **Decision:** `KRT-SOLO-20261022`, explicitly approved by the single human owner in chat. Source of truth [issue #66](https://github.com/Satsetx4/karturt/issues/66), [issue #68](https://github.com/Satsetx4/karturt/issues/68), [issue #69](https://github.com/Satsetx4/karturt/issues/69). This replaces only the *independent human reviewer* policy for V1 staging; NOT F2 or signed migration requirements.

**STATUS: PHASE-0 ONLY.** The draft workflow is **inert** and ALWAYS exits 78 after validation (or fails earlier). It cannot read Neon credentials, connect to a database, mutate staging, migrate, merge, deploy or execute F2.

## How Solo Owner Gate changes approval

GitHub Required reviewers is optional. There is no fictional second GitHub account or self-review workaround. Instead a real human `Satsetx4` must manually dispatch an approved, exact-`main` workflow with explicit approval metadata bound to source and launcher full commit SHAs, a short expiry, and a 32-hex *correlation* ticket. The launcher and future full capture code must be reviewed against security controls and tested before human admin changes existing environment. This **does not offer the same assurance** as independent peer review.

### Current phase-0 workflow conditions

- No-secret preflight on GitHub-hosted Ubuntu: rejects wrong repository, non-manual event, non-`main`, non-owner dispatcher or re-run initiator, `GITHUB_RUN_ATTEMPT != 1`, non-main launcher workflow reference, malformed 40-hex candidate SHA or 32-hex ticket, and nonexistent/mismatched exact commit readback from public GitHub API. Commit existence is NOT review or authorization.
- Protected GitHub Environment `karturt-staging-readiness`: a separate Windows job checks `GITHUB_ACTOR`, `GITHUB_TRIGGERING_ACTOR`, first-attempt, exact repository, `main`, original workflow, exact protected approved **source SHA**, exact protected approved **launcher SHA** against `GITHUB_SHA`, approved ticket vs dispatch correlation ID, and protected UTC expiry strictly within 15 minutes of the check. Missing, malformed, expired, future-too-long or mismatched approval => STOP. It always exits **78** even if all metadata matches.
- Environment variables required for a *future, separately authorized* **phase-0-only** dispatch:
  - `KARTURT_CAPTURE_APPROVED_SOURCE_SHA` — candidate exact SHA;
  - `KARTURT_SOLO_APPROVED_LAUNCHER_SHA` — the exact reviewed `main` commit SHA;
  - `KARTURT_SOLO_APPROVED_TICKET` — 32-hex correlation ID, matched to manual workflow input `owner_approval_ticket` (NOT a password or one-time secret);
  - `KARTURT_SOLO_APPROVAL_EXPIRES_AT_UTC` — strict `YYYY-MM-DDTHH:mm:ssZ`, maximum 15-minute horizon.
- No secrets, token, connection string or DPAPI key in workflow inputs. Do not commit or log credentials. The current workflow references **NO** staging secrets, performs **NO** checkout/psql/Neon calls and does not claim any Gate V1 PASS.
- Self-approved metadata is **NOT one-time**. The same Environment ticket can be dispatched again before expiry by an authorized owner, so only after a later security-reviewed **stateful replay-consumption guard** and authenticated provenance may it protect *live* capture. Always rotate/clear ticket and approval fields after test; audit GitHub run ID, SHA, timestamp and stop result. A second human reviewer previously provided independent oversight; these compensating controls cannot reproduce that property.

## Important sequencing — keep current Environment fail-closed

1. Finish offline contract regression, security review, pin workflow/action code, and obtain owner **separate merge authorization** to land the reviewed launcher on protected `main`; no merge granted in this decision.
2. Only after the live capture path is ready and auditable, the owner may adjust `karturt-staging-readiness`: remove mandatory `Required reviewers` (only when documented replacement controls are in place), keep `main`-only custom deployment branch policy, no admin bypass, optionally wait timer. **Do not remove the reviewer gate early.** No need to create an alternate account.
3. A later protected capture must use effective Neon **Viewer-only** API rights (project-scoped organization keys may be Editor; do not treat them as Viewer), signed trusted workflow/runner evidence, real creation-request lineage & synthetic-only proof, independently pinned CA and PG18 libpq, direct `verify-full` + `channel_binding=require`, and fixed bounded read-only catalog query.
4. The existing project's original creation-request artifact was **not retained** and cannot be recreated by self-assertion. The current candidate `wild-darkness-00489132` remains lineage/synthetic-only UNKNOWN. The retired `broad-star-40451875` must not be reused without a separately reviewed change. Decide separately whether genuinely authenticated alternative proof exists or an isolated new Free-plan staging is warranted.
5. Gate V1 readiness is not migration permission. Migration remains separately signed, owner authorized, exact SHA/target-bound. **F2** attempt-2 remains FAILED; explicit separate owner permission required for any F2. Production requires explicit GO, never implied.

## Test coverage and security TODO

- `tests/unit/staging-readiness-capture-entrypoint.test.ts` verifies manual-only Environment workflow, exact source/launcher approval bindings, owner identity, expiring ticket and perpetual explicit hard-stop; no secrets/database action.
- `tests/unit/staging-readiness-capture-executable-preflight.test.ts` runs Bash preflight against **offline** fake curl/jq, exercising legal owner shape and rejection of wrong owner, retry, repo, ref, event, malformed SHA/ticket and mismatch.
- Windows PowerShell protected-job logic is **not yet covered by executable offline negative tests**; an independent security review and such tests are mandatory before enabling any credentialed stage. A first-phase test pass is not authorization.
- **Next engineering task:** implement stateful single-use approval record, replay denial, authenticated provider capture plus attestation, effective Viewer guard and immutable audit; all remain non-operational until authorized.

GitHub reference: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments . No additional paid plan or team member is required solely for an optional reviewer rule on a public repository.

## Replay reservation prototype — not wired to staging

Source: `scripts/lib/solo-owner-approval-ledger.ts`; tests: `tests/unit/solo-owner-approval-ledger.test.ts`. These are **offline-only prototype components**. They do not execute as part of the phase-0 GitHub Actions workflow, which still ALWAYS exits 78.

A future owner-approved capture workflow may use a **create-only**, permanent audit record on a dedicated GitHub ledger branch `audit/solo-owner-approval-ledger`:

1. After trusted owner/launcher/candidate SHA, ticket and expiry guards pass, derive SHA256 of a domain-separated 32-hex ticket, independent of run ID and source SHA.
2. Use the GitHub Contents API to create `audit/solo-owner/used-tickets/<digest>.json` in that branch via `PUT` **without any `sha` overwrite field**, with metadata only (ticket hash, run ID, candidate and launcher SHA, time). Successful creation must return HTTP 201; any non-201 or network error is a STOP. The same ticket's path collides across repeated runs or changes of source SHA.
3. The ledger branch must exist in advance, be protected against force pushes/deletion, and allow only a reviewed automation identity to make create-only changes. In the production-reviewed job use a narrow-scoped, short-lived GitHub workflow identity for this single operation; avoid unrestricted owner PATs or access to Neon credentials. No token may appear in logs or test fixtures. Fail if branch/permissions/ledger are absent.
4. The protected workflow must *consume* the ticket **before** it accesses any provider credential or opens a database connection; a claim may be burned by a later failure, never reused. Parallel dispatches must still be serialized. A static Environment ticket/expiry alone is **not** sufficient.

**Evidence boundary:** GitHub Contents API create-only is a useful replay reservation, but a repository administrator can alter even a protected ledger policy, so it is not cryptographically equivalent to a second independent reviewer. The helper's injected request function is tested only against offline fakes. It has not been authenticated against GitHub with the future least-privilege automation token, has not been wired into the protected Windows job, and does not authorize trusted capture, F2, staging SQL, migration, merge or deployment. Both reviewer-gate removal and granting any non-read-only workflow token remain **BLOCKED** until code review, exact-head CI and separate owner approval.
