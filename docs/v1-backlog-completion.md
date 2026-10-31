# V1 backlog completion

Current released baseline: `91613aef6b5b72a956a38f17a0401b62bdb9d018`, 31 October 2026 (F14 / PR #124, including F16 / PR #123). Production deployment `dpl_33pFJyWWr97W4mcaCUSGkM4wK1YK` was READY; bounded live health/TLS/login/anonymous-access checks passed. Post-merge CI run `41187800621` passed. Owner subsequently stated "saya sudah verifikasi f14 dan f16, silahkan ditutup"; F14/F16 are CLOSED within their V1 scope. This is owner-reported verification, not an agent-executed signed-in test. See [closure record](v1-f14-f16-acceptance-closure.md).
Owner instruction: "kerjakan sesuai perencanaan backlog. buat sesederhana mungkin dan jangan membuat semakin rumit".

Keep Single-RT operations, tenant isolation, current RBAC, append-only audit and financial ledger invariants. Production merge/deploy/migration remains a separate decision bound to the final SHA and target. Use synthetic data for development and Preview; never copy credentials or resident data into evidence.

## Next step: F17 Admin Tooling

F14, F15, F16 and online-only PWA are released and owner-accepted within their recorded scope. F14/F16 verification was explicitly confirmed and closed by the owner; historical agent test limitations remain recorded. Next: audit existing account/recovery tools for F17, then implement only missing bounded operations with existing MFA, RBAC and audit controls. See [closure record](v1-f14-f16-acceptance-closure.md), [F14 scope](v1-annual-report-export.md) and [F16 scope](v1-official-lifecycle.md).

## Released F15 scope (historical)

Mobile flow: account home → Riwayat aktivitas → optional date/activity filter → older events → back to account home.
Four capabilities: scoped activity summaries, date/type filters, 25-event cursor pagination, account-home navigation.
Use the existing style, schema and permission policy. No new dependency, API, migration, raw audit context, reason text, credential display, or financial mutation.

Chairman reads own RT actors, account-targeted recovery/credential events in that RT, and RT-attributed opening-balance import events. System Admin reads all events under its existing `audit:read` permission and verified MFA. Treasurer and Resident are denied. The service rechecks the stored principal, active assignment and MFA.
The UI shows actor display name, canonical activity label, WIB time and audit reference. It intentionally omits raw context/reason/entity payloads. This summary is not a replacement for restricted operational investigation.

## Sequence and remaining work

- [x] F15: local implementation and 12 focused service/page tests, including tenant isolation, active roles/MFA, redaction, filters and microsecond-safe pagination.
- [x] F15: full local regression (704 tests / 95 files), typecheck, changed-file ESLint, migration journal/schema drift checks, optimized build, static rendering at 360/390/420/768/1440 px in light/dark themes without horizontal overflow.
- [x] F15: PR #121 merged and released to Production at the SHA above; exact-main Gate A passed. Public health/login and anonymous activity redirect checked.
- [x] F15: owner reported the pending checklist complete and passed before PR #122 release; this is owner acceptance, not agent-executed signed-in testing.
- [x] F16: existing-account schedule/end/handover UI, session revocation and transactional audit implemented and released through PR #123. Local 753 tests, typecheck/lint/build, synthetic component browser checks and exact-head CI passed.
- [x] F16: owner confirmed verification and instructed closure on 31 October 2026. CLOSED; this does not retroactively claim agent-executed deployed tests.
- [x] F14: monthly/annual CSV and arrears released through PR #124; owner confirmed verification and instructed closure. CLOSED for V1 CSV scope. Other datasets and special `.xlsx` format remain outside scope.
- [ ] F17: bounded account/recovery tooling after F15/F16; retain verified TOTP and existing recovery controls.
- [ ] F19: define recipient/event matrix; prefer in-app notifications first. Push needs a separate privacy/security design.
- [x] F20: online-only is the approved scope; no offline transaction queue, background replay, or private-data offline cache.
- [x] F20: owner reported all pending checklist items complete and passed, including Android/iPhone and signed-in acceptance. Synthetic browser tests remain separate evidence.
- [ ] F21: observe representative users from all roles on synthetic Preview; record task results and resolve usability blockers. Browser emulation is not user research.
- [ ] F23: remeasure current reports with synthetic data before optimizing; the historic PGlite 500-household result is not a Production SLA.

Each code slice uses branch → PR → exact-SHA CI → isolated synthetic Preview. Verify target identity before any provider mutation. Record skipped tests as skipped. Physical-device/user acceptance must come from actual participants; never infer it from CI.

Local verification used disposable in-memory PGlite and synthetic page fixtures. Static browser rendering proves layout only; signed-in browser navigation, real devices, independent PostgreSQL concurrency and PG18 recovery were not run. The automatic approval review rejected launching the full local Next.js server with test database configuration without giving a detailed reason. No bypass was attempted; full runtime verification remains for authorized synthetic Preview.

## Preview connection diagnosis

PR #121's initial SHA passed Gate A and its Preview build became READY after the owner authorized retargeting F4's branch-specific configuration. Initial health was unavailable; this historical failure was resolved at `7d10285e74ce41f39f9b0ebdd8d5fc6d3f86ae85`. Final Preview health returned ok with verified TLS. The PR was subsequently merged and separately deployed to Production as recorded above.

The health handler now emits only a fixed diagnostic event, stage and allowlisted category/code to server logs when all three environment labels explicitly identify Preview. HTTP responses remain generic. It never serializes error messages, stacks, connection strings, request fields or raw causes. Unknown errors use `UNKNOWN`; nested Drizzle causes are inspected to a bounded depth. No schema, credential or TLS-policy changes accompany diagnostics.

The deployed diagnostic isolated the failure to `worker_identity`, after the database query and TLS connection had succeeded. Regression tests reproduced an unconditional R3 target check on ordinary F4 health requests. The fix returns no worker identity when no scenario/worker tag is configured, matching the existing pool-mode policy. Configured R3 workers retain the exact-target check. No credential rotation or database change is indicated by this finding.
