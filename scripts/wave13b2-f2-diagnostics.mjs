function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export const WAVE13B2_F2_CONNECTION_CHECKS = Object.freeze([
  Object.freeze({ flag: 'f2_target_project_id_matches', sourceAlias: 'target_project_id_matches', predicate: ":'target_project_id' = 'broad-star-40451875'", passLabel: 'TARGET_PROJECT_ID', failCode: 'TARGET_PROJECT_ID_MISMATCH' }),
  Object.freeze({ flag: 'f2_target_branch_id_matches', sourceAlias: 'target_branch_id_matches', predicate: ":'target_branch_id' = 'br-orange-recipe-azed9f78'", passLabel: 'TARGET_BRANCH_ID', failCode: 'TARGET_BRANCH_ID_MISMATCH' }),
  Object.freeze({ flag: 'f2_target_endpoint_id_matches', sourceAlias: 'target_endpoint_id_matches', predicate: ":'target_endpoint_id' = 'ep-mute-firefly-azjcru4h'", passLabel: 'TARGET_ENDPOINT_ID', failCode: 'TARGET_ENDPOINT_ID_MISMATCH' }),
  Object.freeze({ flag: 'f2_query_packet_sha256_format_valid', sourceAlias: 'query_packet_sha256_format_valid', predicate: ":'query_packet_sha256' ~ '^[a-f0-9]{64}$'", passLabel: 'QUERY_PACKET_SHA256_FORMAT', failCode: 'QUERY_PACKET_SHA256_FORMAT_INVALID' }),
  Object.freeze({ flag: 'f2_approved_source_sha_format_valid', sourceAlias: 'approved_source_sha_format_valid', predicate: ":'approved_source_sha' ~ '^[a-f0-9]{40}$'", passLabel: 'APPROVED_SOURCE_SHA_FORMAT', failCode: 'APPROVED_SOURCE_SHA_FORMAT_INVALID' }),
  Object.freeze({ flag: 'f2_database_name_matches', sourceAlias: 'database_name_matches', predicate: "current_database() = :'expected_database'", passLabel: 'DATABASE_NAME', failCode: 'DATABASE_NAME_MISMATCH' }),
  Object.freeze({ flag: 'f2_owner_role_matches', sourceAlias: 'owner_role_matches', predicate: "current_user = :'expected_owner_role'", passLabel: 'OWNER_ROLE', failCode: 'OWNER_ROLE_MISMATCH' }),
  Object.freeze({ flag: 'f2_postgres_major_is_18', sourceAlias: 'postgres_major_is_18', predicate: "current_setting('server_version_num')::integer / 10000 = 18", passLabel: 'POSTGRES_MAJOR', failCode: 'POSTGRES_MAJOR_NOT_18' }),
  Object.freeze({ flag: 'f2_transaction_is_read_only', sourceAlias: 'transaction_is_read_only', predicate: "current_setting('transaction_read_only') = 'on'", passLabel: 'TRANSACTION_READ_ONLY', failCode: 'TRANSACTION_NOT_READ_ONLY' }),
  Object.freeze({ flag: 'f2_tls_is_active', sourceAlias: 'tls_is_active', predicate: "EXISTS (\n      SELECT 1\n      FROM pg_catalog.pg_stat_ssl AS ssl\n      WHERE ssl.pid = pg_catalog.pg_backend_pid()\n        AND ssl.ssl\n    )", passLabel: 'TLS_ACTIVE', failCode: 'TLS_NOT_ACTIVE' }),
]);

