# Wave 13A Agent C — Smoke Launch and Staging Security

**Result: asynchronous Next smoke launches are guarded before spawn.**

## Launcher changes

`scripts/lib/next-command.ts` now exports `spawnNextCommand` for asynchronous smoke processes. It checks that `APP_ENV` and `DATABASE_ENV` are both explicit and equal, and performs the shared project `.env*` preflight before it starts Next. It returns the original `ChildProcess` so signal forwarding, startup readiness, port selection, and teardown remain with each smoke harness.

The six direct Next launches now use this helper:

- phase 6 treasurer verification;
- phase 8 cash payment;
- phase 9 payment reversal;
- phase 10 waiver;
- phase 11 tariff adjustment;
- phase 12 household management.

The tests prove environment mismatch and unsafe project environment files stop before spawn, error messages do not reveal credentials, and a safe launch preserves child-process arguments and lifecycle handling. Browser launches and disposable-PostgreSQL helpers remain independent child processes. No smoke was run with staging credentials.

## Provider and database security findings

The supplied endpoint metadata included `read_write=true`/read-write access, `passwordless_access=true`, `block_public_connections=false`, and an empty IP allowlist. The `passwordless_access` label alone does **not** prove authentication bypass. Public-connection blocking is off and there is no IP allowlist recorded; effective authentication, role grants, and actual network reachability remain unverified. Obtain independent provider evidence and restrict access before any future connection.

Keep database identities separate: a time-limited migration identity may receive only the reviewed DDL permissions needed for an approved migration window; the runtime identity should have no schema ownership or DDL and only the minimum application permissions. Wave 13A did not create or alter roles.

Current tenant authorization and composite constraints are application-layer controls; they do not prove tenant isolation for direct database access. Decide and review PostgreSQL RLS or an equivalent database-side policy before production direct-DB access. Future RT-A/RT-B negative checks should cover cross-RT Chairman report/read, Treasurer financial mutations, Chairman household/PIN mutations, reverse-direction access, and mismatched RT relationships; assert no disclosure and no state change on denial. These checks were not run against staging.

`npm audit` reported five high advisories only in development/lint dependency paths and zero production dependency advisories. No broad upgrade was included.

No Neon SQL or connection, role/network change, runtime guard opening, Vercel change, or deployment occurred.
