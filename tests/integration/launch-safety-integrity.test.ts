import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { runChecks } from "../../scripts/launch-safety-integrity";
import { createTestDatabase } from "../helpers/database";

const schema = `
CREATE TABLE monthly_dues(id text,rt_unit_id text,household_id text,billing_year_id text,month int,status text,waived_reason text,amount numeric,fee_rate_id text);
CREATE TABLE due_adjustments(id text,monthly_due_id text,rt_unit_id text,household_id text,amount_delta numeric,created_at timestamptz,adjusted_by_account_id text,adjusted_by_account_type text);
CREATE TABLE payment_allocations(id text,payment_id text,rt_unit_id text,household_id text,monthly_due_id text,amount numeric,payment_request_id text);
CREATE TABLE payments(id text,rt_unit_id text,household_id text,amount numeric,payment_request_id text,verified_by_account_id text,verified_by_account_type text);
CREATE TABLE payment_reversals(payment_id text,rt_unit_id text,household_id text,reversed_by_account_id text,reversed_by_account_type text);
CREATE TABLE active_due_settlements(allocation_id text,payment_id text,rt_unit_id text,household_id text,monthly_due_id text,amount numeric);
CREATE TABLE payment_requests(id text,status text,item_count int,total_amount numeric,rt_unit_id text,household_id text,requested_by_account_id text,requested_by_account_type text,verified_by_account_id text,verified_by_account_type text,resolved_by_account_id text,resolved_by_account_type text);
CREATE TABLE payment_request_items(request_id text,rt_unit_id text,household_id text,monthly_due_id text,amount numeric);
CREATE TABLE payment_request_claims(request_id text,monthly_due_id text);
CREATE TABLE waiver_items(monthly_due_id text,rt_unit_id text,household_id text,waiver_action_id text,amount numeric,period text);
CREATE TABLE waiver_actions(id text,rt_unit_id text,household_id text,reason text,item_count int,total_amount numeric,waived_by_account_type text,waived_by_account_id text,created_at timestamptz);
CREATE TABLE billing_years(id text,rt_unit_id text,year int);
CREATE TABLE fee_rates(id text,rt_unit_id text,billing_year_id text,created_by_account_id text,created_by_account_type text);
CREATE TABLE app_accounts(id text,rt_unit_id text,household_id text,account_type text,status text,person_id text);
CREATE TABLE households(id text,rt_unit_id text,house_id text,starts_on date,ends_on date,status text);
CREATE TABLE people(id text,rt_unit_id text,household_id text,is_active boolean);
CREATE TABLE official_assignments(rt_unit_id text,app_account_id text,app_account_type text,role text,starts_on date,ends_on date);
CREATE TABLE audit_events(id text,action text,entity_type text,entity_id text,actor_app_account_id text,reason text,context jsonb);
`;

