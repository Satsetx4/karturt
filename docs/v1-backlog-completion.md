# V1 backlog completion

Current released baseline: `feee9848ef290be88e8ec3f6799d2db8c989044d`, 31 October 2026 (PR #121). Production deployment `dpl_34BKMZphrVuo9pcrR52nJ71XKHau` was READY; public health returned ok with verified database TLS at release verification.
Owner instruction: "kerjakan sesuai perencanaan backlog. buat sesederhana mungkin dan jangan membuat semakin rumit".

Keep Single-RT operations, tenant isolation, current RBAC, append-only audit and financial ledger invariants. Production merge/deploy/migration remains a separate decision bound to the final SHA and target. Use synthetic data for development and Preview; never copy credentials or resident data into evidence.

## Current step: F15/F20 acceptance and online-only payment hardening

F15 is released. The next slice clarifies uncertain payment submission results after connection loss and adds synthetic browser regression coverage for offline resident submission, manual idempotent retry, and offline Treasurer confirmation. See [online-only acceptance](v1-online-only-acceptance.md). Preserve the existing application appearance; no new screen or navigation is needed.

Mobile flow: account home → Riwayat aktivitas → optional date/activity filter → older events → back to account home.
Four capabilities: scoped activity summaries, date/type filters, 25-event cursor pagination, account-home navigation.
Use the existing style, schema and permission policy. No new dependency, API, migration, raw audit context, reason text, credential display, or financial mutation.

Chairman reads own RT actors, account-targeted recovery/credential events in that RT, and RT-attributed opening-balance import events. System Admin reads all events under its existing `audit:read` permission and verified MFA. Treasurer and Resident are denied. The service rechecks the stored principal, active assignment and MFA.
The UI shows actor display name, canonical activity label, WIB time and audit reference. It intentionally omits raw context/reason/entity payloads. This summary is not a replacement for restricted operational investigation.

## Sequence and remaining work

- [x] F15: local implementation and 12 focused service/page tests, including tenant isolation, active roles/MFA, redaction, filters and microsecond-safe pagination.
- [x] F15: full local regression (704 tests / 95 files), typecheck, changed-file ESLint, migration journal/schema drift checks, optimized build, static rendering at 360/390/420/768/1440 px in light/dark themes without horizontal overflow.
- [x] F15: PR #121 merged and released to Production at the SHA above; exact-main Gate A passed. Public health/login and anonymous activity redirect checked.
- [ ] F15: authenticated synthetic Preview browser verification and owner review remain pending. Release is not evidence of signed-in acceptance.
- [ ] F16: simple official assignment create/schedule/end UI, session revocation and transactional audit; preserve history.
- [ ] F14: monthly CSV already implemented; agree additional operational datasets before extending export. Do not build a generic database dump.
- [ ] F17: bounded account/recovery tooling after F15/F16; retain verified TOTP and existing recovery controls.
- [ ] F19: define recipient/event matrix; prefer in-app notifications first. Push needs a separate privacy/security design.
- [x] F20: online-only is the approved scope; no offline transaction queue, background replay, or private-data offline cache.
- [ ] F20: physical Android/iPhone installation and signed-in acceptance still required. Synthetic component browser evidence is tracked separately.
- [ ] F21: observe representative users from all roles on synthetic Preview; record task results and resolve usability blockers. Browser emulation is not user research.
- [ ] F23: remeasure current reports with synthetic data before optimizing; the historic PGlite 500-household result is not a Production SLA.

Each code slice uses branch → PR → exact-SHA CI → isolated synthetic Preview. Verify target identity before any provider mutation. Record skipped tests as skipped. Physical-device/user acceptance must come from actual participants; never infer it from CI.

Local verification used disposable in-memory PGlite and synthetic page fixtures. Static browser rendering proves layout only; signed-in browser navigation, real devices, independent PostgreSQL concurrency and PG18 recovery were not run. The automatic approval review rejected launching the full local Next.js server with test database configuration without giving a detailed reason. No bypass was attempted; full runtime verification remains for authorized synthetic Preview.

## Preview connection diagnosis

PR #121's initial SHA passed Gate A and its Preview build became READY after the owner authorized retargeting F4's branch-specific configuration. Initial health was unavailable; this historical failure was resolved at `7d10285e74ce41f39f9b0ebdd8d5fc6d3f86ae85`. Final Preview health returned ok with verified TLS. The PR was subsequently merged and separately deployed to Production as recorded above.

The health handler now emits only a fixed diagnostic event, stage and allowlisted category/code to server logs when all three environment labels explicitly identify Preview. HTTP responses remain generic. It never serializes error messages, stacks, connection strings, request fields or raw causes. Unknown errors use `UNKNOWN`; nested Drizzle causes are inspected to a bounded depth. No schema, credential or TLS-policy changes accompany diagnostics.

The deployed diagnostic isolated the failure to `worker_identity`, after the database query and TLS connection had succeeded. Regression tests reproduced an unconditional R3 target check on ordinary F4 health requests. The fix returns no worker identity when no scenario/worker tag is configured, matching the existing pool-mode policy. Configured R3 workers retain the exact-target check. No credential rotation or database change is indicated by this finding.
