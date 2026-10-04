# Fase 12 — Household Management Design Freeze

Status: **FROZEN before implementation**
Date: 2026-10-03 (Asia/Bangkok)
Repository: `Satsetx4/karturt`
Implementation branch: `feat/phase-12-household-management`

## 1. Verified baseline

- Remote `main` and `verify/gate-c-financial-invariants` both resolve to `ff9628b7fa178fb3c56ff3530adeb4719b9fe295`.
- A separate F12 worktree was created from that exact commit. It was clean before this document was added.
- Gate C CI run `37099099661` completed successfully on that exact SHA. Its job passed lint, typecheck, unit/integration/constraint/authorization/full tests, migration journal and schema drift checks, and production build.
- Drizzle journal head is `0012_phase_11_tariff_adjustment`. Neon development records 13 entries and hash `cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54`. That hash matches the Git LF blob for `drizzle/0012_phase_11_tariff_adjustment.sql`.
- Read-only preflight target: project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), database `neondb`. Production was not queried or changed.
- Household period overlap pairs, duplicate active households per house, duplicate non-disabled resident login groups, and resident identifiers affected by disabled-history reuse all counted zero. The development branch currently has no disabled resident accounts, so same-house reuse needs a controlled smoke scenario.
- A fresh SELECT-only Gate C audit passed all 32 anomaly checks with zero anomalies.
- The current schema has one active household per house, but no all-period overlap constraint. Resident accounts are unique by RT/type/login including disabled history. The login resolver counts disabled history, then fails closed when multiple accounts match. `people.household_id` and resident account membership are direct household links.
- `buildAnnualDues` classifies whole months from the household start/end month, with no proration. Phase 11 installed two independent due-history guards, and both protect snapshot fields needed for a safe unpaid-to-NOT_DUE transition. F12 therefore needs the same narrowly validated exception in both guards; all other snapshot rewrite protection stays intact.

## 2. Product and authorization boundary

F12 covers household/resident creation, safe profile edits, deactivation, replacement at the same physical house, resident PIN reset, history preservation, and lifecycle-safe dues.

Only an active Chairman principal may manage household lifecycle inside its own RT. Treasurer and Resident are denied. System Admin has no general household mutation permission; its existing structured PIN recovery path remains separate. An inactive, ended, or ambiguous Chairman principal is rejected through normal principal resolution. The RT role does not gain payment verification.

APIs use strict payload schemas and derive tenant scope from the authenticated principal. Cross-RT IDs return generic not-found/forbidden responses. Client-supplied RT, status, account type, old debt, amount, fee rate, person/account/auth IDs, or membership fields are rejected.

House numbers are resident login identifiers. F12 may create a house with a new resident, but cannot renumber an existing house. An existing house label is editable.

## 3. Lifecycle state machines

### Create

`Vacant house` → lock house → validate first/current-or-future effective date and no household-period overlap → insert active household → insert new person → create Better Auth user/account with a server-generated opaque email and a hash of the exact six-digit PIN → create app resident account using the canonical house number → generate dues for the open billing year when one exists → append `household.created` → commit.

A create flow may select an existing house without an overlapping active period or create a new house. If an open billing year exists but has no applicable fee rate, the whole operation fails. If no billing year is open, household/account creation is allowed and the screen reports that dues are not yet generated; the existing billing activation/generator path can generate them later. Before the month containing `startsOn`, generated months are NOT_DUE; the start month and later active months use existing tariff snapshots. No proration is introduced.

### Edit

Only the active household’s resident name, phone, and house label may be edited. Membership, household dates, house number, account type/status, credentials, and financial data are not edit fields. Historical/inactive residents cannot be edited through this flow. One `household.updated` event stores changed field names only.

### Deactivate

The Chairman chooses an active-through month and a 1–500 character reason. The effective end date is the last day of that month and cannot precede the current Jakarta billing month. This keeps the selected month billable and avoids retroactively changing a past period. No proration or waiver occurs.

After locking the house, household, and due rows, the service checks every generated due period after the end month. A row already NOT_DUE is unchanged. An untouched future UNPAID row may transition to NOT_DUE only if it has no payment allocation (including reversed history), request item/claim, waiver item, or due adjustment. Any interacting history, or any post-end row in another state, rejects the entire operation. A permitted transition sets status=NOT_DUE, amount=0, fee_rate_id=NULL, waived_reason=NULL; its period, due date, owner, and identity remain unchanged.

On success, the household becomes inactive with `endsOn`, linked people become inactive, non-disabled resident accounts become disabled, and all their Better Auth sessions are revoked. Earlier active-period dues and arrears remain unchanged. Deactivation is not pemutihan.

### Replace resident / household turnover

The Chairman selects a future effective month strictly after the current month and enters the new resident fields, exact six-digit initial PIN, and a required reason. The new household `startsOn` is the first day of that month; the old household `endsOn` is the prior calendar day.

One transaction performs the old household’s safe future-due reconciliation, closes the old household and people, disables old resident accounts, revokes their sessions, creates a new household/person/auth account/app account on the same `house_id`, generates the new household’s dues, and appends `household.resident_replaced`. If any old post-end due cannot safely become NOT_DUE, nothing commits.

Old arrears, payments, requests, allocations, reversals, waivers, adjustments, and audit rows remain attached to the old household. No financial row is copied or reassigned. The new household starts with no inherited balance. The old resident identity is retained as an inactive historical person/account.

### Reset PIN

