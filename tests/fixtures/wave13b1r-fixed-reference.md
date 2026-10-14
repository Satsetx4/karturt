# Wave 13B.1R — Fixed Read-Only Catalog Reference

**State: DESIGN ONLY — NOT EXECUTED — NOT OWNER-APPROVED**

This is a new candidate for a future D1v2 owner review. It does not amend, replace, or inherit the historical D1 approval. The previous 29-statement text remains frozen at Git blob SHA-1 **78501ab327bdc7b7a9a06a0a0f66fe039fc8d148**. No SQL from this reference has been run against Neon or any database.

## Frozen target

All five explicit target arguments must match this tuple before a future call is even considered:

| Argument | Required value |
| --- | --- |
| project_id | falling-bread-33359184 |
| branch_id | br-muddy-frost-azot13fb |
| compute_id | ep-silent-butterfly-azrflu40 |
| database_name | karturt_staging |
| role_name | karturt_staging_owner |

The corresponding metadata identity to recheck immediately before any separately approved future D1v2 is organization satset / org-ancient-boat-57106549, project karturt-v1-staging-clean, database ID 702718, and endpoint hostname ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech. Metadata is a target cross-check, not proof of emptiness or independent lineage. The old project and endpoint are not an alternate target.

## Transaction and identity prerequisites

This sequence is only meaningful if an owner-approved execution method guarantees one backend PostgreSQL session and one transaction for all 26 statements, with explicit BEGIN before Q01, ordered execution, stop-on-first-error, and rollback on any error, guard failure, incomplete result, or client-side uncertainty. Q01 must be the first statement in that transaction. A successful complete sequence must be explicitly committed; the runner must report the transaction outcome and all ordered results. No savepoint-and-continue behavior is acceptable.

The actual connected run_sql_transaction connector has not been verified to provide these semantics or to bind all five target arguments as stated. A transaction-shaped tool description is not proof. If exact connector/session/error semantics cannot be shown against the actual connected implementation, this SQL stays unapproved and the owner must review a separate narrow execution method. Do not use this file as authorization to call any Neon SQL tool, connect to a database, or wake compute.

Q02 is a fail-closed SQL guard for the database, login role, active role, read-only transaction state, and PostgreSQL 18 major version. It deliberately raises a division-by-zero error when a condition is false. Agent C must confirm this guard's PostgreSQL 18 behavior and abort/rollback handling using a disposable database before it can be considered for owner review. It is not a substitute for pre-call target binding. Q03–Q06 preserve identity/version/read-only evidence as separate ordered results.

## Output and bounded-result rules

The output schema is statement-specific and fixed by each SELECT list below. Q02 returns one column, preflight_guard, on success; Q03–Q06 return PostgreSQL SHOW/single-row identity results. Q07–Q25 return only the named catalog or information-schema columns; Q26 returns object class, object identity, privilege type, and a boolean effective result for the fixed target role. No statement returns application row contents, SQL definitions, routine arguments, foreign options, user-mapping options, role passwords, connection strings, configuration values, or ledger rows.

Every row-producing catalog query is ordered and capped at 501 rows (Q25 at 2 rows). A result with 501 rows, a missing result, a connector truncation marker, permission failure, or any uncertainty about completeness is UNKNOWN; there is no pagination or follow-up query in this frozen set. The cap bounds rows returned and retained by the caller; PostgreSQL may inspect more catalog rows to satisfy sorting/filtering. This is a bounded evidence packet, not a proof that the server scanned at most 501 catalog entries.

## Frozen statement text

The following 26 statements are in execution order. Each SQL body is constant and contains no user input, dynamic SQL, user-defined function call, COPY, DML, or DDL.

### Q01 — transaction mode

~~~sql
SET TRANSACTION READ ONLY;
~~~

### Q02 — fail-closed target/session/version guard

~~~sql
SELECT 1 / CASE
  WHEN current_catalog = 'karturt_staging'
   AND current_user = 'karturt_staging_owner'
   AND session_user = 'karturt_staging_owner'
   AND (SELECT setting FROM pg_catalog.pg_settings WHERE name = 'transaction_read_only') = 'on'
   AND (SELECT setting::integer FROM pg_catalog.pg_settings WHERE name = 'server_version_num') BETWEEN 180000 AND 189999
  THEN 1
  ELSE 0
END AS preflight_guard;
~~~

### Q03 — read-only transaction evidence

~~~sql
SHOW transaction_read_only;
~~~

### Q04 — connected identity evidence

