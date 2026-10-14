# Wave 13B.1 Agent C - Independent Evidence Review

Date: 2026-10-14
Result: BLOCKED BEFORE SQL
Provider queries or SQL calls made: none

## Checks passed

- Pinned reference integrity and order match the approved 29-block set.
- Target scope is bound to the approved new staging project, branch, endpoint, database, and role.
- No old staging or production fallback is allowed.
- Source safety guards remain in their required state.
- Reporting boundaries exclude credentials, URLs, private keys, raw secret-bearing errors, application rows, and resident data.

## Blockers found in the approved inventory

The approved SQL set does not support the promised complete role-membership and grant inventory:

1. It does not query pg_auth_members for membership edges or the membership grantor and PostgreSQL 16+ membership options such as inherit_option and set_option. A pg_has_role result is not a complete membership-edge inventory.
2. Its table-privilege coverage omits PostgreSQL 18 MAINTAIN and grant-option details. PostgreSQL 18 documents MAINTAIN as a table privilege and grant options separately in the GRANT syntax.
3. It omits column-level grants and several other privilege-bearing object classes, including types, foreign servers, languages, large objects, configuration parameters, and tablespaces.

References: [PostgreSQL 18 GRANT](https://www.postgresql.org/docs/18/sql-grant.html) and [PostgreSQL 18 pg_auth_members](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html).

These are completeness gaps relative to the required result groups. The approved query set cannot be expanded or silently represented as complete during this wave. A revised inventory needs its own review and approval. Combined with the unverified connector session-affinity and fail-fast/abort contract, this independently requires stopping before SQL.

## Guard and evidence status

The source staging isolation flag was confirmed false, and the migration approval public-key pin was null at the approved source SHA. Metadata lineage fields and catalog checks cannot prove physical or ancestral emptiness. Therefore this review supports neither CLEAN_CATALOG_PREFLIGHT nor UNCLEAN; the D1 outcome remains UNKNOWN because no SQL was executed.

No files were changed in this lane.
