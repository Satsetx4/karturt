# V1 backlog completion

Baseline: `69473a3f4fa5a097b8cd66b920c04169cee540f4`, 31 October 2026.
Owner instruction: "kerjakan sesuai perencanaan backlog. buat sesederhana mungkin dan jangan membuat semakin rumit".

Keep Single-RT operations, tenant isolation, current RBAC, append-only audit and financial ledger invariants. Production merge/deploy/migration remains a separate decision bound to the final SHA and target. Use synthetic data for development and Preview; never copy credentials or resident data into evidence.

## Current step: F15 audit viewer

Mobile flow: account home → Riwayat aktivitas → optional date/activity filter → older events → back to account home.
Four capabilities: scoped activity summaries, date/type filters, 25-event cursor pagination, account-home navigation.
Use the existing style, schema and permission policy. No new dependency, API, migration, raw audit context, reason text, credential display, or financial mutation.

Chairman reads own RT actors, account-targeted recovery/credential events in that RT, and RT-attributed opening-balance import events. System Admin reads all events under its existing `audit:read` permission and verified MFA. Treasurer and Resident are denied. The service rechecks the stored principal, active assignment and MFA.
The UI shows actor display name, canonical activity label, WIB time and audit reference. It intentionally omits raw context/reason/entity payloads. This summary is not a replacement for restricted operational investigation.

## Sequence and remaining work

- [x] F15: local implementation and 12 focused service/page tests, including tenant isolation, active roles/MFA, redaction, filters and microsecond-safe pagination.
- [x] F15: full local regression (704 tests / 95 files), typecheck, changed-file ESLint, migration journal/schema drift checks, optimized build, static rendering at 360/390/420/768/1440 px in light/dark themes without horizontal overflow.
- [ ] F15: authenticated synthetic Preview verification and owner review; no Production release.
- [ ] F16: simple official assignment create/schedule/end UI, session revocation and transactional audit; preserve history.
- [ ] F14: monthly CSV already implemented; agree additional operational datasets before extending export. Do not build a generic database dump.
- [ ] F17: bounded account/recovery tooling after F15/F16; retain verified TOTP and existing recovery controls.
- [ ] F19: define recipient/event matrix; prefer in-app notifications first. Push needs a separate privacy/security design.
- [ ] F20: online-only PWA implemented; physical Android/iPhone installation and signed-in acceptance still required.
- [ ] F21: observe representative users from all roles on synthetic Preview; record task results and resolve usability blockers. Browser emulation is not user research.
- [ ] F23: remeasure current reports with synthetic data before optimizing; the historic PGlite 500-household result is not a Production SLA.

Each code slice uses branch → PR → exact-SHA CI → isolated synthetic Preview. Verify target identity before any provider mutation. Record skipped tests as skipped. Physical-device/user acceptance must come from actual participants; never infer it from CI.

Local verification used disposable in-memory PGlite and synthetic page fixtures. Static browser rendering proves layout only; signed-in browser navigation, real devices, independent PostgreSQL concurrency and PG18 recovery were not run. The automatic approval review rejected launching the full local Next.js server with test database configuration without giving a detailed reason. No bypass was attempted; full runtime verification remains for authorized synthetic Preview.
