# KartuRT

KartuRT is a mobile-first dues administration app for one RT. The released V1 includes resident and official accounts, annual dues, payment requests, Treasurer-verified transfers and cash, payment history/reversal, household management, waivers, adjustments, and reports. Payments are handled manually; there is no payment gateway.

## Current release and agent handover

- Handover snapshot (2026-10-30): `main` `69473a3f4fa5a097b8cd66b920c04169cee540f4`. The current Production deployment recorded in [docs/HANDOVER_V1.md](docs/HANDOVER_V1.md) is READY on that SHA.
- Merged follow-up PRs: [#117 official login](https://github.com/Satsetx4/karturt/pull/117), [#118 Treasurer report and A4 printing](https://github.com/Satsetx4/karturt/pull/118), [#119 monthly CSV](https://github.com/Satsetx4/karturt/pull/119), [#120 PWA with RT05 icon](https://github.com/Satsetx4/karturt/pull/120).
- Gate A passed on tested head `2c13eea03f065768c2718cb15ea1bcc1ec42aad2` in [run #40888073109](https://github.com/Satsetx4/karturt/actions/runs/40888073109); PostgreSQL concurrency and PostgreSQL 18 recovery were **SKIPPED**, not PASS. Physical phone installation and real-account login remain unverified.
- Start agent work with [docs/HANDOVER_V1.md](docs/HANDOVER_V1.md) and [docs/AI_AGENT_MAINTENANCE_GUIDE.md](docs/AI_AGENT_MAINTENANCE_GUIDE.md). Issues #107 and #110 contain older checkpoint text; the handover links newer PR/release evidence.
- An annual dues matrix is WIP in a local, unpushed branch documented in the handover. It is not part of `main` or this GitHub branch.
- Past release approvals apply only to their recorded SHA/target. Any later Production operation needs fresh, operation-specific authorization. Do not repeat the Sheet2 import.

## Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS 4
- Neon PostgreSQL with Drizzle ORM and versioned SQL migrations
- Better Auth with separate resident, official, and System Admin sign-in paths
- Vitest with PGlite for PostgreSQL-compatible integration and constraint tests

## Local setup

1. Use Node.js 22.12 or newer.
2. Copy `.env.example` to `.env.local`.
3. Create a **development-only** Neon branch and set `DATABASE_URL` to that branch. Keep the development, staging, and production connection strings separate.
4. Set `BETTER_AUTH_SECRET` to a unique random value of at least 32 characters.
5. Keep `APP_ENV` and `DATABASE_ENV` equal (`development`, `staging`, `production`, or `test`). Database commands stop when those labels differ.
6. Run `npm install`, `npm run db:migrate`, and `npm run db:check`.
7. Run `npm run dev`.

The repository has no default resident, official, or System Admin account. Provision accounts only after the RT, house, household, and person records exist. Do not add sample names or PINs to the running app.

For a new development unit, set `KARTUR_RT_CODE`, `KARTUR_RW_CODE`, `KARTUR_RT_NAME`, and `KARTUR_VILLAGE` in `.env.local`, then run `npm run db:bootstrap-rt`. Optional district, city, and province values use `KARTUR_DISTRICT`, `KARTUR_CITY`, and `KARTUR_PROVINCE`. The command creates the RT unit and its date/currency settings atomically; it does not invent houses or residents.

## Provision an account

Set these values in the ignored `.env.local` file, then run `npm run account:provision`. Remove the one-time account variables after provisioning.

Required for all account types:

- `KARTURT_ACCOUNT_TYPE`: `resident`, `official`, or `system_admin`
- `KARTURT_DISPLAY_NAME`: the real account holder name
- `KARTURT_ACCOUNT_PASSWORD`: resident PIN or official/System Admin strong password; stored only as a Better Auth password hash

Officials and System Admins require `KARTURT_LOGIN_IDENTIFIER` as their username. Resident identifiers are derived from the selected household's `house.number`; do not provide a resident identifier. Resident provisioning requires the RT, active household, and active person IDs, and the server verifies that all three belong together before creating the account. A resident PIN must contain exactly six numeric digits.

For an official, `KARTURT_ACCOUNT_PASSWORD` is a separate 16–128-character recovery credential; set `KARTURT_ACCOUNT_PIN` to the official's six-digit login PIN. Each official PIN must differ from every other official PIN. System Admins use only their strong password and verified TOTP; their `KARTURT_ACCOUNT_PIN` must remain unset. A Ketua RT or Bendahara who forgets or has not set a PIN can recover it from the login page with their username and current strong password. Recovery revokes existing sessions and is audited. Never put a PIN or password in Git, issues, logs, or chat.

Officials also require `KARTURT_RT_UNIT_ID`, `KARTURT_PERSON_ID`, and `KARTURT_OFFICIAL_ROLE` (`treasurer` or `rt_chairman`); `KARTURT_ASSIGNMENT_STARTS_ON` can set a scheduled role start date.

System Admin accounts do not belong to an RT unit. After the first password sign-in, enroll an authenticator app. System Admin access remains blocked until a TOTP factor is verified. Enrollment shows backup codes once; save them outside the app. If an admin loses both the authenticator and backup codes, a different verified System Admin can perform a reasoned, referenced emergency recovery. It revokes the target's sessions and old factor; the target remains outside the app until a new TOTP factor is verified.

Five failed PIN attempts lock that account for 15 minutes; the IP-based login rate limit also remains active. This applies to residents and officials. A Chairman can reset a resident PIN only within their RT. A System Admin resident recovery must include a reason and recovery reference. Both reset paths revoke the resident's existing sessions and append an audit event. Emergency System Admin 2FA recovery is a separate action and must be authorized by another verified System Admin.

Account creation is not exposed as a public sign-up route. Resident and official accounts are separate identities, and an official role comes from an active `official_assignments` row rather than client input.

Login identifiers are unique within each RT. Until sign-in includes an RT selector, an identifier that matches accounts in multiple RT units is rejected as ambiguous instead of choosing an account arbitrarily. Official PIN sign-in also rejects an identifier that matches multiple official accounts. See [the V1.1 official PIN rollout plan](docs/v1.1-official-pin-auth.md) for the staged rollout and rollback boundary.

## Database workflow

```text
npm run db:generate  # generate a migration from the Drizzle schema
npm run db:migrate   # apply reviewed migrations to the configured database
npm run db:check     # verify the active connection with SELECT 1
```

Never run development commands with production Neon credentials. Runtime and CLI checks require matching `APP_ENV` and `DATABASE_ENV`. Production secrets belong in the deployment secret store, not Git.

## Quality gates

```text
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:constraints
npm run test:authorization
npm run build
```

PGlite integration tests apply the checked-in PostgreSQL migrations and cover unique constraints, cross-RT foreign keys, temporal official exclusivity, idempotent 12-month generation, due dates on the 10th, `NOT_DUE` lifecycle rows before/after household membership, legacy billing migration, credential login and recovery, one-time System Admin backup codes, and permission boundaries.

## Current product boundary

V1 operates one RT on Free-tier services, with manual Treasurer verification and cash recording; it has no payment gateway. Future months are not arrears. Transfer requests submitted through the app are limited to the current and overdue periods; future prepayment is recorded manually by the Treasurer. System Admin and RT Chairman do not have payment-verification permission. See the [approved single-RT scope](docs/mvp-single-rt-scope-freeze.md) and [handover](docs/HANDOVER_V1.md) before changing product boundaries.

## Search readiness

The root page has Indonesian metadata, canonical/Open Graph/Twitter fields, an organization profile, and a typographic brand icon. `/sitemap.xml` contains the public root page; `robots.txt` excludes private, auth, and API paths. Login pages use `noindex`. A Google Search Console verification value can be added through `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`.

`LocalBusiness` markup is omitted because KartuRT is software and no physical business/contact details have been supplied. This section describes public indexing metadata, not authenticated payment features; consult the handover for the current product scope.
