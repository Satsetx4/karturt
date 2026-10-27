# Preview synthetic credential rekey

This one-shot utility rekeys only the four canonical `R2-SYNTH-01` Preview accounts. It changes their Better Auth password hashes, revokes their sessions, and adds one credential-free audit event per account. The audit records the approved CLI method and role, never a credential value. It does not create accounts, change account roles or lockout counters, alter business data, or connect with the migration role.

## Owner steps after source review

1. Wait for exact-head CI to pass on the PR head, then provide a separate GO naming that full SHA and the exact Preview project, branch, endpoint, and database. A CI pass or this document alone is not a GO.
2. In the clean checkout at that SHA, place the Preview runtime connection string and the four **new** synthetic credentials in the ignored `.env.local` file. Set `APP_ENV=preview`, `DATABASE_ENV=preview`, `KARTURT_PREVIEW_TARGET_ID`, `KARTURT_PRODUCTION_TARGET_ID`, and `KARTURT_PREVIEW_REKEY_SHA` to the exact approved values. Do not use a migration connection string.
3. Set `KARTURT_PREVIEW_REKEY_RESIDENT_PIN` to a six-digit PIN. Set the Chairman, Treasurer, and System Admin password variables to distinct values of 16–128 characters. Use fresh random values stored in the password manager. Credentials previously shared in chat are exposed and must not be reused.
4. After the separate GO is recorded, run `npm run auth:rekey-preview-synthetic -- --apply` from the clean exact-SHA checkout. The utility checks the Preview target, direct runtime role, and source SHA before it opens a transaction. It prints only the number of rekeyed accounts, revoked sessions, and SHA.

The source guard refuses a dirty checkout, a different Neon target, a production/staging label, missing local values, a changed fixture, or a prior rekey. If any check fails, it stops before applying changes. The credential values must stay in the local ignored file/password manager; never paste them into chat, GitHub, or a terminal command.
