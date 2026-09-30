# KartuRT

KartuRT is a mobile-first RT dues administration app. Milestone 1 establishes the database, private account model, role checks, and annual monthly-dues generator. Payment requests and payment verification are outside this milestone.

## Stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS 4
- Neon PostgreSQL with Drizzle ORM and versioned SQL migrations
- Better Auth with separate resident and official sign-in paths
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
- `KARTURT_ACCOUNT_PASSWORD`: resident PIN or official/System Admin password; stored only as a Better Auth password hash

Officials and System Admins require `KARTURT_LOGIN_IDENTIFIER` as their username. Resident identifiers are derived from the selected household's `house.number`; do not provide a resident identifier. Resident provisioning requires the RT, active household, and active person IDs, and the server verifies that all three belong together before creating the account. A resident PIN must contain exactly six numeric digits.

Officials also require `KARTURT_RT_UNIT_ID`, `KARTURT_PERSON_ID`, and `KARTURT_OFFICIAL_ROLE` (`treasurer` or `rt_chairman`); `KARTURT_ASSIGNMENT_STARTS_ON` can set a scheduled role start date.

System Admin accounts do not belong to an RT unit. After the first password sign-in, enroll an authenticator app. System Admin access remains blocked until a TOTP factor is verified. Enrollment shows backup codes once; save them outside the app. If an admin loses both the authenticator and backup codes, a different verified System Admin can perform a reasoned, referenced emergency recovery. It revokes the target's sessions and old factor; the target remains outside the app until a new TOTP factor is verified.

Five failed resident PIN attempts lock that account for 15 minutes; the IP-based login rate limit also remains active. A Chairman can reset a resident PIN only within their RT. A System Admin resident recovery must include a reason and recovery reference. Both reset paths revoke the resident's existing sessions and append an audit event. Emergency System Admin 2FA recovery is a separate action and must be authorized by another verified System Admin.

Account creation is not exposed as a public sign-up route. Resident and official accounts are separate identities, and an official role comes from an active `official_assignments` row rather than client input.

Login identifiers are unique within each RT. Until sign-in includes an RT selector, an identifier that matches accounts in multiple RT units is rejected as ambiguous instead of choosing an account arbitrarily.

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

## Scope boundary

This milestone does not create payment requests, payment records, transfer/cash workflows, payment verification, reversals, or receipt screens. The permission policy records that Treasurer is the future payment verifier, while System Admin and RT Chairman have no payment-verification permission. No payment endpoint exists yet.

## Search readiness

The root page has Indonesian metadata, canonical/Open Graph/Twitter fields, an organization profile, and a typographic brand icon. `/sitemap.xml` contains the public root page; `robots.txt` excludes private, auth, and API paths. Login pages use `noindex`. A Google Search Console verification value can be added through `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`.

`LocalBusiness` markup is omitted because KartuRT is software and no physical business/contact details have been supplied. The application also has no WhatsApp or payment call-to-action in this milestone.
