# Wave 13A.1 Agent C: Regression Audit

## Regression coverage

The new offline regression tests verify:

- all six phase 6, 8, 9, 10, 11, and 12 smoke callers use spawnNextCommand with explicit matching environment labels;
- unsafe and mismatched environment settings fail before a child process starts;
- project .env variants are detected, and local environment-file loading remains opt-in;
- the exact local development target is accepted while the current and legacy staging targets are rejected;
- current and legacy staging endpoint patterns are rejected across development, staging, production, and test labels;
- the staging runtime remains disabled;
- the operator path rejects a runtime DATABASE_URL fallback and consumes one-shot authorization before opening a client.

Each smoke caller passes its inherited process environment plus explicit overrides to the helper. The helper validates labels and env-file policy before spawn. The forwarded environment is not a minimal allowlist.

A separate wrapper, runNextCommand, does not independently enforce APP_ENV/DATABASE_ENV equality when there are no project env files. The six async smoke callers relevant to this regression use spawnNextCommand and are guarded. This adjacent wrapper behavior was documented for follow-up review and left unchanged to preserve its existing caller contract; the current tests do not treat it as a staging database path.

## Migration and journal integrity

Agent C hashed the raw Git blob bytes at source base 1f6c71c75a3e1cf9400f6e14ea06f3a362bd8f57. All 15 entries were present; the three supplied comparison hashes for migrations 0000 and 0003 and the journal matched. These are Git object bytes, not hashes of a local CRLF checkout.

- drizzle/0000_early_blossom.sql — 22a2dc6d5834b3a491d929be3832e4a5194a3102931587f70920f00203fd527a
- drizzle/0001_tan_nerd.sql — 6663de22b090fb66e008ef72959b54af857994b61e5347bffa0e6a99c791f161
- drizzle/0002_woozy_lucy.sql — fbccce0e1d134a1868ef0307599bde28bddff470887bd160b3a0913cd22a03a6
- drizzle/0003_sharp_karolina_dean.sql — 1349af24e1d094e0cc879181e57072d9bc880f2e0c4fda980a9acc934e05370f
- drizzle/0004_fluffy_kang.sql — 57c6c844673694fbe1fb0ccca89fb7de4b1ac4492b26656710fd4a8cd83368e2
- drizzle/0005_materialized_terminator.sql — b72bd0c4ad4384d300029bbdb8eab4d80ef603e70b5262c6c5396ec0c0a4db67
- drizzle/0006_ordinary_kalani.sql — b5bd5dd3fd5621e800a6ca66e8bc0bfbbe3b4905e7d42c0208c5e9167a553273
- drizzle/0007_nebulous_zed.sql — 66401840229155f0cfe85e3d2ebaf4eff93c10bf3c8c0d156ad782745ffb6d44
- drizzle/0008_busy_mohawk.sql — f5bb31f899b941c5417e71b8b4a6b28142bc74210487a967ef145d127428082f
- drizzle/0009_slim_diana.sql — 1a2bacce06cedbbea3c2df755ae12d6f94cbef87d7fe340b5d9df35402ea2720
- drizzle/0010_tidy_hank.sql — bc58acabf918fd359613d1b039b4e466c0137f32c7a19f5e79660b14499ae0da
- drizzle/0011_cozy_traveler.sql — e0a6cd44b8b80f0b5398f7ff43d5a6249d3e0378b40d552fd3b040ce0a78ea77
- drizzle/0012_military_corgi.sql — cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54
- drizzle/0013_puzzled_ella.sql — 994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85
- drizzle/meta/_journal.json — 1e3ecdb836832da360aa944609287622da2188d06bfffdf4a16e8da18d341d5e

## Separate note

The runNextCommand observation is a wrapper audit note. No edit was made to that wrapper in this wave; the source changes remained limited to the requested migration compatibility, timeout handling, and smoke command regression coverage.