type Scenario = { category: string; sql: string; allowedOverlap?: Array<[string, number]>; expectedCount?: number };
const scenarios: Scenario[] = [
  { category: "pending_request_invalid_due_state", sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'unpaid',null,10,null);
    INSERT INTO payment_requests VALUES ('q','pending',1,9,'r','h','requester','resident',null,null,null,null); INSERT INTO payment_request_items VALUES ('q','r','h','d',9);
    INSERT INTO payment_request_claims VALUES ('q','d');` },
  { category: "paid_due_without_exact_active_settlement", allowedOverlap: [["active_received_over_effective_target", 1]], sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'paid',null,10,null);
    INSERT INTO payment_requests VALUES ('q','cancelled',1,10,'r','h','requester','resident',null,null,null,null); INSERT INTO payment_request_items VALUES ('q','r','h','d',10);
    INSERT INTO payments(id,rt_unit_id,household_id,amount,payment_request_id,verified_by_account_id,verified_by_account_type) VALUES ('p','r','h',10,'q','official','official'); INSERT INTO payment_allocations VALUES ('a','p','r','h','d',10,'q');` },
  { category: "paid_due_unexplained_balance", sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'paid',null,10,null);
    INSERT INTO payment_requests VALUES ('q','cancelled',1,5,'r','h','requester','resident',null,null,null,null); INSERT INTO payment_request_items VALUES ('q','r','h','d',5);
    INSERT INTO payments(id,rt_unit_id,household_id,amount,payment_request_id,verified_by_account_id,verified_by_account_type) VALUES ('p','r','h',5,'q','official','official'); INSERT INTO payment_allocations VALUES ('a','p','r','h','d',5,'q');
    INSERT INTO active_due_settlements VALUES ('a','p','r','h','d',5);` },
  { category: "verified_request_payment_allocation_mismatch", sql: `INSERT INTO payment_requests VALUES ('q','verified',1,10,'r','h','requester','resident',null,null,null,null);` },
  { category: "payment_allocation_mismatch", allowedOverlap: [["cross_rt_financial_scope_mismatch", 1]], sql: `INSERT INTO app_accounts VALUES ('foreign-official','other-rt',null,'official','active',null);
    INSERT INTO payment_requests VALUES ('q','cancelled',0,0,'r','h','requester','resident',null,null,null,null);
    INSERT INTO payments(id,rt_unit_id,household_id,amount,payment_request_id,verified_by_account_id,verified_by_account_type) VALUES ('p','r','h',10,'q','foreign-official','official');` },
  { category: "active_received_over_effective_target", sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'unpaid',null,10,null);
    INSERT INTO payment_requests VALUES ('q','cancelled',1,11,'r','h','requester','resident',null,null,null,null); INSERT INTO payment_request_items VALUES ('q','r','h','d',11);
    INSERT INTO payments(id,rt_unit_id,household_id,amount,payment_request_id,verified_by_account_id,verified_by_account_type) VALUES ('p','r','h',11,'q','official','official'); INSERT INTO payment_allocations VALUES ('a','p','r','h','d',11,'q');` },
  { category: "reversed_payment_still_active", allowedOverlap: [["active_received_over_effective_target", 1]], sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'unpaid',null,10,null);
    INSERT INTO payment_requests VALUES ('q','cancelled',1,10,'r','h','requester','resident',null,null,null,null); INSERT INTO payment_request_items VALUES ('q','r','h','d',10);
    INSERT INTO payments(id,rt_unit_id,household_id,amount,payment_request_id,verified_by_account_id,verified_by_account_type) VALUES ('p','r','h',10,'q','official','official'); INSERT INTO payment_allocations VALUES ('a','p','r','h','d',10,'q');
    INSERT INTO payment_reversals(payment_id,rt_unit_id,household_id,reversed_by_account_id,reversed_by_account_type) VALUES ('p','r','h','official','official'); INSERT INTO active_due_settlements VALUES ('a','p','r','h','d',10);` },
  { category: "waived_ledger_or_activity_mismatch", sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'waived','reason',10,null);` },
  { category: "waived_ledger_or_activity_mismatch", sql: `INSERT INTO waiver_actions VALUES ('w','r','h','reason',1,10,'official','official','2020-01-01T00:00:00Z');` },
  { category: "waived_ledger_or_activity_mismatch", sql: `INSERT INTO waiver_actions VALUES ('w','r','h','reason',0,0,'resident','requester','2020-01-01T00:00:00Z');` },
  { category: "waived_ledger_or_activity_mismatch", sql: `INSERT INTO audit_events VALUES ('event','waiver.created','waiver_action','missing-action','official','reason','{}');` },
  { category: "waived_ledger_or_activity_mismatch", sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'waived','reason',10,null);
    INSERT INTO waiver_actions VALUES ('w','r','h','reason',1,10,'official','official','2020-01-01T00:00:00Z');
    INSERT INTO waiver_items VALUES ('d','r','h','w',10,'2020-01');
    INSERT INTO official_assignments VALUES ('r','official','official','rt_chairman','2000-01-01',null);
    INSERT INTO audit_events VALUES ('event','waiver.created','waiver_action','w','official','reason','{"itemCount":1,"totalAmount":10,"periods":"2020-01"}');
    INSERT INTO payment_requests VALUES ('q','cancelled',1,10,'r','h','requester','resident',null,null,null,null);
    INSERT INTO payment_request_items VALUES ('q','r','h','d',10);
    INSERT INTO payments(id,rt_unit_id,household_id,amount,payment_request_id,verified_by_account_id,verified_by_account_type) VALUES ('p','r','h',10,'q','official','official');
    INSERT INTO payment_allocations VALUES ('a','p','r','h','d',10,'q');
    INSERT INTO active_due_settlements VALUES ('a','p','r','h','d',10);` },
  { category: "not_due_invalid_snapshot_or_activity", sql: `INSERT INTO monthly_dues VALUES ('d','r','h','y',1,'not_due',null,1,null);` },
  { category: "household_period_overlap", sql: `INSERT INTO households VALUES ('h1','r','x','2020-01-01',null,'inactive'),('h2','r','x','2021-01-01',null,'inactive');` },
  { category: "multiple_active_households_same_house", sql: `INSERT INTO households VALUES ('h1','r','x','2020-01-01','2020-12-31','active'),('h2','r','x','2021-01-01',null,'active');` },
  { category: "active_resident_linked_to_inactive_household", sql: `INSERT INTO households VALUES ('inactive-household','r','y','2020-01-01',null,'inactive');
    INSERT INTO people VALUES ('inactive-person','r','inactive-household',true); INSERT INTO app_accounts VALUES ('a','r','inactive-household','resident','active','inactive-person');` },
  { category: "active_resident_linked_to_inactive_person", sql: `INSERT INTO households VALUES ('person-household','r','z','2020-01-01',null,'active');
    INSERT INTO people VALUES ('p','r','wrong-household',false); INSERT INTO app_accounts VALUES ('a','r','person-household','resident','active','p');` },
  { category: "duplicate_current_treasurer_or_chairman", sql: `INSERT INTO app_accounts VALUES ('a','r',null,'official','active',null),('b','r',null,'official','active',null);
    INSERT INTO official_assignments VALUES ('r','a','official','treasurer','2020-01-01',null),('r','b','official','treasurer','2020-01-01',null);` },
  { category: "same_account_current_treasurer_and_chairman", sql: `INSERT INTO app_accounts VALUES ('a','r',null,'official','active',null);
    INSERT INTO official_assignments VALUES ('r','a','official','treasurer','2020-01-01',null),('r','a','official','rt_chairman','2020-01-01',null);` },
  { category: "cross_rt_financial_scope_mismatch", sql: `INSERT INTO households VALUES ('foreign-household','rt-a','x','2020-01-01',null,'active');
    INSERT INTO app_accounts VALUES ('foreign-official','rt-b',null,'official','active',null);
    INSERT INTO payment_requests VALUES ('q','cancelled',0,0,'rt-b','foreign-household',null,'resident','foreign-official','resident','foreign-official','resident');` },
  { category: "cross_rt_financial_scope_mismatch", sql: `INSERT INTO billing_years VALUES ('year-other','rt-b',2020);
    INSERT INTO monthly_dues VALUES ('due-household','rt-b','h','year-other',1,'not_due',null,0,null);` },
  { category: "cross_rt_financial_scope_mismatch", sql: `INSERT INTO billing_years VALUES ('year-other','rt-b',2020);
    INSERT INTO monthly_dues VALUES ('due-year','r','h','year-other',1,'not_due',null,0,null);` },
  { category: "cross_rt_financial_scope_mismatch", expectedCount: 2, sql: `INSERT INTO fee_rates VALUES ('fee-other','other-rt','y',null,null);
    INSERT INTO monthly_dues VALUES ('due-fee','r','h','y',1,'unpaid',null,10,'fee-other');` },
  { category: "cross_rt_financial_scope_mismatch", sql: `INSERT INTO fee_rates VALUES ('fee-year','other-rt','y',null,null);` },
];

describe("launch-safety integrity predicates (isolated local PGlite fixtures)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(schema);
    await db.exec("INSERT INTO billing_years VALUES ('y','r',2020)");
    await db.exec(`INSERT INTO households VALUES ('h','r','home','2000-01-01',null,'active');
      INSERT INTO people VALUES ('person','r','h',true);
      INSERT INTO app_accounts VALUES ('requester','r','h','resident','active','person'),('official','r',null,'official','active',null);`);
  });
  afterEach(async () => { await db.close(); });

  it("returns all sixteen zero counts for a clean fixture", async () => {
    const report = await runChecks(db, "local-fixture");
    expect(report.result).toBe("PASS");
    expect(report.totalChecks).toBe(16);
    expect(report.zeroAnomalyChecks).toBe(16);
    expect(report.anomalyCategories.every(({ count }) => count === 0)).toBe(true);
  });

  it("executes every category against the actual migrated local schema", async () => {
    const database = await createTestDatabase();
    try {
      const report = await runChecks(database.client, "local-fixture");
      expect(report.result).toBe("PASS");
      expect(report.zeroAnomalyChecks).toBe(16);
    } finally {
      await database.close();
    }
  });

  it.each(scenarios)("detects $category with only its defined overlaps", async ({ category, sql, allowedOverlap = [], expectedCount = 1 }) => {
    await db.exec(sql);
    const report = await runChecks(db, "local-fixture");
    expect(report.result).toBe("FAIL");
    expect(report.anomalyCategories.find(({ name }) => name === category)?.count).toBe(expectedCount);
    const actualOther = report.anomalyCategories.filter(({ name, count }) => name !== category && count !== 0).map(({ name, count }) => [name, count]);
    expect(actualOther).toEqual(allowedOverlap);
  });

  it("keeps combined category counts independent", async () => {
    for (const category of ["multiple_active_households_same_house", "active_resident_linked_to_inactive_household", "active_resident_linked_to_inactive_person"]) {
      await db.exec(scenarios.find((scenario) => scenario.category === category)!.sql);
    }
    const report = await runChecks(db, "local-fixture");
    expect(report.result).toBe("FAIL");
    expect(report.anomalyCategories.filter(({ count }) => count !== 0).map(({ name, count }) => [name, count])).toEqual([
      ["multiple_active_households_same_house", 1],
      ["active_resident_linked_to_inactive_household", 1],
      ["active_resident_linked_to_inactive_person", 1],
    ]);
  });
});
