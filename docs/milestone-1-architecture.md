# Milestone 1 — Fase 0–3

## Mobile entry flow

```text
Beranda
  ├─ Warga → nomor rumah + PIN → ruang akun warga
  └─ Pengurus → nama akun + kata sandi → ruang Bendahara/Ketua RT

System Admin memakai jalur langsung /system/login.
  ├─ kata sandi + TOTP yang sudah terdaftar → ruang akun System Admin
  └─ belum terdaftar → hanya layar penyiapan TOTP; akses sistem ditahan
```

The sign-in forms use large touch targets, readable labels, an accessible error region, a hidden honeypot field, and an 8-hour server session. Theme preference is the only client-side setting and is read before first paint. Local storage errors are handled.

## Four included capabilities

1. A deployable Next.js/TypeScript/Tailwind foundation with Neon/Drizzle, private environment configuration, health check, and versioned migrations.
2. RT, settings, house, person, household, account, and official-assignment records with tenant-safe foreign keys and one-current-role constraints.
3. Separate resident/official authentication, server-derived role assignment, database-backed login limiting, and mandatory System Admin TOTP.
4. Annual billing years, effective-month fee snapshots, one due row per household/month, a repeat-safe 12-month generator, due day 10, and `NOT_DUE` before household start or after its ending month.

## Data ownership and constraints

- `app_accounts.auth_user_id` maps a domain account to a Better Auth identity. Passwords and resident PINs are never stored as plaintext.
- Residents are scoped to one active household. Officials are scoped to an RT and receive their role from `official_assignments`.
- Composite foreign keys stop a person, household, house, or billing year from being mixed across RT units.
- A house has at most one active household; official assignments may be scheduled in the future, but overlapping periods for one RT role or one official account are rejected.
- Monthly dues are unique by household, billing year, and month. One bulk insert plus `ON CONFLICT DO NOTHING` makes retries safe.
- `NOT_DUE` has zero amount and no fee snapshot; `UNPAID`/`PAID` require an obligation; `WAIVED` requires a positive obligation and reason. Legacy pre-resident rows migrate to `NOT_DUE`. No payment records are implemented here.
- Audit events are append-only and support transactional authentication/recovery actions. System Admin may recover the system but has no billing, cash-recording, payment-verification, or waiver permission.
- System Admin access requires verified TOTP. Backup codes are one-time; emergency recovery of another administrator revokes sessions, removes the old factor, audits the action, and keeps access blocked until new TOTP verification.

## Environment boundaries

Development, staging, and production each use a separate Neon branch and secret value. `APP_ENV` must match `DATABASE_ENV`; migrations never run at application startup. The health check returns only availability, without connection details.

## Test Gate A

Required commands: lint, typecheck, production build, unit tests, PGlite integration tests, constraint tests, and authorization tests. Neon connection and branch isolation must also be verified with a real development URL before a deployment decision. Browser checks cover 360–420 px, tablet, desktop, theme toggle/reload, navigation, and horizontal overflow.

## Risks and mitigations

| Risk | Mitigation in this milestone |
| --- | --- |
| Development command points at the wrong environment | Require explicit environment labels and reject mismatches; migrations are manual. |
| Duplicate active households or officials | Partial unique indexes in PostgreSQL plus negative constraint tests. |
| Resident sees another household's data | Resolve household from the authenticated account; never accept a household role/scope from the browser. |
| System Admin bypasses 2FA | The principal resolver returns no administrative access until TOTP is enabled; Better Auth enforces challenges for enrolled users. |
| Retry generates duplicate dues | Unique household/year/month key and a single conflict-safe insert. |
| Real Neon setup is not available to CI/local tests | PGlite exercises the SQL migration; a real Neon development connection remains a separate release check. |

## Gate decision criteria

**GO** means all automated commands pass, schema and authorization constraints pass, and the separately configured development Neon connection is confirmed. Otherwise the status is **NO-GO** with the failing or unverified gate named. Payment engine work starts only after this review.

## Current position — 2026-09-30

- Work branch: `repair/phase-0-3`, based on `522447cbabfcfbd3a18e3cd50266fe91bf781cb1`.
- Migration head: `0003_due_auth_audit_domain`.
- Automated local Gate A passed on repair code commit `d01f57cadb59511a67725b261906b5c1be41ec3c`; overall Gate A remains **NO-GO / OPEN** until a development Neon branch is identified, migration is applied there, and the live smoke passes.
- Fase 4 and payment work remain locked until the development Neon connection passes `npm run db:check` and its branch identity is confirmed.
- Evidence and findings: [Test Gate A report](test-gate-a-report.md).
