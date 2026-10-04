import { loadEnvConfig } from "@next/env";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { requireDatabaseEnvironment } from "../src/lib/env";

export const integrityCategories = [
  ["I01", "pending_request_invalid_due_state", "HIGH"],
  ["I02", "paid_due_without_exact_active_settlement", "CRITICAL"],
  ["I03", "paid_due_unexplained_balance", "CRITICAL"],
  ["I04", "verified_request_payment_allocation_mismatch", "CRITICAL"],
  ["I05", "payment_allocation_mismatch", "CRITICAL"],
  ["I06", "active_received_over_effective_target", "CRITICAL"],
  ["I07", "reversed_payment_still_active", "CRITICAL"],
  ["I08", "waived_ledger_or_activity_mismatch", "CRITICAL"],
  ["I09", "not_due_invalid_snapshot_or_activity", "CRITICAL"],
  ["I10", "household_period_overlap", "HIGH"],
  ["I11", "multiple_active_households_same_house", "HIGH"],
  ["I12", "active_resident_linked_to_inactive_household", "HIGH"],
  ["I13", "active_resident_linked_to_inactive_person", "HIGH"],
  ["I14", "duplicate_current_treasurer_or_chairman", "HIGH"],
  ["I15", "same_account_current_treasurer_and_chairman", "HIGH"],
  ["I16", "cross_rt_financial_scope_mismatch", "CRITICAL"],
] as const;

type CategoryName = typeof integrityCategories[number][1];
type Check = { id: typeof integrityCategories[number][0]; name: CategoryName; severity: string; sql: string };
type QueryClient = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const expectedTarget = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  branchName: "karturt-development",
  endpointId: "ep-quiet-cake-azrhjiyh",
  database: "neondb",
  migrationCount: 14,
  migrationHeadHash: "994bcc9376b207fdc0668312cc68cab3c2cec46bc6101edc4c2b5ef7f51c4a85",
} as const;

const financial = `WITH adjustment_totals AS (
  SELECT monthly_due_id, sum(amount_delta)::numeric total FROM public.due_adjustments GROUP BY monthly_due_id
), receipts AS (
  SELECT a.monthly_due_id, sum(a.amount)::numeric received FROM public.payment_allocations a
  JOIN public.payments p ON p.id=a.payment_id AND p.rt_unit_id=a.rt_unit_id AND p.household_id=a.household_id
  WHERE NOT EXISTS (SELECT 1 FROM public.payment_reversals r WHERE r.payment_id=p.id) GROUP BY a.monthly_due_id
), dues AS (
  SELECT d.*, d.amount::numeric+coalesce(x.total,0) target, coalesce(r.received,0) received
  FROM public.monthly_dues d LEFT JOIN adjustment_totals x ON x.monthly_due_id=d.id
  LEFT JOIN receipts r ON r.monthly_due_id=d.id
)`;