Reuse `resetResidentPin()` and the existing `POST /api/residents/[accountId]/reset-pin` route. Strengthen target checks so a Chairman can reset only an active resident account/person in an active household in the same RT. PIN remains exactly six digits; hash immediately; reset lock counters; revoke sessions; append existing `resident.pin.reset` audit in the same transaction. The response never returns PIN/hash. System Admin can use only the current structured recovery route with its required recovery reference.

## 4. Identity, login reuse, and same-person transfer

The resident login identifier is derived server-side from `houses.number`, normalized uppercase. A disabled historical resident account no longer participates in resident login uniqueness or resident lookup. The current/non-disabled same-RT uniqueness rule remains. Official and System Admin uniqueness rules remain unchanged.

The resolver still looks up at most two non-disabled accounts globally by account type and normalized identifier. If two current candidates exist across RTs, login fails generically; it never chooses one arbitrarily. Creation/replacement checks for a current cross-RT collision first and refuses to issue credentials that would be ambiguous. Disabled history in another RT does not prevent reuse.

Normal replacement always creates a new household, person, and resident account. F12 does not move an existing person or account to another household. A same-person transfer requiring identity continuity is explicitly blocked and remains a later temporal-membership design decision.

## 5. Due-transition guard and transaction lock order

Migration `0013_phase_12_household_management.sql` retains both Phase 11 snapshot guards except for this exact transition: old status UNPAID → new status NOT_DUE, same RT/household/year/month/due date/created time, zero amount, null fee rate/reason, household already inactive with an end date, period strictly after its end month, due date still future in Jakarta, and no allocation/reversal history, payment-request item/claim, waiver item, or due adjustment. Existing NOT_DUE and WAIVED terminal protections stay unchanged. The service repeats these checks while holding due locks; both database triggers are final guards.

Lifecycle transactions use this order:

1. Lock the scoped `houses` row `FOR UPDATE` as the per-house mutex.
2. Lock the relevant household rows in stable ID order.
3. Lock that household’s monthly dues in stable billing-year/month/ID order.
4. Inspect immutable financial/request/waiver/adjustment histories and reconcile safe future dues.
5. Lock resident app accounts in stable ID order; update account status, credentials if needed, and sessions.
6. Insert any new household/person/auth/account/due rows.
7. Append critical audit event(s) and commit.

Existing payment flows lock request/payment/idempotency rows before sorted due rows and do not lock the house row. Lifecycle never locks request/payment parent rows; it serializes on due rows and rejects any interacted post-end due. A request/payment that wins the due lock completes first and is then detected; a lifecycle transition that wins first makes later financial operations see NOT_DUE. House-level serialization plus the database period trigger handles same-house lifecycle races.

## 6. Audit contract

- `household.created`: household entity; IDs, start date, generated due count only.
- `household.updated`: household entity; changed field names only.
- `household.deactivated`: household entity; required reason, effective end date, IDs/counts of disabled accounts, revoked sessions, and dues transitioned.
- `household.resident_replaced`: old household entity; required reason, old/new household/account IDs, effective date, revoked session count, and dues transitioned.
- `resident.pin.reset`: existing action and context contract.

No audit context contains names, phone, house number, PIN, password, hash, auth token, cookie, or email. Extend the audit writer’s explicit action/context allowlist. All critical mutations and audits share one database transaction, so audit failure rolls the lifecycle action back.

## 7. Migration and backfill

The forward-only 0013 migration may:
- fail closed before mutation if existing household date ranges overlap for the same RT/house;
- split resident and official login uniqueness so only disabled resident history is excluded;
- add a house-locking household-period overlap trigger for inserts/updates, including direct SQL;
- make household identity/start fields immutable after creation;
- add only an index justified by household-history search;
- replace the Phase 11 due guard with the exact validated F12 transition above.

No legacy household, person, account, or financial row is rewritten or deleted. No debt backfill/transfer occurs. No new dependency/extension is required. Drizzle schema, migration journal, and snapshot must match. Clean migration 0000→0013 and upgrade 0012→0013 are both required, with Gate C ledger snapshot preservation checked.

## 8. API, UI, and verification plan

Add a Chairman-only household management page linked from the existing Chairman home, with search/list and history summary, add, safe edit, deactivate, replace, and reset PIN flows. Use existing visual patterns, Indonesian product labels, 44px+ controls, explicit confirmations, loading/error/success states, and a double-submit guard. Explain that old debt remains on the old household and deactivation is not waiver. Do not show raw IDs, account type/status enums, SQL, or internal errors. Do not store initial/reset PIN or other secrets in localStorage.

Required tests cover lifecycle services/transactions, identity reuse and ambiguity, strict payload validation, audit rollback, authorization and IDOR, overlapping-period direct writes, due history preservation, concurrent lifecycle/payment races, current login/session revocation, old/new household balance separation, and clean/upgrade migrations. Then run the requested F5–F11/Gate C regressions, lint/typecheck/build/Drizzle/schema-drift, guarded Neon development migration and Better Auth smoke, five viewport browser smoke, post-smoke all-zero Gate C audit, and final-HEAD GitHub Actions. Add only the exact F12 branch to the workflow push filter if needed.

## 9. Boundaries and open proof

No F13 reports, F14 exports, F16 official lifecycle, generic System Admin household editor, proration, debt transfer, hard delete, production migration/deploy, or merge to `main`.

The design is frozen from the verified source and SELECT-only preflight above. Implementation and all live/browser/final-CI evidence remain pending; this document does not claim F12 PASS.
