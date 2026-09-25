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
4. Annual billing years, effective-month fee snapshots, one due row per household/month, a repeat-safe 12-month generator, due day 10, and pre-start months waived.

## Data ownership and constraints

- `app_accounts.auth_user_id` maps a domain account to a Better Auth identity. Passwords and resident PINs are never stored as plaintext.
- Residents are scoped to one active household. Officials are scoped to an RT and receive their role from `official_assignments`.
- Composite foreign keys stop a person, household, house, or billing year from being mixed across RT units.
- A house has at most one active household; each RT has at most one active Treasurer and one active RT Chairman; an official has at most one active assignment.
- Monthly dues are unique by household, billing year, and month. One bulk insert plus `ON CONFLICT DO NOTHING` makes retries safe.
- A due is either unpaid with a positive snapshotted fee, or waived with amount zero and reason `not_yet_resident`. No payment states or payment records are implemented here.
- System Admin may recover the system but has no billing, cash-recording, payment-verification, or waiver permission.

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
