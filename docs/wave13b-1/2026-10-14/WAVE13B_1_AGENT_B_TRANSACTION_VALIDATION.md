# Wave 13B.1 Agent B - Transaction and SQL Validation

Date: 2026-10-14
Result: SQL_CONTRACT_BLOCKED
SQL/provider-query calls made: none

## Pinned reference integrity

The reference SQL was checked against blob SHA-1 78501ab327bdc7b7a9a06a0a0f66fe039fc8d148. It has 29 fenced SQL blocks in the approved order. The first is the read-only transaction command; the second is an erroring identity/read-only guard; the third displays transaction_read_only; the remaining 26 are catalog SELECT statements.

The exact SQL sequence was not edited, executed, split, or retried. Static review found no DDL, DML, application-row reads, object definitions, large-object contents, credentials, dynamic SQL, or user routine calls.

## Transaction contract

The available run_sql_transaction description says it executes multiple SQL statements as one transaction and exposes explicit target fields. It does not document whether all statements use one backend session or whether execution stops and aborts the transaction on the first statement error. Neither property can be inferred from the phrase "one transaction."

D1 requires both properties to be established before the only permitted SQL call. Because the connector contract did not establish them, this lane returns SQL_CONTRACT_BLOCKED. No exploratory query was used to test the connector.

Neon compute resumption can occur when a query reaches a suspended endpoint; D1 allowed a possible wake for its one approved call. A possible wake was not the reason for this stop. The unresolved session and error-abort semantics were.

## Evidence boundary

The exact SQL may run in a transaction, but that alone does not establish the approved failure behavior. Agent C also identified inventory gaps in the pinned query set; see the independent evidence review. This lane does not claim SQL grants or database contents.