const queryByName: Record<CategoryName, string> = {
  pending_request_invalid_due_state: `${financial}
    SELECT q.id entity FROM public.payment_requests q WHERE q.status='pending' AND (
      q.item_count <> (SELECT count(*) FROM public.payment_request_items i WHERE i.request_id=q.id)
      OR q.total_amount <> coalesce((SELECT sum(i.amount) FROM public.payment_request_items i WHERE i.request_id=q.id),0)
      OR NOT EXISTS (SELECT 1 FROM public.payment_request_items i WHERE i.request_id=q.id)
      OR EXISTS (SELECT 1 FROM public.payment_request_items i JOIN dues d ON d.id=i.monthly_due_id
        WHERE i.request_id=q.id AND (i.rt_unit_id<>q.rt_unit_id OR i.household_id<>q.household_id
          OR d.rt_unit_id<>q.rt_unit_id OR d.household_id<>q.household_id OR d.status<>'unpaid'
          OR d.target-d.received<=0 OR i.amount::numeric<>d.target-d.received
          OR NOT EXISTS (SELECT 1 FROM public.payment_request_claims c WHERE c.request_id=i.request_id AND c.monthly_due_id=i.monthly_due_id)))
      OR EXISTS (SELECT 1 FROM public.payment_request_claims c WHERE c.request_id=q.id AND NOT EXISTS
        (SELECT 1 FROM public.payment_request_items i WHERE i.request_id=c.request_id AND i.monthly_due_id=c.monthly_due_id)))`,
  paid_due_without_exact_active_settlement: `${financial}
    SELECT d.id entity FROM dues d WHERE d.status='paid' AND (d.target<=0 OR NOT EXISTS
      (SELECT 1 FROM public.active_due_settlements s WHERE s.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.payment_allocations a JOIN public.payments p ON p.id=a.payment_id
        WHERE a.monthly_due_id=d.id AND NOT EXISTS (SELECT 1 FROM public.payment_reversals r WHERE r.payment_id=p.id)
        AND (SELECT count(*) FROM public.active_due_settlements s WHERE s.allocation_id=a.id AND s.payment_id=a.payment_id
          AND s.rt_unit_id=a.rt_unit_id AND s.household_id=a.household_id AND s.monthly_due_id=a.monthly_due_id AND s.amount=a.amount)<>1)
      OR (SELECT coalesce(sum(s.amount),0)::numeric FROM public.active_due_settlements s WHERE s.monthly_due_id=d.id)<>d.received)`,
  paid_due_unexplained_balance: `${financial} SELECT id entity FROM dues WHERE status='paid' AND (target<=0 OR received<>target)`,
  verified_request_payment_allocation_mismatch: `SELECT q.id entity FROM public.payment_requests q
    LEFT JOIN LATERAL (SELECT count(*) n, min(amount) amount, coalesce(sum(amount),0) total FROM public.payments p
      WHERE p.payment_request_id=q.id AND p.rt_unit_id=q.rt_unit_id AND p.household_id=q.household_id) p ON true
    LEFT JOIN LATERAL (SELECT count(*) n, coalesce(sum(amount),0) total FROM public.payment_allocations a
      WHERE a.payment_request_id=q.id AND a.rt_unit_id=q.rt_unit_id AND a.household_id=q.household_id) a ON true
    WHERE q.status='verified' AND (p.n<>1 OR p.amount<>q.total_amount OR p.total<>q.total_amount OR a.n<>q.item_count OR a.total<>q.total_amount
      OR EXISTS (SELECT 1 FROM public.payment_request_items i WHERE i.request_id=q.id AND NOT EXISTS
        (SELECT 1 FROM public.payment_allocations x WHERE x.payment_request_id=i.request_id AND x.rt_unit_id=i.rt_unit_id
          AND x.household_id=i.household_id AND x.monthly_due_id=i.monthly_due_id AND x.amount=i.amount)))`,
  payment_allocation_mismatch: `SELECT 'payment:'||p.id::text entity FROM public.payments p LEFT JOIN public.payment_allocations a ON a.payment_id=p.id
    GROUP BY p.id,p.amount HAVING count(a.id)=0 OR coalesce(sum(a.amount),0)::numeric<>p.amount::numeric
      UNION SELECT 'duplicate:'||payment_id::text||':'||monthly_due_id::text entity FROM public.payment_allocations GROUP BY payment_id,monthly_due_id HAVING count(*)>1`,
  active_received_over_effective_target: `${financial} SELECT id entity FROM dues WHERE status IN ('paid','unpaid') AND (target<=0 OR received>target
    OR received<>(SELECT coalesce(sum(s.amount),0)::numeric FROM public.active_due_settlements s WHERE s.monthly_due_id=dues.id))`,
  reversed_payment_still_active: `SELECT DISTINCT s.payment_id entity FROM public.active_due_settlements s JOIN public.payment_reversals r ON r.payment_id=s.payment_id`,
  waived_ledger_or_activity_mismatch: `${financial}
    SELECT 'due:'||d.id::text entity FROM dues d WHERE d.status='waived' AND (
      (SELECT count(*) FROM public.waiver_items i WHERE i.monthly_due_id=d.id AND i.rt_unit_id=d.rt_unit_id AND i.household_id=d.household_id)<>1
      OR EXISTS (SELECT 1 FROM public.active_due_settlements s WHERE s.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.payment_allocations a JOIN public.payments p ON p.id=a.payment_id WHERE a.monthly_due_id=d.id
        AND NOT EXISTS (SELECT 1 FROM public.payment_reversals r WHERE r.payment_id=p.id))
      OR EXISTS (SELECT 1 FROM public.payment_request_claims c WHERE c.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.due_adjustments x JOIN public.waiver_items i ON i.monthly_due_id=x.monthly_due_id
        JOIN public.waiver_actions w ON w.id=i.waiver_action_id WHERE x.monthly_due_id=d.id AND x.created_at>w.created_at)
      OR EXISTS (SELECT 1 FROM public.waiver_items i LEFT JOIN public.waiver_actions w ON w.id=i.waiver_action_id
        LEFT JOIN public.billing_years y ON y.id=d.billing_year_id AND y.rt_unit_id=d.rt_unit_id
        LEFT JOIN public.app_accounts actor ON actor.id=w.waived_by_account_id AND actor.rt_unit_id=w.rt_unit_id AND actor.account_type=w.waived_by_account_type
        WHERE i.monthly_due_id=d.id AND (w.id IS NULL OR i.amount<>d.target OR i.period<>(y.year::text||'-'||lpad(d.month::text,2,'0'))
          OR w.reason IS NULL OR length(trim(w.reason))=0 OR d.waived_reason IS DISTINCT FROM w.reason OR w.waived_by_account_type<>'official'
          OR w.item_count<>(SELECT count(*) FROM public.waiver_items wi WHERE wi.waiver_action_id=w.id)
          OR w.total_amount<>(SELECT coalesce(sum(wi.amount),0) FROM public.waiver_items wi WHERE wi.waiver_action_id=w.id)
          OR actor.id IS NULL
          OR NOT EXISTS (SELECT 1 FROM public.official_assignments oa WHERE oa.rt_unit_id=w.rt_unit_id AND oa.app_account_id=w.waived_by_account_id
            AND oa.app_account_type='official' AND oa.role='rt_chairman' AND oa.starts_on<=(w.created_at AT TIME ZONE 'Asia/Jakarta')::date
            AND (oa.ends_on IS NULL OR oa.ends_on>=(w.created_at AT TIME ZONE 'Asia/Jakarta')::date))
          OR (SELECT count(*) FROM public.audit_events audit WHERE audit.action='waiver.created' AND audit.entity_type='waiver_action'
            AND audit.entity_id=w.id::text)<>1
          OR NOT EXISTS (SELECT 1 FROM public.audit_events audit WHERE audit.action='waiver.created' AND audit.entity_type='waiver_action'
            AND audit.entity_id=w.id::text AND audit.actor_app_account_id=w.waived_by_account_id AND audit.reason=w.reason
            AND audit.context->>'itemCount'=w.item_count::text AND audit.context->>'totalAmount'=w.total_amount::text
            AND audit.context->>'periods'=(SELECT string_agg(wi.period,',' ORDER BY wi.period) FROM public.waiver_items wi WHERE wi.waiver_action_id=w.id)))))
      UNION SELECT 'action:'||w.id::text entity FROM public.waiver_actions w
        LEFT JOIN public.app_accounts actor ON actor.id=w.waived_by_account_id AND actor.rt_unit_id=w.rt_unit_id
          AND actor.account_type=w.waived_by_account_type
        LEFT JOIN LATERAL (SELECT count(*)::integer item_count,coalesce(sum(i.amount),0)::numeric total_amount,
          string_agg(i.period,',' ORDER BY i.period) periods FROM public.waiver_items i WHERE i.waiver_action_id=w.id) items ON true
        LEFT JOIN LATERAL (SELECT count(*)::integer event_count,
          count(*) FILTER (WHERE audit.actor_app_account_id=w.waived_by_account_id AND audit.reason=w.reason
            AND audit.context->>'itemCount'=w.item_count::text AND audit.context->>'totalAmount'=w.total_amount::text
            AND audit.context->>'periods' IS NOT DISTINCT FROM items.periods)::integer matching_count
          FROM public.audit_events audit WHERE audit.action='waiver.created' AND audit.entity_type='waiver_action'
            AND audit.entity_id=w.id::text) audits ON true
        WHERE w.reason IS NULL OR length(trim(w.reason))=0 OR w.waived_by_account_type<>'official'
          OR items.item_count<>w.item_count OR items.total_amount<>w.total_amount OR actor.id IS NULL
          OR coalesce(audits.event_count,0)<>1 OR coalesce(audits.matching_count,0)<>1
          OR NOT EXISTS (SELECT 1 FROM public.official_assignments oa WHERE oa.rt_unit_id=w.rt_unit_id
            AND oa.app_account_id=w.waived_by_account_id AND oa.app_account_type='official' AND oa.role='rt_chairman'
            AND oa.starts_on<=(w.created_at AT TIME ZONE 'Asia/Jakarta')::date
            AND (oa.ends_on IS NULL OR oa.ends_on>=(w.created_at AT TIME ZONE 'Asia/Jakarta')::date))
      UNION SELECT 'due:'||i.monthly_due_id::text entity FROM public.waiver_items i JOIN public.monthly_dues d ON d.id=i.monthly_due_id WHERE d.status<>'waived'
      UNION SELECT 'orphan_audit:'||audit.entity_id entity FROM public.audit_events audit WHERE audit.action='waiver.created'
        AND (audit.entity_type<>'waiver_action' OR NOT EXISTS (SELECT 1 FROM public.waiver_actions w WHERE w.id::text=audit.entity_id))`,
  not_due_invalid_snapshot_or_activity: `SELECT d.id entity FROM public.monthly_dues d WHERE d.status='not_due' AND (d.amount<>0 OR d.fee_rate_id IS NOT NULL OR d.waived_reason IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.due_adjustments x WHERE x.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.payment_request_items x WHERE x.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.payment_request_claims x WHERE x.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.payment_allocations x WHERE x.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.active_due_settlements x WHERE x.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.waiver_items x WHERE x.monthly_due_id=d.id)
      OR EXISTS (SELECT 1 FROM public.households h JOIN public.billing_years y ON y.rt_unit_id=d.rt_unit_id AND y.id=d.billing_year_id
        WHERE h.rt_unit_id=d.rt_unit_id AND h.id=d.household_id AND h.ends_on IS NOT NULL AND y.year*100+d.month>
          extract(year FROM h.ends_on)::integer*100+extract(month FROM h.ends_on)::integer
          AND (EXISTS (SELECT 1 FROM public.payment_allocations x WHERE x.monthly_due_id=d.id)
            OR EXISTS (SELECT 1 FROM public.payment_request_items x WHERE x.monthly_due_id=d.id)
            OR EXISTS (SELECT 1 FROM public.payment_request_claims x WHERE x.monthly_due_id=d.id)
            OR EXISTS (SELECT 1 FROM public.waiver_items x WHERE x.monthly_due_id=d.id)
            OR EXISTS (SELECT 1 FROM public.due_adjustments x WHERE x.monthly_due_id=d.id))))`,
  household_period_overlap: `SELECT concat(first_period.rt_unit_id,':',first_period.house_id,':',first_period.id,':',second_period.id) entity
    FROM public.households first_period JOIN public.households second_period ON second_period.rt_unit_id=first_period.rt_unit_id
      AND second_period.house_id=first_period.house_id AND second_period.id>first_period.id
      AND first_period.starts_on<=coalesce(second_period.ends_on,'infinity'::date)
      AND (first_period.ends_on IS NULL OR first_period.ends_on>=second_period.starts_on)`,
  multiple_active_households_same_house: `SELECT concat(rt_unit_id,':',house_id) entity FROM public.households WHERE status='active'
    GROUP BY rt_unit_id,house_id HAVING count(*)>1`,
  active_resident_linked_to_inactive_household: `SELECT account.id entity FROM public.app_accounts account LEFT JOIN public.households household
    ON household.rt_unit_id=account.rt_unit_id AND household.id=account.household_id WHERE account.account_type='resident'
    AND account.status='active' AND (household.id IS NULL OR household.status<>'active')`,
  active_resident_linked_to_inactive_person: `SELECT account.id entity FROM public.app_accounts account LEFT JOIN public.people person
    ON person.rt_unit_id=account.rt_unit_id AND person.id=account.person_id WHERE account.account_type='resident' AND account.status='active'
    AND (person.id IS NULL OR NOT person.is_active OR person.household_id IS DISTINCT FROM account.household_id OR account.household_id IS NULL)`,
  duplicate_current_treasurer_or_chairman: `SELECT concat(a.rt_unit_id,':',a.role) entity FROM public.official_assignments a JOIN public.app_accounts u
    ON u.id=a.app_account_id AND u.rt_unit_id=a.rt_unit_id AND u.account_type='official' AND u.status='active'
    WHERE a.app_account_type='official' AND a.role IN ('treasurer','rt_chairman') AND a.starts_on<=$1::date AND (a.ends_on IS NULL OR a.ends_on>=$1::date)
    GROUP BY a.rt_unit_id,a.role HAVING count(*)>1`,
  same_account_current_treasurer_and_chairman: `SELECT concat(a.rt_unit_id,':',a.app_account_id) entity FROM public.official_assignments a JOIN public.app_accounts u
    ON u.id=a.app_account_id AND u.rt_unit_id=a.rt_unit_id AND u.account_type='official' AND u.status='active'
    WHERE a.app_account_type='official' AND a.role IN ('treasurer','rt_chairman') AND a.starts_on<=$1::date AND (a.ends_on IS NULL OR a.ends_on>=$1::date)
    GROUP BY a.rt_unit_id,a.app_account_id HAVING count(DISTINCT a.role)=2`,
  cross_rt_financial_scope_mismatch: `SELECT 'request:'||q.id::text entity FROM public.payment_requests q
    LEFT JOIN public.households h ON h.id=q.household_id LEFT JOIN public.app_accounts actor ON actor.id=q.requested_by_account_id
    LEFT JOIN public.app_accounts verifier ON verifier.id=q.verified_by_account_id LEFT JOIN public.app_accounts resolver ON resolver.id=q.resolved_by_account_id
    WHERE h.id IS NULL OR q.rt_unit_id IS DISTINCT FROM h.rt_unit_id OR actor.id IS NULL
      OR actor.rt_unit_id IS DISTINCT FROM q.rt_unit_id OR actor.household_id IS DISTINCT FROM q.household_id
      OR actor.account_type IS DISTINCT FROM q.requested_by_account_type
      OR (q.verified_by_account_id IS NOT NULL AND (verifier.id IS NULL OR verifier.rt_unit_id IS DISTINCT FROM q.rt_unit_id
        OR verifier.account_type IS DISTINCT FROM q.verified_by_account_type))
      OR (q.resolved_by_account_id IS NOT NULL AND (resolver.id IS NULL OR resolver.rt_unit_id IS DISTINCT FROM q.rt_unit_id
        OR resolver.account_type IS DISTINCT FROM q.resolved_by_account_type))
    UNION SELECT 'payment:'||p.id::text FROM public.payments p
      LEFT JOIN public.households h ON h.id=p.household_id LEFT JOIN public.payment_requests q ON q.id=p.payment_request_id
      WHERE h.id IS NULL OR p.rt_unit_id IS DISTINCT FROM h.rt_unit_id OR p.household_id IS DISTINCT FROM h.id
        OR (p.payment_request_id IS NOT NULL AND (q.id IS NULL OR p.rt_unit_id IS DISTINCT FROM q.rt_unit_id OR p.household_id IS DISTINCT FROM q.household_id))
    UNION SELECT 'requestitem:'||i.request_id::text||':'||i.monthly_due_id::text FROM public.payment_request_items i
      LEFT JOIN public.payment_requests q ON q.id=i.request_id LEFT JOIN public.monthly_dues d ON d.id=i.monthly_due_id
      WHERE q.id IS NULL OR d.id IS NULL OR i.rt_unit_id IS DISTINCT FROM q.rt_unit_id OR i.household_id IS DISTINCT FROM q.household_id
        OR i.rt_unit_id IS DISTINCT FROM d.rt_unit_id OR i.household_id IS DISTINCT FROM d.household_id
    UNION SELECT 'claim:'||c.request_id::text||':'||c.monthly_due_id::text FROM public.payment_request_claims c
      LEFT JOIN public.payment_requests q ON q.id=c.request_id LEFT JOIN public.payment_request_items i ON i.request_id=c.request_id AND i.monthly_due_id=c.monthly_due_id
      LEFT JOIN public.monthly_dues d ON d.id=c.monthly_due_id WHERE q.id IS NULL OR i.request_id IS NULL OR d.id IS NULL
        OR q.rt_unit_id IS DISTINCT FROM i.rt_unit_id OR q.household_id IS DISTINCT FROM i.household_id
        OR q.rt_unit_id IS DISTINCT FROM d.rt_unit_id OR q.household_id IS DISTINCT FROM d.household_id
    UNION SELECT 'allocation:'||a.id::text FROM public.payment_allocations a
      LEFT JOIN public.payments p ON p.id=a.payment_id LEFT JOIN public.monthly_dues d ON d.id=a.monthly_due_id
      LEFT JOIN public.payment_requests q ON q.id=a.payment_request_id
      LEFT JOIN public.payment_request_items i ON i.request_id=a.payment_request_id AND i.monthly_due_id=a.monthly_due_id
        AND i.rt_unit_id=a.rt_unit_id AND i.household_id=a.household_id AND i.amount=a.amount
      WHERE p.id IS NULL OR d.id IS NULL
        OR a.rt_unit_id IS DISTINCT FROM p.rt_unit_id OR a.household_id IS DISTINCT FROM p.household_id
        OR a.rt_unit_id IS DISTINCT FROM d.rt_unit_id OR a.household_id IS DISTINCT FROM d.household_id
        OR (a.payment_request_id IS NOT NULL AND (q.id IS NULL OR i.request_id IS NULL
          OR a.rt_unit_id IS DISTINCT FROM q.rt_unit_id OR a.household_id IS DISTINCT FROM q.household_id
          OR a.payment_request_id IS DISTINCT FROM p.payment_request_id))
    UNION SELECT 'owner:'||s.allocation_id::text FROM public.active_due_settlements s
      LEFT JOIN public.monthly_dues d ON d.id=s.monthly_due_id LEFT JOIN public.payments p ON p.id=s.payment_id
      LEFT JOIN public.payment_allocations a ON a.id=s.allocation_id
      WHERE d.id IS NULL OR p.id IS NULL OR a.id IS NULL OR s.rt_unit_id IS DISTINCT FROM d.rt_unit_id
        OR s.household_id IS DISTINCT FROM d.household_id OR s.rt_unit_id IS DISTINCT FROM p.rt_unit_id
        OR s.household_id IS DISTINCT FROM p.household_id OR s.rt_unit_id IS DISTINCT FROM a.rt_unit_id
        OR s.household_id IS DISTINCT FROM a.household_id OR s.payment_id IS DISTINCT FROM a.payment_id
        OR s.monthly_due_id IS DISTINCT FROM a.monthly_due_id OR s.amount IS DISTINCT FROM a.amount
    UNION SELECT 'waiver:'||w.id::text FROM public.waiver_actions w
      LEFT JOIN public.households h ON h.id=w.household_id LEFT JOIN public.app_accounts actor ON actor.id=w.waived_by_account_id
      WHERE h.id IS NULL OR w.rt_unit_id IS DISTINCT FROM h.rt_unit_id OR actor.id IS NULL OR actor.rt_unit_id IS DISTINCT FROM w.rt_unit_id
        OR actor.account_type IS DISTINCT FROM w.waived_by_account_type
    UNION SELECT 'waiveritem:'||i.waiver_action_id::text||':'||i.monthly_due_id::text FROM public.waiver_items i
      LEFT JOIN public.waiver_actions w ON w.id=i.waiver_action_id LEFT JOIN public.monthly_dues d ON d.id=i.monthly_due_id
      WHERE w.id IS NULL OR d.id IS NULL OR i.rt_unit_id IS DISTINCT FROM w.rt_unit_id OR i.household_id IS DISTINCT FROM w.household_id
        OR i.rt_unit_id IS DISTINCT FROM d.rt_unit_id OR i.household_id IS DISTINCT FROM d.household_id
    UNION SELECT 'reversal:'||r.payment_id::text FROM public.payment_reversals r
      LEFT JOIN public.payments p ON p.id=r.payment_id LEFT JOIN public.app_accounts actor ON actor.id=r.reversed_by_account_id
      WHERE p.id IS NULL OR actor.id IS NULL OR r.rt_unit_id IS DISTINCT FROM p.rt_unit_id OR r.household_id IS DISTINCT FROM p.household_id
        OR actor.rt_unit_id IS DISTINCT FROM r.rt_unit_id OR actor.account_type IS DISTINCT FROM r.reversed_by_account_type
    UNION SELECT 'adjustment:'||x.id::text FROM public.due_adjustments x
      LEFT JOIN public.monthly_dues d ON d.id=x.monthly_due_id LEFT JOIN public.app_accounts actor ON actor.id=x.adjusted_by_account_id
      WHERE d.id IS NULL OR actor.id IS NULL OR x.rt_unit_id IS DISTINCT FROM d.rt_unit_id OR x.household_id IS DISTINCT FROM d.household_id
        OR actor.rt_unit_id IS DISTINCT FROM x.rt_unit_id OR actor.account_type IS DISTINCT FROM x.adjusted_by_account_type
    UNION SELECT 'paymentactor:'||p.id::text FROM public.payments p LEFT JOIN public.app_accounts actor ON actor.id=p.verified_by_account_id
      WHERE actor.id IS NULL OR actor.rt_unit_id IS DISTINCT FROM p.rt_unit_id OR actor.account_type IS DISTINCT FROM p.verified_by_account_type
    UNION SELECT 'feeactor:'||f.id::text FROM public.fee_rates f LEFT JOIN public.app_accounts actor ON actor.id=f.created_by_account_id
      WHERE f.created_by_account_id IS NOT NULL AND (actor.id IS NULL OR actor.rt_unit_id IS DISTINCT FROM f.rt_unit_id
        OR actor.account_type IS DISTINCT FROM f.created_by_account_type)
    UNION SELECT 'due:'||d.id::text FROM public.monthly_dues d
      LEFT JOIN public.households h ON h.id=d.household_id LEFT JOIN public.billing_years y ON y.id=d.billing_year_id
      LEFT JOIN public.fee_rates f ON f.id=d.fee_rate_id AND f.billing_year_id=d.billing_year_id
      WHERE h.id IS NULL OR y.id IS NULL OR d.rt_unit_id IS DISTINCT FROM h.rt_unit_id
        OR d.rt_unit_id IS DISTINCT FROM y.rt_unit_id
        OR (d.fee_rate_id IS NOT NULL AND (f.id IS NULL OR f.rt_unit_id IS DISTINCT FROM d.rt_unit_id
          OR f.billing_year_id IS DISTINCT FROM d.billing_year_id))
    UNION SELECT 'fee_rate:'||f.id::text FROM public.fee_rates f LEFT JOIN public.billing_years y ON y.id=f.billing_year_id
      WHERE y.id IS NULL OR f.rt_unit_id IS DISTINCT FROM y.rt_unit_id`,
};