~~~sql
SELECT current_catalog AS database_name, session_user AS login_role, current_user AS active_role;
~~~

### Q05 — server version

~~~sql
SHOW server_version;
~~~

### Q06 — numeric server version

~~~sql
SHOW server_version_num;
~~~

### Q07 — role attributes without credential fields

~~~sql
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit
FROM pg_catalog.pg_roles
ORDER BY rolname
LIMIT 501;
~~~

### Q08 — every visible role-membership edge and its independent options

~~~sql
SELECT granted.rolname AS granted_role, member.rolname AS member_role, grantor.rolname AS grantor_role,
       m.admin_option, m.inherit_option, m.set_option
FROM pg_catalog.pg_auth_members AS m
JOIN pg_catalog.pg_roles AS granted ON granted.oid = m.roleid
JOIN pg_catalog.pg_roles AS member ON member.oid = m.member
LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = m.grantor
ORDER BY granted.rolname, member.rolname, grantor.rolname
LIMIT 501;
~~~

### Q09 — roles applicable to the connected user

~~~sql
SELECT grantee, role_name, is_grantable
FROM information_schema.applicable_roles
ORDER BY grantee, role_name
LIMIT 501;
~~~

### Q10 — shared database owners and raw ACLs

~~~sql
SELECT d.datname AS database_name, owner.rolname AS owner_name, d.datacl::text AS raw_acl
FROM pg_catalog.pg_database AS d
JOIN pg_catalog.pg_roles AS owner ON owner.oid = d.datdba
ORDER BY d.datname
LIMIT 501;
~~~

### Q11 — schema owners and raw ACLs

~~~sql
SELECT n.nspname AS schema_name, owner.rolname AS owner_name, n.nspacl::text AS raw_acl
FROM pg_catalog.pg_namespace AS n
JOIN pg_catalog.pg_roles AS owner ON owner.oid = n.nspowner
ORDER BY n.nspname
LIMIT 501;
~~~

### Q12 — extension names, versions, and schemas only

~~~sql
SELECT e.extname AS extension_name, e.extversion AS extension_version, n.nspname AS schema_name
FROM pg_catalog.pg_extension AS e
JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
ORDER BY e.extname
LIMIT 501;
~~~

### Q13 — relation inventory, owner, raw ACL, and security-relevant relation flags

~~~sql
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind, c.relpersistence,
       owner.rolname AS owner_name, c.relacl::text AS raw_acl,
       c.relrowsecurity, c.relforcerowsecurity, c.relispartition
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_roles AS owner ON owner.oid = c.relowner
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast|temp)_'
ORDER BY n.nspname, c.relname, c.relkind
LIMIT 501;
~~~

### Q14 — explicitly granted column ACLs

~~~sql
SELECT n.nspname AS schema_name, c.relname AS relation_name, a.attname AS column_name,
       owner.rolname AS relation_owner, a.attacl::text AS raw_acl
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_roles AS owner ON owner.oid = c.relowner
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND a.attacl IS NOT NULL
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast|temp)_'
ORDER BY n.nspname, c.relname, a.attnum
LIMIT 501;
~~~

### Q15 — routine owners and raw ACLs, without definitions or arguments

~~~sql
SELECT n.nspname AS schema_name, p.proname AS routine_name, p.oid::text AS routine_oid,
       p.prokind, owner.rolname AS owner_name, p.proacl::text AS raw_acl,
       p.prosecdef, p.proleakproof
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_roles AS owner ON owner.oid = p.proowner
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast|temp)_'
ORDER BY n.nspname, p.proname, p.oid
LIMIT 501;
~~~

### Q16 — type owners and raw ACLs

~~~sql
SELECT n.nspname AS schema_name, t.typname AS type_name, t.typtype, t.typcategory,
       owner.rolname AS owner_name, t.typacl::text AS raw_acl
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
JOIN pg_catalog.pg_roles AS owner ON owner.oid = t.typowner
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast|temp)_'
ORDER BY n.nspname, t.typname, t.oid
LIMIT 501;
~~~

### Q17 — global and per-schema default ACLs

~~~sql
SELECT owner.rolname AS object_owner, n.nspname AS schema_name, d.defaclobjtype,
       d.defaclacl::text AS raw_default_acl
FROM pg_catalog.pg_default_acl AS d
JOIN pg_catalog.pg_roles AS owner ON owner.oid = d.defaclrole
LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
ORDER BY owner.rolname, n.nspname, d.defaclobjtype
LIMIT 501;
~~~