export const WAVE13B2_F2_OUTPUT_GATES = Object.freeze([
  Object.freeze({
    id: 'membership',
    flag: 'f2_membership_output_allowed',
    countVariable: 'f2_membership_count',
    limit: 100,
    checkLine: '\\echo F2_CHECK ROLE_MEMBERSHIP_OUTPUT_LIMIT count=:f2_membership_count limit=100',
    failCode: 'ROLE_MEMBERSHIP_OUTPUT_LIMIT_EXCEEDED',
    nextSqlMarker: 'SELECT\n  parent_role.rolname AS membership_role',
  }),
  Object.freeze({
    id: 'schema',
    flag: 'f2_schema_output_allowed',
    countVariable: 'f2_schema_count',
    limit: 200,
    checkLine: '\\echo F2_CHECK SCHEMA_OUTPUT_LIMIT count=:f2_schema_count limit=200',
    failCode: 'SCHEMA_OUTPUT_LIMIT_EXCEEDED',
    nextSqlMarker: 'SELECT\n  n.nspname AS schema_name,\n  pg_catalog.pg_get_userbyid(n.nspowner)',
  }),
  Object.freeze({
    id: 'relation',
    flag: 'f2_relation_output_allowed',
    countVariable: 'f2_relation_count',
    limit: 200,
    checkLine: '\\echo F2_CHECK RELATION_OUTPUT_LIMIT count=:f2_relation_count limit=200',
    failCode: 'RELATION_OUTPUT_LIMIT_EXCEEDED',
    nextSqlMarker: 'SELECT\n  n.nspname AS schema_name,\n  c.relname AS relation_name',
  }),
  Object.freeze({
    id: 'type',
    flag: 'f2_type_output_allowed',
    countVariable: 'f2_type_count',
    limit: 200,
    checkLine: '\\echo F2_CHECK TYPE_OUTPUT_LIMIT count=:f2_type_count limit=200',
    failCode: 'TYPE_OUTPUT_LIMIT_EXCEEDED',
    nextSqlMarker: 'SELECT\n  count(*) AS f2_standalone_application_type_count',
  }),
  Object.freeze({
    id: 'standaloneTypes',
    flag: 'f2_empty_baseline_types_allowed',
    countVariable: 'f2_standalone_application_type_count',
    limit: 0,
    checkLine: '\\echo F2_CHECK EMPTY_BASELINE_STANDALONE_TYPES count=:f2_standalone_application_type_count expected=0',
    failCode: 'UNEXPECTED_STANDALONE_APPLICATION_TYPES',
    nextSqlMarker: 'SELECT\n  n.nspname AS schema_name,\n  t.typname AS type_name',
  }),
  Object.freeze({
    id: 'routine',
    flag: 'f2_routine_output_allowed',
    countVariable: 'f2_routine_count',
    limit: 200,
    checkLine: '\\echo F2_CHECK ROUTINE_OUTPUT_LIMIT count=:f2_routine_count limit=200',
    failCode: 'ROUTINE_OUTPUT_LIMIT_EXCEEDED',
    nextSqlMarker: 'SELECT\n  n.nspname AS schema_name,\n  p.proname AS routine_name',
  }),
  Object.freeze({
    id: 'extension',
    flag: 'f2_extension_output_allowed',
    countVariable: 'f2_extension_count',
    limit: 100,
    checkLine: '\\echo F2_CHECK EXTENSION_OUTPUT_LIMIT count=:f2_extension_count limit=100',
    failCode: 'EXTENSION_OUTPUT_LIMIT_EXCEEDED',
    nextSqlMarker: 'SELECT\n  e.extname AS extension_name',
  }),
  Object.freeze({
    id: 'defaultAcl',
    flag: 'f2_default_acl_output_allowed',
    countVariable: 'f2_default_acl_count',
    limit: 100,
    checkLine: '\\echo F2_CHECK DEFAULT_ACL_OUTPUT_LIMIT count=:f2_default_acl_count limit=100',
    failCode: 'DEFAULT_ACL_OUTPUT_LIMIT_EXCEEDED',
    nextSqlMarker: 'SELECT\n  pg_catalog.pg_get_userbyid(d.defaclrole)',
  }),
]);

export function getWave13B2F2ConnectionFailureCodes(observations) {
  const values = observations && typeof observations === 'object' ? observations : {};
  return WAVE13B2_F2_CONNECTION_CHECKS
    .filter(({ flag }) => values[flag] !== true)
    .map(({ failCode }) => failCode);
}

export function getWave13B2F2OutputFailureCode(gateId, observedCount) {
  const gate = WAVE13B2_F2_OUTPUT_GATES.find(({ id }) => id === gateId);
  if (!gate) throw new Error('unknown F2 output gate');
  if (!Number.isSafeInteger(observedCount) || observedCount < 0) return 'F2_OUTPUT_COUNT_UNAVAILABLE';
  return observedCount > gate.limit ? gate.failCode : null;
}