export function makeChecks(): Check[] {
  return integrityCategories.map(([id, name, severity]) => ({ id, name, severity, sql: queryByName[name] }));
}

function safeCount(value: unknown): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) throw new Error("parse_error");
  return parsed;
}

function jakartaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export async function runChecks(client: QueryClient, environment: "development" | "local-fixture", precondition?: { migrationEntries: number; migrationHead: string }) {
  const generatedAt = new Date().toISOString();
  const auditDate = jakartaDate(new Date(generatedAt));
  const results: Array<{ name: CategoryName; severity: string; count: number | null }> = makeChecks().map(({ name, severity }) => ({ name, severity, count: null }));
  try {
    for (const [index, check] of makeChecks().entries()) {
      const result = await client.query(`SELECT count(*)::text AS count FROM (SELECT DISTINCT entity FROM (${check.sql}) anomaly_rows) distinct_entities`, check.id === "I14" || check.id === "I15" ? [auditDate] : []);
      results[index]!.count = safeCount(result.rows[0]?.count);
    }
    const nonzeroCategoryCount = results.filter(({ count }) => count !== null && count > 0).length;
    return { schemaVersion: 1, event: "launch_safety.integrity_read_only_audit", generatedAt, environment,
      operationMode: environment === "development" ? "REPEATABLE READ READ ONLY" : "LOCAL FIXTURE",
      migrationEntries: precondition?.migrationEntries ?? null, migrationHead: precondition?.migrationHead ?? null,
      auditDate, result: nonzeroCategoryCount === 0 ? "PASS" : "FAIL", totalChecks: 16,
      zeroAnomalyChecks: results.filter(({ count }) => count === 0).length, nonzeroCategoryCount,
      anomalyCategories: results };
  } catch (error) {
    const kind = error instanceof Error && error.message === "parse_error" ? "parse_error" : "query_error";
    return { schemaVersion: 1, event: "launch_safety.integrity_read_only_audit", generatedAt, environment,
      operationMode: environment === "development" ? "REPEATABLE READ READ ONLY" : "LOCAL FIXTURE",
      migrationEntries: precondition?.migrationEntries ?? null, migrationHead: precondition?.migrationHead ?? null,
      result: "FAIL", failureKind: kind, totalChecks: 16, zeroAnomalyChecks: results.filter(({ count }) => count === 0).length,
      nonzeroCategoryCount: results.filter(({ count }) => count !== null && count > 0).length, anomalyCategories: results };
  }
}