### Q18 — other ACL-bearing object classes, raw ACLs only

~~~sql
SELECT object_class, object_name, owner_name, raw_acl
FROM (
  SELECT 'foreign_data_wrapper'::text AS object_class, f.fdwname::text AS object_name,
         owner.rolname::text AS owner_name, f.fdwacl::text AS raw_acl
  FROM pg_catalog.pg_foreign_data_wrapper AS f
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = f.fdwowner
  UNION ALL
  SELECT 'foreign_server', s.srvname::text, owner.rolname::text, s.srvacl::text
  FROM pg_catalog.pg_foreign_server AS s
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = s.srvowner
  UNION ALL
  SELECT 'language', l.lanname::text, owner.rolname::text, l.lanacl::text
  FROM pg_catalog.pg_language AS l
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = l.lanowner
  UNION ALL
  SELECT 'large_object', lom.oid::text, owner.rolname::text, lom.lomacl::text
  FROM pg_catalog.pg_largeobject_metadata AS lom
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = lom.lomowner
  UNION ALL
  SELECT 'tablespace', t.spcname::text, owner.rolname::text, t.spcacl::text
  FROM pg_catalog.pg_tablespace AS t
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = t.spcowner
  UNION ALL
  SELECT 'configuration_parameter', p.parname::text, NULL::text, p.paracl::text
  FROM pg_catalog.pg_parameter_acl AS p
) AS acl_inventory
ORDER BY object_class, object_name
LIMIT 501;
~~~

### Q19 — information-schema table privilege cross-check

~~~sql
SELECT table_catalog, table_schema, table_name, grantor, grantee, privilege_type, is_grantable
FROM information_schema.table_privileges
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_schema !~ '^pg_(toast|temp)_'
ORDER BY table_catalog, table_schema, table_name, grantor, grantee, privilege_type
LIMIT 501;
~~~

### Q20 — information-schema column privilege cross-check

~~~sql
SELECT table_catalog, table_schema, table_name, column_name, grantor, grantee, privilege_type, is_grantable
FROM information_schema.column_privileges
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_schema !~ '^pg_(toast|temp)_'
ORDER BY table_catalog, table_schema, table_name, column_name, grantor, grantee, privilege_type
LIMIT 501;
~~~

### Q21 — information-schema routine privilege cross-check

~~~sql
SELECT routine_catalog, routine_schema, routine_name, grantor, grantee, privilege_type, is_grantable
FROM information_schema.routine_privileges
WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
  AND routine_schema !~ '^pg_(toast|temp)_'
ORDER BY routine_catalog, routine_schema, routine_name, grantor, grantee, privilege_type
LIMIT 501;
~~~

### Q22 — information-schema USAGE privilege cross-check

~~~sql
SELECT object_catalog, object_schema, object_name, object_type, grantor, grantee, privilege_type, is_grantable
FROM information_schema.usage_privileges
WHERE object_schema IS NULL
   OR object_schema = ''
   OR (object_schema NOT IN ('pg_catalog', 'information_schema')
       AND object_schema !~ '^pg_(toast|temp)_')
ORDER BY object_catalog, object_schema, object_name, object_type, grantor, grantee
LIMIT 501;
~~~

### Q23 — safe-name inventory for relation-owned secondary objects

~~~sql
SELECT object_class, schema_name, object_name, object_oid, parent_oid
FROM (
  SELECT 'trigger'::text AS object_class, n.nspname::text AS schema_name,
         t.tgname::text AS object_name, t.oid::text AS object_oid, c.oid::text AS parent_oid
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
  UNION ALL
  SELECT 'constraint', n.nspname::text, con.conname::text, con.oid::text,
         COALESCE(con.conrelid, con.contypid)::text
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_namespace AS n ON n.oid = con.connamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
  UNION ALL
  SELECT 'policy', n.nspname::text, p.polname::text, p.oid::text, c.oid::text
  FROM pg_catalog.pg_policy AS p
  JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
  UNION ALL
  SELECT 'rewrite_rule', n.nspname::text, r.rulename::text, r.oid::text, c.oid::text
  FROM pg_catalog.pg_rewrite AS r
  JOIN pg_catalog.pg_class AS c ON c.oid = r.ev_class
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
) AS secondary_objects
ORDER BY object_class, schema_name, object_name, object_oid
LIMIT 501;
~~~

### Q24 — event/publication/subscription/user-mapping names and ownership identities