export function assertWave13B2F2DiagnosticContract(queryText) {
  requireCondition(typeof queryText === 'string', 'F2 query text is required');
  requireCondition(!/SELECT\s+1\s*\/\s*CASE\s+WHEN/i.test(queryText), 'division sentinels are forbidden in F2 gates');

  const connectionStart = queryText.indexOf('WITH f2_connection_checks AS');
  const connectionStop = queryText.indexOf("F2_STOP CONNECTION_GUARD_FAILED CATALOG_QUERIES_SKIPPED");
  const connectionQuit = queryText.indexOf('\\quit 3', connectionStop);
  const firstCatalogRead = queryText.indexOf('SELECT\n  current_database() AS observed_database_name');
  requireCondition(connectionStart >= 0 && connectionStop > connectionStart && connectionQuit > connectionStop, 'connection guard must report and stop on failure');
  requireCondition(firstCatalogRead > connectionQuit, 'catalog inspection must follow the connection guard');
  requireCondition(/F2_STOP CONNECTION_GUARD_FAILED CATALOG_QUERIES_SKIPPED'?\r?\n\\quit 3\r?\n\\endif/.test(queryText.slice(connectionStop, firstCatalogRead)), 'connection failure branch must quit immediately');

  const normalizeSql = (value) => value.replace(/\s+/g, ' ').trim();
  const publicSelectStart = queryText.indexOf('SELECT\n  target_project_id_matches AS', connectionStart);
  const cteFrom = queryText.indexOf('FROM f2_connection_checks', publicSelectStart);
  requireCondition(publicSelectStart > connectionStart && cteFrom > publicSelectStart && connectionStop > cteFrom, 'connection-check CTE shape is missing');
  const connectionCte = normalizeSql(queryText.slice(connectionStart, publicSelectStart));
  const publicFlags = normalizeSql(queryText.slice(publicSelectStart, connectionStop));
  let previousFailurePosition = connectionStart;
  for (const check of WAVE13B2_F2_CONNECTION_CHECKS) {
    const alias = 'AS ' + check.flag;
    const passLine = 'F2_CHECK ' + check.passLabel + ' PASS';
    const failLine = 'F2_FAIL ' + check.failCode;
    const aliasPosition = queryText.indexOf(alias, connectionStart);
    const predicatePosition = queryText.indexOf(check.predicate, connectionStart);
    const branchPosition = queryText.indexOf('\\if :' + check.flag, connectionStart);
    const passPosition = queryText.indexOf(passLine, connectionStart);
    const elsePosition = queryText.indexOf('\\else', passPosition);
    const failPosition = queryText.indexOf(failLine, connectionStart);
    requireCondition(connectionCte.includes(normalizeSql(check.predicate + ' AS ' + check.sourceAlias)), 'connection predicate is not bound to its named CTE alias: ' + check.flag);
    requireCondition(publicFlags.includes(normalizeSql(check.sourceAlias + ' AS ' + check.flag)), 'connection CTE alias is not bound to its public flag: ' + check.flag);
    requireCondition(predicatePosition >= connectionStart && predicatePosition < aliasPosition, 'missing or changed connection predicate: ' + check.flag);
    requireCondition(aliasPosition >= connectionStart && aliasPosition < connectionStop, 'missing connection-check flag: ' + check.flag);
    requireCondition(branchPosition > previousFailurePosition && branchPosition < connectionStop, 'missing or reordered connection branch: ' + check.flag);
    requireCondition(passPosition > branchPosition && passPosition < connectionStop, 'missing or reordered PASS diagnostic: ' + check.passLabel);
    requireCondition(elsePosition > passPosition && elsePosition < connectionStop, 'missing connection failure branch: ' + check.failCode);
    requireCondition(failPosition > elsePosition && failPosition < connectionStop, 'missing or reordered FAIL diagnostic: ' + check.failCode);
    previousFailurePosition = failPosition;
  }

  const connectionDiagnostics = queryText.slice(connectionStart, firstCatalogRead);
  requireCondition(!/PGPASSWORD|PGPASSFILE|PGSSLROOTCERT|PGHOST|postgres(?:ql)?:\/\//i.test(connectionDiagnostics), 'connection diagnostics must not expose credentials or connection strings');

  for (const gate of WAVE13B2_F2_OUTPUT_GATES) {
    const aliasPosition = queryText.indexOf('AS ' + gate.flag);
    const checkPosition = queryText.indexOf(gate.checkLine);
    const countPosition = queryText.indexOf('count(*) AS ' + gate.countVariable);
    const allowedExpression = gate.limit === 0
      ? 'count(*) = 0 AS ' + gate.flag
      : 'count(*) <= ' + gate.limit + ' AS ' + gate.flag;
    const allowedPosition = queryText.indexOf(allowedExpression, countPosition);
    const failPosition = queryText.indexOf('F2_FAIL ' + gate.failCode);
    const stopPosition = queryText.indexOf('F2_STOP CATALOG_QUERIES_SKIPPED', failPosition);
    const quitPosition = queryText.indexOf('\\quit 3', failPosition);
    const nextReadPosition = queryText.indexOf(gate.nextSqlMarker, failPosition);
    requireCondition(aliasPosition >= 0 && countPosition >= 0 && allowedPosition > countPosition, 'missing output-gate count expression: ' + gate.id);
    requireCondition(checkPosition > allowedPosition, 'missing or reordered output-gate count diagnostic: ' + gate.id);
    requireCondition(failPosition > checkPosition && stopPosition > failPosition && quitPosition > stopPosition, 'missing output-gate stop: ' + gate.failCode);
    const outputFailureBlock = queryText.slice(failPosition, nextReadPosition);
    requireCondition(new RegExp('F2_FAIL ' + gate.failCode + '\\r?\\n\\\\echo F2_STOP CATALOG_QUERIES_SKIPPED\\r?\\n\\\\quit 3\\r?\\n\\\\endif').test(outputFailureBlock), 'output failure branch must quit immediately: ' + gate.id);
    requireCondition(nextReadPosition > quitPosition, 'output-gate failure must stop before the next catalog query: ' + gate.id);
  }

  return true;
}
