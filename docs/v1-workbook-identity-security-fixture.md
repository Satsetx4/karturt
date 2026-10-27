# V1 workbook identity and security fixture

## Scope and source

The five-account synthetic roster is read from the supplied workbook at execution time. The parser requires the expected four columns, five rows, the agreed role mix, unique source IDs and names, and six-digit PIN values. It preserves each ID and name as read; it does not generate replacement account identities. It assigns all five application accounts `active` status.

The role mapping is `ADMIN` to `system_admin` (1), `Ketua RT` to an official assignment `rt_chairman` (1), `Bendahara` to an official assignment `treasurer` (1), and `Warga` to residents (2). Each resident has a separate active house and household. The four-account canonical Preview fixture and its exact-count guard are unchanged.

The workbook reader and importer are under `tests/fixtures`; the verification command always creates a fresh in-memory PGlite database and applies only the checked-in migrations. It does not accept a database URL. The importer takes an advisory transaction lock, requires every application table to be empty, writes all records in one transaction, and verifies the complete role/identity/hash mapping before commit. A retry is accepted only while the database still matches that exact identity-only fixture. Partial data, unrelated rows, or a different roster cause a generic fail-closed error and transaction rollback.

Run the isolated check with:

```powershell
npm run fixture:workbook-offline -- "C:\path\to\data sintesis.xlsx"
```

The command prints only aggregate account and finance counts. Workbook values, PINs, generated privileged passwords, and parser contents are not included in stdout, stderr, test messages, or audit context. The PGlite database exists only in process memory and is closed at the end.

## PIN and sign-in policy

- Every workbook PIN is hashed before it reaches the database. Repeated PIN values are allowed. The same PIN may remain in use; first-login rotation is not required.
- Residents authenticate with their six-digit PIN. Their `pin_hash` and Better Auth credential hash stay synchronized.
- Chairman, Treasurer, and System Admin workbook PINs are separate per-account PIN settings. They are never accepted as login passwords or authorization for sensitive actions. Each privileged account keeps an independent 16–128 character password. The isolated fixture creates a random test-only password hash in memory for these accounts; it does not print or retain the plaintext password.
- System Admin access requires a verified TOTP factor. Role assignments and existing permission checks continue to govern privileged actions; a workbook PIN grants no role or action.
- The tradeoff is that users can keep a shared role PIN for convenience. For residents, this retains the risk of one PIN being known by multiple people. The app permits an account owner to choose a different PIN at any time; changing one account never changes another account.

The security menu lets each signed-in account change its PIN after verifying the current PIN. The service accepts the same PIN, hashes the resulting value, revokes all sessions for that account, clears the account-scoped failure counter, and records a sanitized audit event. Five failed attempts lock PIN change for 15 minutes.

If a privileged user forgets their PIN, the recovery form requires the current strong account password. System Admin recovery is available only inside a session whose account has verified TOTP. The operation replaces only the PIN hash, leaves the login password untouched, revokes all sessions, applies the same five-attempt/15-minute account lockout, and writes an audit event containing only the fixed recovery method and revoked-session count. Residents use the existing Chairman or structured System Admin PIN-reset flow, which updates both resident credential hashes and revokes sessions.

## System Admin MFA and recovery

System Admin TOTP enrollment and verification remain on the existing Better Auth plugin. The TOTP secret and backup codes are encrypted by the auth library at rest. Backup codes appear once after successful enrollment; the UI keeps them in component memory only. The server does not add codes, passwords, PINs, or TOTP values to audit events or application logs. Admin TOTP disable is blocked through the auth route; recovery must use another active, verified System Admin and the existing reason/reference audit flow, which deletes sessions and requires enrollment again.

The app applies endpoint rate limits to password login, password changes, TOTP verification, TOTP enrollment/disable attempts, and backup-code operations. Password login also locks an individual account after five failures for 15 minutes; failed second-factor verification uses the same threshold. Session lifetime remains eight hours, and password/PIN updates revoke other sessions. If no other verified System Admin is available after all TOTP and backup codes are lost, stop for an owner-authorized recovery decision; do not bypass MFA or directly mutate a provider.

## 2026 financial fixture

For each of the two workbook residents, the disposable verification generates twelve 2026 dues and records January–September through the resident payment-request flow, Treasurer verification, payment allocation ledger, and receipt read model. Idempotency replay and duplicate verification are checked. October remains unpaid with no request, allocation, settlement, or receipt evidence. The locked due-day rule is the 10th; at the verification date 2026-10-27, October is therefore overdue in the arrears report while still unpaid. November and December remain future unpaid periods and are excluded from arrears.

These records exist only in PGlite for local verification. No Neon Preview/Production data, deployment, provider configuration, actual secret rotation, merge, or release is part of this source implementation.

## Gate boundaries

The baseline reviewed before implementation was PR #108 head `3bc048d5e441b327a2ccab2500c54ac543878703`. Final source and CI evidence must be read from the updated PR and tracker comments at their exact recorded head. CI and disposable PostgreSQL 18 results do not establish live Preview readiness or user acceptance.

CP3 live UAT requires a separate GO bound to the exact target and source SHA. CP4 production/release requires another separate GO bound to its target and source SHA. This document does not authorize either phase.