~~~sql
SELECT object_class, object_name, object_oid, owner_or_grantee
FROM (
  SELECT 'event_trigger'::text AS object_class, e.evtname::text AS object_name,
         e.oid::text AS object_oid, owner.rolname::text AS owner_or_grantee
  FROM pg_catalog.pg_event_trigger AS e
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = e.evtowner
  UNION ALL
  SELECT 'publication', p.pubname::text, p.oid::text, owner.rolname::text
  FROM pg_catalog.pg_publication AS p
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = p.pubowner
  UNION ALL
  SELECT 'subscription', s.subname::text, s.oid::text, owner.rolname::text
  FROM pg_catalog.pg_subscription AS s
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = s.subowner
  UNION ALL
  SELECT 'user_mapping', COALESCE(m.usename::text, 'PUBLIC') || '@' || m.srvname::text,
         m.umid::text, COALESCE(m.usename::text, 'PUBLIC')
  FROM pg_catalog.pg_user_mappings AS m
) AS named_objects
ORDER BY object_class, object_name
LIMIT 501;
~~~

### Q25 — migration ledger object presence only

~~~sql
SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = '__drizzle_migrations'
ORDER BY c.relname, c.relkind
LIMIT 2;
~~~

### Q26 — target-role effective privileges for core migration object classes

