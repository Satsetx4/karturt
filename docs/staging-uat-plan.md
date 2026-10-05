# Staging UAT Plan

## Objective and limits

Exercise Fase 3 against the real HTTPS staging deployment on the exact F3 branch, using only synthetic staging accounts and data. This plan is SINGLE-RT: no RT selector, tenant switching, multi-RT onboarding, or multi-RT browser tests. Production accounts, domains, databases, and secrets are out of scope. Do not save passwords, PINs, TOTP seeds, recovery codes, cookies, or resident PII in screenshots or evidence.

## Preconditions

- Staging app and database are separate from development and production.
- APP_ENV and DATABASE_ENV both equal staging; staging database URL is confirmed against the safe staging resource ID; app URL is HTTPS.
- Checked-in migrations 0000–0013 are applied and verified; no 0014 exists.
- The fixture summary confirms one RT and the synthetic role/lifecycle data needed for the flow.
- UAT runs in a clean browser profile with no real-user account/session. Capture only sanitized, curated screenshots.

## Resident flow

1. Open the staging origin and sign in with the synthetic Resident account.
2. View the Kartu RT and dues; verify UNPAID, PENDING, PAID and history presentation for seeded periods.
3. Create a transfer request for an eligible UNPAID period; verify it is PENDING.
4. Cancel that request and verify CANCELLED; create a new eligible request.
5. Sign in as Treasurer in a separate clean profile; verify the transfer.
6. Return to the Resident session; verify PAID and inspect payment history/allocation outcome.
7. Separately verify a wrong PIN is rejected and lockout behavior is safe; verify a revoked or expired session is rejected.
8. Test the WhatsApp link only if the product exposes one; its absence is not a blocker.

## Treasurer flow

1. Sign in as the synthetic Treasurer; open the request queue and inspect a pending request.
2. Verify one transfer; confirm the resident sees PAID and history.
3. Reject a separate request; confirm its REJECTED state.
4. Record a synthetic CASH payment through the app; inspect payment history.
5. Reverse a payment through the app; verify reversal history and resulting due/active-received semantics.
6. Attempt a Chairman-only action; require denial and unchanged state.

## Chairman flow

1. Sign in as the synthetic Chairman; inspect the household list and detail.
2. Perform one reversible/synthetic lifecycle action consistent with the fixture plan; confirm audit/history semantics and any required reactivation/cleanup.
3. Reset a synthetic Resident PIN; confirm the new PIN works without recording it.
4. Inspect the tariff and adjustment case; create only the adjustment required for the planned fixture case.
5. Inspect waiver history and perform the planned synthetic waiver.
6. View the annual report and arrears; compare amounts to an independent oracle.
7. Attempt Treasurer payment verification; require denial and unchanged payment state.

## System Admin flow

1. Sign in with password to the synthetic System Admin account and complete TOTP enrollment/challenge. Keep TOTP seed and recovery codes out of evidence.
2. Perform one representative protected admin action.
3. Have the second independently verified System Admin perform emergency 2FA recovery for the target. Verify target sessions are revoked.
4. Sign back in as the target, enroll a new TOTP factor and prove access is restored.
5. Require denial for self-recovery, recovery by an unverified admin, and a System Admin financial mutation. Verify no state change on each denial.
6. Do not build deferred Audit UI or Admin Health UI only for this test; backend/script evidence is acceptable.

## Responsive acceptance

Use browser viewports 360×800, 390×844, 430×900, 768×1024, and 1440×900. Cover Resident card/dues, Treasurer queue, Chairman household management, Chairman report, login, and MFA. For each screen check horizontal overflow, clipped currency, inaccessible actions, overlapping controls, and usable touch targets. Save a few sanitized screenshots, not a screenshot per step.

## Evidence and result format

Record one JSON summary per role: account labels only, routes/flows exercised, PASS/FAIL per step, negative authorization results, mutation IDs only if safe, and evidence filenames. Never include credential material, full names/addresses, session data, or database contents that can identify a resident. Record responsive results by viewport and screen. These plans are not execution evidence: mark each gate NOT RUN until the real staging flow is completed and independently checked.
