# Neon development business-flow smoke

- Harness: existing `scripts/phase-11-tariff-adjustment-http-smoke.ts --resume-f11`
- Source checkout: `feat/phase-11-tariff-adjustment` at `8fcbcf77bc06c8d0966a4d1db6fe86fa018df1a8`
- Target: Neon development project `billowing-base-57949906`, branch `karturt-development` (`br-crimson-band-az6i637k`), direct endpoint `ep-quiet-cake-azrhjiyh`, database `neondb`
- Mode: resumed the existing 0012 F11 development database; no migration was applied
- Result: PASS; final migration hash remained `cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54`

The official Better Auth / HTTP flow exercised transfer verification, cash receipts, idempotent adjustment retry and conflicting-key rejection, pending-request protection, positive and negative adjustments, reversal followed by repayment, WAIVED and NOT_DUE protection, scheduled tariffs, and direct database over-allocation rollback. It retained financial and identity fixtures on the approved development branch and removed temporary login sessions.

The browser smoke reported no page errors, no horizontal overflow, and touch targets at least 50px across 360x800, 390x844, 430x900, 768x1024, and 1440x900. Pending-request adjustment and negative adjustment that would create credit were both blocked.

The smoke's separate live arithmetic sample independently computed `190,000 + 31,000 - 15,000 = 206,000` effective target and `206,000 - 105,000 = 101,000` outstanding, with `50,000` waived excluded. The frozen Gate C manual dataset and its PGlite/SQL/read-model comparison are recorded in the Gate C plan and report.