~~~sql
WITH target_role AS (
  SELECT rolname
  FROM pg_catalog.pg_roles
  WHERE rolname = 'karturt_staging_owner'
), effective AS (
  SELECT 'database'::text AS object_class, d.datname::text AS object_identity,
         p.privilege_type, pg_catalog.has_database_privilege(r.rolname, d.oid, p.privilege_type) AS effective
  FROM pg_catalog.pg_database AS d
  CROSS JOIN target_role AS r
  CROSS JOIN (VALUES ('CONNECT'::text), ('CREATE'), ('TEMPORARY')) AS p(privilege_type)
  UNION ALL
  SELECT 'schema', n.nspname::text, p.privilege_type,
         pg_catalog.has_schema_privilege(r.rolname, n.oid, p.privilege_type)
  FROM pg_catalog.pg_namespace AS n
  CROSS JOIN target_role AS r
  CROSS JOIN (VALUES ('USAGE'::text), ('CREATE')) AS p(privilege_type)
  UNION ALL
  SELECT 'table', n.nspname::text || '.' || c.relname::text, p.privilege_type,
         pg_catalog.has_table_privilege(r.rolname, c.oid, p.privilege_type)
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN target_role AS r
  CROSS JOIN (VALUES ('SELECT'::text), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                     ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege_type)
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
  UNION ALL
  SELECT 'column', n.nspname::text || '.' || c.relname::text || '.' || a.attname::text,
         p.privilege_type,
         pg_catalog.has_column_privilege(r.rolname, c.oid, a.attname, p.privilege_type)
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN target_role AS r
  CROSS JOIN (VALUES ('SELECT'::text), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(privilege_type)
  WHERE a.attnum > 0
    AND NOT a.attisdropped
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
  UNION ALL
  SELECT 'sequence', n.nspname::text || '.' || c.relname::text, p.privilege_type,
         pg_catalog.has_sequence_privilege(r.rolname, c.oid, p.privilege_type)
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN target_role AS r
  CROSS JOIN (VALUES ('USAGE'::text), ('SELECT'), ('UPDATE')) AS p(privilege_type)
  WHERE c.relkind = 'S'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
  UNION ALL
  SELECT 'routine', n.nspname::text || '.' || p0.proname::text || '#' || p0.oid::text,
         'EXECUTE'::text, pg_catalog.has_function_privilege(r.rolname, p0.oid, 'EXECUTE')
  FROM pg_catalog.pg_proc AS p0
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p0.pronamespace
  CROSS JOIN target_role AS r
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
  UNION ALL
  SELECT 'type', n.nspname::text || '.' || t.typname::text || '#' || t.oid::text,
         'USAGE'::text, pg_catalog.has_type_privilege(r.rolname, t.oid, 'USAGE')
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  CROSS JOIN target_role AS r
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_(toast|temp)_'
)
SELECT object_class, object_identity, privilege_type, effective
FROM effective
ORDER BY object_class, object_identity, privilege_type
LIMIT 501;
~~~

## Fingerprints

Statement count: **26**.

Per-statement SHA-256 is computed over the exact UTF-8 SQL body shown above, after normalizing line endings to LF and excluding the fence lines and the single delimiter newline immediately before each closing fence. No trimming or SQL reformatting is allowed.

| ID | SHA-256 |
| --- | --- |
| Q01 | 2ecf929aacec3a7cdfece349d6f84e2bda7cd6959bd1753c2630e3652228cfed |
| Q02 | 828e9669ed6c2da0d3a46dbc50b10ee40968f28acb772c2ef9b4131280c02703 |
| Q03 | 314f738d3502208f82fe03402fbca86cccdad304375e4a398e1a3a2cac9099ec |
| Q04 | b6d83dc9272ccafa513a77b885da080bae4b697a4ba24b52bdd3b724a61bebf6 |
| Q05 | 2add41eebba5e09c4691ba031e6263edbd125b0fe159a9866fa271ae97340c7a |
| Q06 | b5f5b9a90fb114269feac229694dc5c68b0bbc71913b7315f49f7dda5b2431c4 |
| Q07 | 438cf1f84c136d3f853ceb96396b7825b8fb021778bf5b610351c3022fec4561 |
| Q08 | 39e6f2d7696d7120123b82ecdfc26a8ed30c7a431e5511051c4a28902a75aa18 |
| Q09 | 438aaeec6e0dc24acd958de973c79892553f74c0742121ecca742102eda121a6 |
| Q10 | 42f79f8ab7e1a7f1ba4050ae91206891640755d499f4420a1347b9fcc71de1f7 |
| Q11 | 002aec0172c1136d7448cfc019c22a24fa04a7c846273421424fc56a7b1c62bc |
| Q12 | 42fccee1ab6fad0408a32a6f77115cbc38759ae5e5a899a3e6507b14f951852c |
| Q13 | e621cacb48dac82f120fad0f4a92057ed93ff271dbd995a799abeb8f874dad57 |
| Q14 | 04c07fb5847d9c0b9d1de3be9fc4dadde2d7e4bd0df021384570e4665d760c11 |
| Q15 | 8251f79b1ccdfec1a5765704c1db9ef3e1f6389d21987d277c80c6d068565522 |
| Q16 | 4bc988aa02b5cbc81b47672a7b78228a6940d0b835c1b9d29c259bf28e0b7353 |
| Q17 | 86ca99347938861d32d1a7d703d28b600e41a6924e778fdc404b405e5edf183b |
| Q18 | 231141136588c09957b6eeffd18b4382dbde3619387c1cf7f96be91bfc6e56e6 |
| Q19 | e1699c4bbe1b1184dac92df7a57bbe68fd8215b0bab2767f13d40183f696af00 |
| Q20 | 870edd9231df9709b5663cd602616377332f229d7ee7699a9e6f648683d71aa4 |
| Q21 | 9ce5a77cf05535fc895a4dc06b1be8ed6cddabb2a90784efe0908369eee1307a |
| Q22 | 139eba9f7e51459da47ce69d0a0f5c96733b0b47b63b6cbed40be3f56cb9112e |
| Q23 | 24ee80b818a892ec86379bdc55f53dd1dea47d88f2c346fb2895ebc33ce9634e |
| Q24 | ffeb9101f76dc126a418ffe5a32591c8a47c1d09872dfdbbea9a011862c86d21 |
| Q25 | c658cdb1dc9f3d86a2775146a7bcb6e4c46b7eeed4ea278da35a94b33f745c09 |
| Q26 | 8b988754ba9efe5d2ab89652eba5ed08d21f0afd56065c41dfa0ab53698f277c |

The ordered manifest is one LF-terminated line per statement in the form Qnn:<statement SHA-256>. Its SHA-256 is **ae6364e8a2b02d73fb7b4747166eae2995345912e0f294be066b28e7ad62752d**. The manifest is only a fingerprint for review; it is not an approval token or signature.

## Classification and stop rules

Classification is fail-closed:

| Classification | Required interpretation |
| --- | --- |
| CLEAN_CATALOG_PREFLIGHT | Only an owner-approved future run may use this label, and only when target binding, actual connector/session behavior, read-only guard, PG18 guard, all result sets, output caps, explicit allowlist, and ACL/ownership reconciliation all pass. It means the bounded catalog evidence matches the approved migration-security baseline; it does not prove physical database emptiness or complete cluster-wide privilege-universe coverage. |
| UNCLEAN | A complete, correctly bound packet shows a known object, role, owner, ACL, grant option, extension, or secondary object outside the exact owner-approved allowlist/baseline. Stop; no cleanup or remediation SQL is included. |
| UNKNOWN | Wrong or unverifiable target/session/version; failed guard; connector semantics not proven; any SQL error, partial/missing/truncated result, 501-row cap reached (2 for Q25), unreadable catalog, inconsistent cross-check, or privilege/effective-access question not reconciled. Stop. |

Always stop on any mismatch, error, timeout, cancellation uncertainty, result truncation, missing statement result, unexpected catalog entry, unexpected schema/role/grant, or disagreement between raw ACLs and cross-checks. Do not continue after an error, use savepoints to continue, or retry on a different target. An aborted transaction must be rolled back, with rollback outcome recorded. Any future rerun is a new separately approved decision.

## Coverage boundary

The SQL captures direct raw ACL text and grant options for databases, schemas, pg_class relations including sequences, explicit column ACLs, routines, types, default ACLs, FDWs, foreign servers, languages, large-object metadata, tablespaces, and configuration parameters. Q26 uses PostgreSQL built-in has_*_privilege checks to report target-role effective booleans for database, schema, table (including MAINTAIN), column, sequence, routine, and type privileges. Role membership records include grantor and independent ADMIN/INHERIT/SET options; applicable_roles is a separate user-visible inheritance/applicability cross-check. Role attributes are output without credential material.

Raw ACLs are not the same as effective privileges. Effective access can also arise through ownership, PUBLIC, role membership, default hard-wired privileges, and applicable roles. Q26 calculates effective booleans for the fixed target role on the listed core object classes; it uses only PostgreSQL built-in privilege-check functions, not user-defined functions. The packet does not calculate effective booleans for every grantable class or every cluster object. Information-schema views are filtered cross-checks for the connected user and are not full ACL inventories. Q26 is bounded to the target role and core migration object classes; raw ACL and ownership evidence remains necessary to explain each result. PostgreSQL 18 table_privileges does not list MAINTAIN; the direct relation ACL is the evidence source for it. The information-schema usage view does not show sequence SELECT/UPDATE. These facts require raw ACL reconciliation under an owner-approved baseline; unresolved cases are UNKNOWN.

This is not a complete cluster-wide inventory. In particular it does not enumerate every database-local object class or every extension-owned object, role/database setting value, tablespace configuration, foreign object options, publications' per-table membership, subscription contents, or server-side provider/network policy. Such values/options are intentionally excluded to avoid definitions, application content, credentials, or secret-bearing configuration. Catalog visibility and provider-specific restrictions can also hide or reject evidence. A clean bounded result therefore cannot be presented as proof of cluster-wide privilege-universe completeness, lineage, physical emptiness, or unauthenticated access.

The expected migration baseline must be frozen separately by the owner before execution. At minimum, it must define the exact expected role/role-edge state, schemas, extension set, owners, privilege/grant-option baseline, allowed user objects, and exact ledger-object expectation. There is no query that silently joins the earlier D1 packet. stagingIsolationVerifiedEmpty=false and PINNED_STAGING_MIGRATION_APPROVAL_PUBLIC_KEY_PEM=null remain unchanged. This wave ends before D1v2 live execution, D2, or D3.

## PostgreSQL 18 source references

- [GRANT and privilege kinds](https://www.postgresql.org/docs/18/sql-grant.html)
- [Role membership catalog](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html)
- [Role attributes](https://www.postgresql.org/docs/18/role-attributes.html)
- [Database catalog](https://www.postgresql.org/docs/18/catalog-pg-database.html)
- [Schema catalog](https://www.postgresql.org/docs/18/catalog-pg-namespace.html)
- [Relation catalog](https://www.postgresql.org/docs/18/catalog-pg-class.html)
- [Column catalog](https://www.postgresql.org/docs/18/catalog-pg-attribute.html)
- [Routine catalog](https://www.postgresql.org/docs/18/catalog-pg-proc.html)
- [Type catalog](https://www.postgresql.org/docs/18/catalog-pg-type.html)
- [Default ACL catalog](https://www.postgresql.org/docs/18/catalog-pg-default-acl.html)
- [Configuration-parameter ACL catalog](https://www.postgresql.org/docs/18/catalog-pg-parameter-acl.html)
- [Public user-mapping view](https://www.postgresql.org/docs/18/view-pg-user-mappings.html)
- [Information-schema applicable_roles](https://www.postgresql.org/docs/18/infoschema-applicable-roles.html)
- [Information-schema table_privileges](https://www.postgresql.org/docs/18/infoschema-table-privileges.html)
- [Information-schema usage_privileges](https://www.postgresql.org/docs/18/infoschema-usage-privileges.html)
- [SET TRANSACTION](https://www.postgresql.org/docs/18/sql-set-transaction.html)
