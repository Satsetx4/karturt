# Wave 13A.1 Agent C: Regression Audit

## Wave 13A.2 evidence correction

This document was corrected on the Wave 13A.2 docs branch after an independent path audit found that the 14 migration filenames below were inaccurate. The prior Git blob SHA-1 was `51360ed23efe4ce81ee9f40aa8a0c65a7f8a5e29`; its history and original contents remain available at the Wave 13A.1 docs revision. The hash values were valid, but several were associated with invented filenames. The corrected names below are taken from the source Git tree and `src/db/migration-manifest.ts` at `bb566ee432b5abf1905699c01ed70e9ed34624c0`. See `docs/wave13a-2/2026-10-14/WAVE13A_2_MIGRATION_EVIDENCE_ERRATA.md` for the full correction record and comparison against the prior source baseline.

## Regression coverage

The new offline regression tests verify:

- all six phase 6, 8, 9, 10, 11, and 12 smoke callers use spawnNextCommand with explicit matching environment labels;
- unsafe and mismatched environment settings fail before a child process starts;
- project .env variants are detected, and local environment-file loading remains opt-in;
- the exact local development target is accepted while the current and legacy staging targets are rejected;
- current and legacy staging endpoint patterns are rejected across development, staging, production, and test labels;
- the staging runtime remains disabled;
- the operator path rejects a runtime DATABASE_URL fallback and consumes one-shot authorization before opening a client.

Each smoke caller passes its inherited process environment plus explicit overrides to the helper. The helper validates labels and env-file policy before spawn. The forwarded environment is not a minimal allowlist.

A separate wrapper, runNextCommand, does not independently enforce APP_ENV/DATABASE_ENV equality when there are no project env files. The six async smoke callers relevant to this regression use spawnNextCommand and are guarded. This adjacent wrapper behavior was documented for follow-up review and left unchanged to preserve its existing caller contract; the current tests do not treat it as a staging database path.

## Migration and journal integrity

Agent C hashed the raw Git blob bytes at source base 1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57. All 15 entries were present; the three supplied comparison hashes for migrations 0000 and 0003 and the journal matched. These are Git object bytes, not hashes of a local CRLF checkout.

- drizzle/0000_messy_menace.sql — 22a2dc6d5834b3a491d929be3832e4a5194a3102931587f70920f00203fd527a
- drizzle/0001_classy_ricochet.sql — 6663de22b090fb66e008ef72959b54af857994b61e5347bffa0e6a99c791f161
- drizzle/0002_monthly_due_period_guard.sql — fbccce0e1d134a1868ef0307599bde28bddff470887bd160b3a0913cd22a03a6
- drizzle/0003_due_auth_audit_domain.sql — 1349af24e1d094e0cc879181e57072d9bc880f2e0c4fda980a9acc934e05370f
- drizzle/0004_phase_5_payment_request.sql — 57c6c844673694fbe1fb0ccca89fb7de4b1ac4492b26656710fd4a8cd83368e2
- drizzle/0005_phase_5_1_payment_request_items_immutable.sql — b72bd0c4ad4384d300029bbdb8eab4d80ef603e70b5262c6c5396ec0c0a4db67
- drizzle/0006_phase_6_treasurer_payment_ledger.sql — b5bd5dd3fd5621e800a6ca66e8bc0bfbbe3b4905e7d42c0208c5e9167a553273
- drizzle/0007_phase_7_reject_cancel.sql — 66401840229155f0cfe85e3d2ebaf4eff93c10bf3c8c0d156ad782745ffb6d44
- drizzle/0008_phase_7_1_post_resolution_lifecycle.sql — f5bb31f899b941c5417e71b8b4a6b28142bc74210487a967ef145d127428082f
- drizzle/0009_phase_8_cash_payment.sql — 1a2bacce06cedbbea3c2df755ae12d6f94cbef87d7fe340b5d9df35402ea2720
- drizzle/0010_phase_9_payment_reversal.sql — bc58acabf918fd359613d1b039b4e466c0137f32c7a19f5e79660b14499ae0da
- drizzle/0011_phase_10_waiver.sql — e0a6cd44b8b80f0b5398f7ff43d5a6249d3e0378b40d552fd3b040ce0a78ea77
- drizzle/0012_phase_11_tariff_adjustment.sql — cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54
- drizzle/0013_phase_12_household_management.sql — 994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85
- drizzle/meta/_journal.json — 1e3ecdb836832da360aa944609287622da2188d06bfffdf4a16e8da18d341d5e

## Separate note

The runNextCommand observation is a wrapper audit note. No edit was made to that wrapper in this wave; the source changes remained limited to the requested migration compatibility, timeout handling, and smoke command regression coverage.
