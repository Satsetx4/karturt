# F2.1 Launch Safety Security Closure Report

**Scope:** Close the S1–S16 security-coverage blocker for the Single-RT MVP. No Fase 3, staging, UAT, production, F14, user-facing multi-RT work, or schema migration was started.

**Branch:** `fix/launch-safety-security-closure`<br>
**Source commit tested:** `091ef09057bbb2bb3df6e7b53eb5bbb0a3ff8dd2`<br>
**Source baseline:** `d3c4f6d1d03b5b94c29bc83337041657d8156c48`<br>
**Exact source-commit CI:** run `37227655766` — PASS. Gate A and the independent PostgreSQL concurrency job both passed on the exact source SHA.

## Closure matrix

| Threat | Status |
|---|---|
| S1 — IDOR / cross-user | PASS |
| S2 — Cross-RT security fixture | PASS |
| S3 — Role escalation | PASS |
| S4 — Tenant spoofing | PASS |
| S5 — Role / actor spoofing | PASS |
| S6 — Direct API authorization | PASS |
| S7 — Mass assignment | PASS |
| S8 — Malformed payload | PASS |
| S9 — SQL injection | PASS |
| S10 — CSRF, including real two-origin browser proof | PASS |
| S11 — Session fixation / cookie attributes | PASS |
| S12 — Session revocation | PASS |
| S13 — Inactive / ended-assignment session | PASS |
| S14 — Brute-force / rate limit | PASS |
| S15 — Resident PIN lockout | PASS |
| S16 — Privileged recovery | PASS |

S1–S16 targeted local suite: 5 files, 22 tests PASS. Full local suite: 64 files, 399 tests PASS.

## Revalidation-only rows

S17 payment idempotency, S18 double-submit, and S19–S23 payment verification, cash, reversal, waiver, and household lifecycle concurrency all revalidated PASS. Exact-SHA run `37227655766` passed the full Gate A workflow and independent PostgreSQL 17 concurrency job. The existing independent concurrency harness was not rewritten.

## Product security change

The System Admin 2FA recovery request schema now rejects unknown fields with strict validation. This closes actor/role spoofing in the recovery payload. No schema, migration, authorization architecture, or broad route rewrite was added.

## Browser, session, rate-limit, and recovery proof

- S10 actual Chrome, two loopback origins, authenticated cookie delivery and valid session, financial mutation and System Admin recovery both denied with 403 and no state change. Route Origin cases also deny with zero state change.
- S11 a caller-selected fake pre-auth cookie remains unauthenticated; Better Auth issues a fresh HTTPS session cookie with `HttpOnly`, `Secure`, and validated `SameSite` attributes.
- S14 limits were read from current auth configuration and enforced at the configured N/N+1 boundary for email sign-in and System Admin TOTP, with test database limiter records observed and no useful known/unknown identity difference.
- S15 source-configured threshold and lockout duration were exercised through the real Resident login route, including expiry, authorized reset, unknown/disabled cases, and concurrent wrong-PIN attempts.
- S16 both recovery authorization matrices passed; authorized System Admin recovery changed only the target, revoked target sessions, updated factor state, wrote exactly one safe audit event, and rolled back fully when audit insertion failed.

## Data, migrations, dependencies, and quality

- Development Neon read-only checks: integrity 16/16 zero; Gate C 32/32 zero; lifecycle global 11/11 zero; migration journal 14 entries ending at `0013_phase_12_household_management`. No production access or writes.
- F13 manual oracle: 1/1 PASS. Schema drift generated no changes; Drizzle journal check PASS.
- Local `npm ci`, lint (0 errors; one pre-existing unused-variable warning), typecheck, unit 42, integration 190, constraints 42, authorization 125, targeted security closure 22, full suite 399, and production build PASS.
- `npm audit --omit=dev`: 0 vulnerabilities. Full audit: five High dependency-path findings for one development-only advisory, `GHSA-vfj7-8cjw-p6xm` (`braces@3.0.3`), tracked only under `RA-2026-F12-001 — KNOWN / ACCEPTED RESIDUAL RISK — NOT RESOLVED`. No new Critical and no new unaccepted High.
- Performance: **WARNING — remeasure in staging**. The existing local PGlite 500-household F13 report observation is approximately 11.5 seconds. F2.1 made no performance change.

## Formal verdict

F2.1 PASS<br>
LAUNCH SAFETY PASS<br>
BLOCKERS: 0<br>
CRITICAL: 0<br>
UNACCEPTED HIGH: 0<br>
Single-RT MVP: APPROVED<br>
Multi-RT user features: OUT OF MVP<br>
Multi-RT security architecture: PRESERVED<br>
READY FOR FASE 3

The exact source-code SHA CI and all required local/development-only evidence passed. The documentation-only completion commit is also required to pass the exact-branch workflow before delivery; no merge or later phase work is authorized by this report.

Evidence files are in `docs/launch-safety-security-closure-evidence/`.
