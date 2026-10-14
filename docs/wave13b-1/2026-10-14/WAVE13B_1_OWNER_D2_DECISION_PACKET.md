# Wave 13B.1 Owner Packet - Decisions Before D2

Date: 2026-10-14
State: D2 NOT STARTED; D3 NO-GO

Wave 13B.1 stopped before SQL. This packet records decisions that remain for a later phase. It grants no new provider, SQL, key-management, or migration authorization.

## D2 decision 1 - staging network exposure

The Wave 13B.0 snapshot recorded a Free plan, public connections not blocked, and an empty IP allowlist. Treat those values as historical and re-read them before any D2 action.

Choose a direction for a later reviewed packet:

- Accept the verified current network exposure for a bounded staging window, with a defined end condition and owner.
- Stop and request a separately reviewed access-path design before proceeding.

No paid upgrade or network configuration change is included here. Do not infer that public exposure is safe from the read-only preflight.

## D2 decision 2 - role separation and grants

Choose the intended separation for a later least-privilege design: owner/migration role, runtime role, and any human operator role. The exact effective grants are unknown because no SQL ran and the approved inventory was incomplete.

Any grant inventory must first be made complete, reviewed, and separately authorized. No role or grant change is included in this packet.

## D2 decision 3 - migration approval public key

The source pin remains null. If a future migration-approval design is desired, decide whether a human-controlled Ed25519 key ceremony and public-key pinning should be prepared under a separate approval. No key was generated, signed, or pinned in Wave 13B.1. Do not place private key material in the repository or report.

## D3 boundary

The 14-migration operation remains NO-GO. D3 requires its own explicit approval after the D2 decisions, complete evidence, and a separate safety review. This packet does not authorize migration, seed, reset, rebuild, delete, or runtime enablement.