async function targetGuard(client: PoolClient) {
  const identity = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
  if (identity.rows[0]?.database_name !== expectedTarget.database) throw new Error("target_guard");
  const migration = await client.query<{ entry_count: string; head_hash: string | null }>(`SELECT count(*)::text entry_count,
    (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) head_hash FROM drizzle.__drizzle_migrations`);
  if (migration.rows[0]?.entry_count !== String(expectedTarget.migrationCount) || migration.rows[0]?.head_hash?.toLowerCase() !== expectedTarget.migrationHeadHash) throw new Error("migration_guard");
  return { migrationEntries: expectedTarget.migrationCount, migrationHead: "0013_phase_12_household_management" };
}

async function runNeon() {
  loadEnvConfig(process.cwd());
  const env = requireDatabaseEnvironment();
  if (env.appEnv !== "development" || env.databaseEnv !== "development" ||
      process.env.KARTURT_NEON_DEV_PROJECT_ID !== expectedTarget.projectId ||
      process.env.KARTURT_NEON_DEV_BRANCH_ID !== expectedTarget.branchId ||
      process.env.KARTURT_NEON_DEV_ENDPOINT_ID !== expectedTarget.endpointId) throw new Error("target_guard");
  const url = new URL(env.databaseUrl);
  if (url.hostname.split(".")[0] !== expectedTarget.endpointId || url.hostname.split(".")[0]?.endsWith("-pooler") || url.pathname !== `/${expectedTarget.database}`) throw new Error("target_guard");
  const pool = new Pool({ connectionString: env.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  let client: PoolClient | undefined;
  let inTransaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); inTransaction = true;
    const guard = await targetGuard(client);
    const output = await runChecks(client, "development", guard);
    await client.query("COMMIT"); inTransaction = false;
    console.info(JSON.stringify(output, null, 2));
    if (output.result !== "PASS") process.exitCode = 2;
  } finally {
    if (inTransaction) await client?.query("ROLLBACK").catch(() => undefined);
    client?.release(); await pool.end();
  }
}

if (process.argv[1]?.endsWith("launch-safety-integrity.ts")) {
  runNeon().catch((error: unknown) => {
    const kind = error instanceof Error && ["target_guard", "migration_guard"].includes(error.message) ? error.message : "query_error";
    const now = new Date().toISOString();
    console.info(JSON.stringify({ schemaVersion: 1, event: "launch_safety.integrity_read_only_audit", generatedAt: now,
      environment: "development", operationMode: "REPEATABLE READ READ ONLY", result: "FAIL", failureKind: kind,
      totalChecks: 16, zeroAnomalyChecks: 0, nonzeroCategoryCount: 0,
      anomalyCategories: integrityCategories.map(([, name, severity]) => ({ name, severity, count: null })) }, null, 2));
    process.exitCode = 1;
  });
}
