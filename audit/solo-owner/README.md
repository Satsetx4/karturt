# KartuRT V1 — Solo Owner approval audit ledger (INERT)

Created 2026-10-22 (Asia/Jakarta). This branch holds **no secrets**, no approval ticket, no staging capture data and no runtime application code. It exists solely as a future GitHub create-only ledger destination.

**SECURITY STATUS: UNPROTECTED / NOT TRUSTED UNTIL VERIFIED.** The existing repository ruleset `Protect` (#24900928) targets only the default branch. Do not write any used-ticket receipt here, activate the capture workflow or install `NEON_VIEWER_API_KEY` until a reviewed and independently verified rule applies specifically to `refs/heads/audit/solo-owner-approval-ledger` and appropriate non-replay/write-scope guarantees are proven.

A create-only Contents API call without `sha` denies accidental overwrite of an existing same-path file but does NOT in itself prevent an administrator or any separately authorized writer from changing branch history or replacing evidence. GitHub `GITHUB_TOKEN` with `contents: write` is repository-wide, not branch-specific. Both risks remain explicit NO-GO. An approval receipt does not grant database read/write or F2/migration/release authority.

Historical source: GitHub issue #68 / #69 / #70. The owner has created a Viewer-owned Neon API key but it is kept outside GitHub pending reviewed protected secret installation. Do not paste any API token into an issue, branch or PR.
