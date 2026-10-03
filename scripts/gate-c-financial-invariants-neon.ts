import { loadEnvConfig } from "@next/env";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { requireDatabaseEnvironment } from "../src/lib/env";

const expectedTarget = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  branchName: "karturt-development",
  endpointId: "ep-quiet-cake-azrhjiyh",
  database: "neondb",
  migrationCount: 13,
  migrationHeadHash: "cd5459a3497fd70444e1d51cafa2f8408e9db3fe2e70de53ecbeb702cf8ebe54",
} as const;

const sampleLimit = 10;

type AnomalyResult = {
  count: string;
  sample_ids: unknown;
};

const dueFinancialCtes = `
  WITH adjustment_totals AS (
    SELECT monthly_due_id, sum(amount_delta)::numeric AS adjustment_total
    FROM public.due_adjustments
    GROUP BY monthly_due_id
  ), active_receipt_totals AS (
    SELECT allocation.monthly_due_id, sum(allocation.amount)::numeric AS active_received
    FROM public.payment_allocations allocation
    JOIN public.payments payment
      ON payment.id = allocation.payment_id
     AND payment.rt_unit_id = allocation.rt_unit_id
     AND payment.household_id = allocation.household_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id
    )
    GROUP BY allocation.monthly_due_id
  ), due_financials AS (
    SELECT
      due.id,
      due.rt_unit_id,
      due.household_id,
      due.billing_year_id,
      due.month,
      due.status,
      due.waived_reason,
      due.amount::numeric AS original_amount,
      due.amount::numeric + coalesce(adjustment.adjustment_total, 0) AS effective_target,
      coalesce(receipt.active_received, 0)::numeric AS active_received
    FROM public.monthly_dues due
    LEFT JOIN adjustment_totals adjustment ON adjustment.monthly_due_id = due.id
    LEFT JOIN active_receipt_totals receipt ON receipt.monthly_due_id = due.id
  )
`;

const anomalyQueries: Array<{ name: string; sql: string }> = [
  {
    name: "paid_balance_mismatch",
    sql: `${dueFinancialCtes}
      SELECT id::text AS anomaly_id FROM due_financials
      WHERE status = 'paid' AND (effective_target <= 0 OR active_received <> effective_target)`,
  },
  {
    name: "unpaid_fully_settled",
    sql: `${dueFinancialCtes}
      SELECT id::text AS anomaly_id FROM due_financials
      WHERE status = 'unpaid' AND effective_target > 0 AND active_received = effective_target`,
  },
  {
    name: "payable_target_nonpositive",
    sql: `${dueFinancialCtes}
      SELECT id::text AS anomaly_id FROM due_financials
      WHERE status IN ('paid', 'unpaid') AND effective_target <= 0`,
  },
  {
    name: "active_received_over_target",
    sql: `${dueFinancialCtes}
      SELECT id::text AS anomaly_id FROM due_financials
      WHERE status IN ('paid', 'unpaid') AND active_received > effective_target`,
  },
  {
    name: "verified_request_payment_allocation_mismatch",
    sql: `
      SELECT request.id::text AS anomaly_id
      FROM public.payment_requests request
      LEFT JOIN LATERAL (
        SELECT count(payment.id)::integer AS payment_count,
          coalesce(sum(payment.amount), 0)::numeric AS payment_total,
          min(payment.amount)::numeric AS payment_amount
        FROM public.payments payment
        WHERE payment.payment_request_id = request.id
          AND payment.rt_unit_id = request.rt_unit_id
          AND payment.household_id = request.household_id
      ) payment_stats ON true
      LEFT JOIN LATERAL (
        SELECT count(allocation.id)::integer AS allocation_count,
          coalesce(sum(allocation.amount), 0)::numeric AS allocation_total
        FROM public.payment_allocations allocation
        WHERE allocation.payment_request_id = request.id
          AND allocation.rt_unit_id = request.rt_unit_id
          AND allocation.household_id = request.household_id
      ) allocation_stats ON true
      WHERE request.status = 'verified'
        AND (
          payment_stats.payment_count <> 1
          OR payment_stats.payment_amount <> request.total_amount
          OR payment_stats.payment_total <> request.total_amount
          OR allocation_stats.allocation_count <> request.item_count
          OR allocation_stats.allocation_total <> request.total_amount
          OR EXISTS (
            SELECT 1
            FROM public.payment_request_items item
            WHERE item.request_id = request.id
              AND NOT EXISTS (
                SELECT 1
                FROM public.payment_allocations allocation
                WHERE allocation.payment_request_id = item.request_id
                  AND allocation.rt_unit_id = item.rt_unit_id
                  AND allocation.household_id = item.household_id
                  AND allocation.monthly_due_id = item.monthly_due_id
                  AND allocation.amount = item.amount
              )
          )
        )`,
  },
  {
    name: "payment_without_allocation",
    sql: `
      SELECT payment.id::text AS anomaly_id
      FROM public.payments payment
      WHERE NOT EXISTS (
        SELECT 1 FROM public.payment_allocations allocation WHERE allocation.payment_id = payment.id
      )`,
  },
  {
    name: "payment_amount_allocation_sum_mismatch",
    sql: `
      SELECT payment.id::text AS anomaly_id
      FROM public.payments payment
      LEFT JOIN public.payment_allocations allocation ON allocation.payment_id = payment.id
      GROUP BY payment.id, payment.amount
      HAVING coalesce(sum(allocation.amount), 0)::numeric <> payment.amount::numeric`,
  },
  {
    name: "duplicate_allocation_for_payment_due",
    sql: `
      SELECT allocation.monthly_due_id::text AS anomaly_id
      FROM public.payment_allocations allocation
      GROUP BY allocation.payment_id, allocation.monthly_due_id
      HAVING count(*) > 1`,
  },
  {
    name: "active_allocation_missing_exact_owner",
    sql: `
      SELECT allocation.id::text AS anomaly_id
      FROM public.payment_allocations allocation
      JOIN public.payments payment
        ON payment.id = allocation.payment_id
       AND payment.rt_unit_id = allocation.rt_unit_id
       AND payment.household_id = allocation.household_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id
      )
        AND NOT EXISTS (
          SELECT 1
          FROM public.active_due_settlements owner
          WHERE owner.allocation_id = allocation.id
            AND owner.payment_id = allocation.payment_id
            AND owner.rt_unit_id = allocation.rt_unit_id
            AND owner.household_id = allocation.household_id
            AND owner.monthly_due_id = allocation.monthly_due_id
            AND owner.amount = allocation.amount
        )`,
  },
  {
    name: "active_owner_allocation_payment_mismatch",
    sql: `
      SELECT owner.allocation_id::text AS anomaly_id
      FROM public.active_due_settlements owner
      LEFT JOIN public.payment_allocations allocation
        ON allocation.id = owner.allocation_id
       AND allocation.payment_id = owner.payment_id
       AND allocation.rt_unit_id = owner.rt_unit_id
       AND allocation.household_id = owner.household_id
       AND allocation.monthly_due_id = owner.monthly_due_id
       AND allocation.amount = owner.amount
      LEFT JOIN public.payments payment
        ON payment.id = owner.payment_id
       AND payment.rt_unit_id = owner.rt_unit_id
       AND payment.household_id = owner.household_id
      WHERE allocation.id IS NULL OR payment.id IS NULL`,
  },
  {
    name: "reversed_payment_retains_active_owner",
    sql: `
      SELECT owner.allocation_id::text AS anomaly_id
      FROM public.active_due_settlements owner
      JOIN public.payment_reversals reversal ON reversal.payment_id = owner.payment_id`,
  },
  {
    name: "active_ownership_sum_vs_direct_receipts",
    sql: `
      WITH direct_receipts AS (
        SELECT allocation.monthly_due_id, sum(allocation.amount)::numeric AS amount
        FROM public.payment_allocations allocation
        JOIN public.payments payment
          ON payment.id = allocation.payment_id
         AND payment.rt_unit_id = allocation.rt_unit_id
         AND payment.household_id = allocation.household_id
        WHERE NOT EXISTS (
          SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id
        )
        GROUP BY allocation.monthly_due_id
      ), owners AS (
        SELECT monthly_due_id, sum(amount)::numeric AS amount
        FROM public.active_due_settlements
        GROUP BY monthly_due_id
      )
      SELECT coalesce(receipt.monthly_due_id, owner.monthly_due_id)::text AS anomaly_id
      FROM direct_receipts receipt
      FULL OUTER JOIN owners owner USING (monthly_due_id)
      WHERE coalesce(receipt.amount, 0) <> coalesce(owner.amount, 0)`,
  },
  {
    name: "pending_request_missing_valid_claim_or_item",
    sql: `
      SELECT request.id::text AS anomaly_id
      FROM public.payment_requests request
      WHERE request.status = 'pending'
        AND (
          request.item_count <> (
            SELECT count(*) FROM public.payment_request_items item WHERE item.request_id = request.id
          )
          OR request.total_amount <> coalesce((
            SELECT sum(item.amount) FROM public.payment_request_items item WHERE item.request_id = request.id
          ), 0)
          OR NOT EXISTS (
            SELECT 1 FROM public.payment_request_items item WHERE item.request_id = request.id
          )
          OR EXISTS (
            SELECT 1 FROM public.payment_request_items item
            WHERE item.request_id = request.id
              AND NOT EXISTS (
                SELECT 1 FROM public.payment_request_claims claim
                WHERE claim.request_id = request.id AND claim.monthly_due_id = item.monthly_due_id
              )
          )
          OR EXISTS (
            SELECT 1 FROM public.payment_request_claims claim
            WHERE claim.request_id = request.id
              AND NOT EXISTS (
                SELECT 1 FROM public.payment_request_items item
                WHERE item.request_id = request.id AND item.monthly_due_id = claim.monthly_due_id
              )
          )
        )`,
  },
  {
    name: "active_claim_without_pending_request_or_item",
    sql: `
      SELECT claim.monthly_due_id::text AS anomaly_id
      FROM public.payment_request_claims claim
      LEFT JOIN public.payment_requests request ON request.id = claim.request_id
      LEFT JOIN public.payment_request_items item
        ON item.request_id = claim.request_id AND item.monthly_due_id = claim.monthly_due_id
      WHERE request.id IS NULL OR request.status <> 'pending' OR item.request_id IS NULL`,
  },
  {
    name: "terminal_request_with_active_claim",
    sql: `
      SELECT claim.monthly_due_id::text AS anomaly_id
      FROM public.payment_request_claims claim
      JOIN public.payment_requests request ON request.id = claim.request_id
      WHERE request.status <> 'pending'`,
  },
  {
    name: "pending_item_snapshot_outstanding_mismatch",
    sql: `${dueFinancialCtes}
      SELECT item.monthly_due_id::text AS anomaly_id
      FROM public.payment_requests request
      JOIN public.payment_request_items item ON item.request_id = request.id
      JOIN due_financials due ON due.id = item.monthly_due_id
      WHERE request.status = 'pending'
        AND (
          item.rt_unit_id <> request.rt_unit_id
          OR item.household_id <> request.household_id
          OR item.amount::numeric <> due.effective_target - due.active_received
        )`,
  },
  {
    name: "waived_ledger_anomaly",
    sql: `${dueFinancialCtes}, waiver_item_totals AS (
      SELECT waiver_action_id, count(*)::integer AS item_count, sum(amount)::numeric AS total_amount
      FROM public.waiver_items
      GROUP BY waiver_action_id
    )
      SELECT due.id::text AS anomaly_id
      FROM due_financials due
      LEFT JOIN public.billing_years billing_year
        ON billing_year.id = due.billing_year_id AND billing_year.rt_unit_id = due.rt_unit_id
      LEFT JOIN public.waiver_items item
        ON item.monthly_due_id = due.id
       AND item.rt_unit_id = due.rt_unit_id
       AND item.household_id = due.household_id
      LEFT JOIN public.waiver_actions action
        ON action.id = item.waiver_action_id
       AND action.rt_unit_id = item.rt_unit_id
       AND action.household_id = item.household_id
      LEFT JOIN waiver_item_totals totals ON totals.waiver_action_id = action.id
      LEFT JOIN public.app_accounts actor
        ON actor.id = action.waived_by_account_id
       AND actor.rt_unit_id = action.rt_unit_id
       AND actor.account_type = action.waived_by_account_type
      WHERE due.status = 'waived'
        AND (
          action.id IS NULL
          OR (
            SELECT count(*)
            FROM public.waiver_items matching_item
            JOIN public.waiver_actions matching_action
              ON matching_action.id = matching_item.waiver_action_id
             AND matching_action.rt_unit_id = matching_item.rt_unit_id
             AND matching_action.household_id = matching_item.household_id
            WHERE matching_item.monthly_due_id = due.id
              AND matching_item.rt_unit_id = due.rt_unit_id
              AND matching_item.household_id = due.household_id
          ) <> 1
          OR item.amount::numeric <> due.effective_target
          OR item.period <> (billing_year.year::text || '-' || lpad(due.month::text, 2, '0'))
          OR action.reason IS NULL OR length(trim(action.reason)) = 0
          OR due.waived_reason IS DISTINCT FROM action.reason
          OR action.waived_by_account_type <> 'official'
          OR actor.id IS NULL
          OR coalesce(totals.item_count, 0) <> action.item_count
          OR coalesce(totals.total_amount, 0) <> action.total_amount
          OR NOT EXISTS (
            SELECT 1
            FROM public.official_assignments assignment
            WHERE assignment.rt_unit_id = action.rt_unit_id
              AND assignment.app_account_id = action.waived_by_account_id
              AND assignment.app_account_type = 'official'
              AND assignment.role = 'rt_chairman'
              AND assignment.starts_on <= (action.created_at AT TIME ZONE 'Asia/Jakarta')::date
              AND (assignment.ends_on IS NULL OR assignment.ends_on >= (action.created_at AT TIME ZONE 'Asia/Jakarta')::date)
          )
        )
      UNION
      SELECT item.monthly_due_id::text AS anomaly_id
      FROM public.waiver_items item
      LEFT JOIN public.monthly_dues due
        ON due.id = item.monthly_due_id AND due.rt_unit_id = item.rt_unit_id AND due.household_id = item.household_id
      WHERE due.id IS NULL OR due.status <> 'waived'
      UNION
      SELECT action.id::text AS anomaly_id
      FROM public.waiver_actions action
      LEFT JOIN waiver_item_totals totals ON totals.waiver_action_id = action.id
      WHERE coalesce(totals.item_count, 0) <> action.item_count
        OR coalesce(totals.total_amount, 0) <> action.total_amount`,
  },
  {
    name: "waived_active_received",
    sql: `
      SELECT due.id::text AS anomaly_id
      FROM public.monthly_dues due
      WHERE due.status = 'waived'
        AND (
          EXISTS (
            SELECT 1 FROM public.payment_allocations allocation
            JOIN public.payments payment ON payment.id = allocation.payment_id
            WHERE allocation.monthly_due_id = due.id
              AND NOT EXISTS (SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id)
          )
          OR EXISTS (
            SELECT 1 FROM public.active_due_settlements owner WHERE owner.monthly_due_id = due.id
          )
        )`,
  },
  {
    name: "waived_active_claim",
    sql: `
      SELECT due.id::text AS anomaly_id
      FROM public.monthly_dues due
      JOIN public.payment_request_claims claim ON claim.monthly_due_id = due.id
      WHERE due.status = 'waived'`,
  },
  {
    name: "waived_adjustment_after_action",
    sql: `
      SELECT adjustment.monthly_due_id::text AS anomaly_id
      FROM public.due_adjustments adjustment
      JOIN public.waiver_items item ON item.monthly_due_id = adjustment.monthly_due_id
      JOIN public.waiver_actions action ON action.id = item.waiver_action_id
      WHERE adjustment.created_at > action.created_at`,
  },
  {
    name: "not_due_financial_activity",
    sql: `
      SELECT due.id::text AS anomaly_id
      FROM public.monthly_dues due
      WHERE due.status = 'not_due'
        AND (
          due.amount <> 0 OR due.fee_rate_id IS NOT NULL OR due.waived_reason IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.due_adjustments adjustment WHERE adjustment.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.payment_request_items item WHERE item.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.payment_request_claims claim WHERE claim.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.payment_allocations allocation WHERE allocation.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.active_due_settlements owner WHERE owner.monthly_due_id = due.id)
          OR EXISTS (SELECT 1 FROM public.waiver_items item WHERE item.monthly_due_id = due.id)
        )`,
  },
  {
    name: "adjustment_audit_mismatch",
    sql: `
      SELECT adjustment.id::text AS anomaly_id
      FROM public.due_adjustments adjustment
      JOIN public.monthly_dues due ON due.id = adjustment.monthly_due_id
      LEFT JOIN public.audit_events audit
        ON audit.action = 'billing.adjustment_created'
       AND audit.entity_type = 'due_adjustment'
       AND audit.entity_id = adjustment.id::text
      GROUP BY adjustment.id, adjustment.adjusted_by_account_id, adjustment.reason,
        adjustment.amount_delta, adjustment.effective_target_after, due.amount
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> adjustment.adjusted_by_account_id)
        OR bool_or(audit.reason IS DISTINCT FROM adjustment.reason)
        OR bool_or(audit.context->>'amountDelta' IS DISTINCT FROM adjustment.amount_delta::text)
        OR bool_or(audit.context->>'effectiveTargetAfter' IS DISTINCT FROM adjustment.effective_target_after::text)
        OR bool_or(audit.context->>'originalAmount' IS DISTINCT FROM due.amount::text)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action = 'billing.adjustment_created'
        AND (
          audit.entity_type <> 'due_adjustment'
          OR NOT EXISTS (SELECT 1 FROM public.due_adjustments adjustment WHERE adjustment.id::text = audit.entity_id)
        )`,
  },
  {
    name: "waiver_audit_mismatch",
    sql: `
      SELECT action.id::text AS anomaly_id
      FROM public.waiver_actions action
      LEFT JOIN public.audit_events audit
        ON audit.action = 'waiver.created'
       AND audit.entity_type = 'waiver_action'
       AND audit.entity_id = action.id::text
      LEFT JOIN LATERAL (
        SELECT string_agg(item.period, ',' ORDER BY item.period) AS periods
        FROM public.waiver_items item
        WHERE item.waiver_action_id = action.id
      ) item_periods ON true
      GROUP BY action.id, action.waived_by_account_id, action.reason,
        action.item_count, action.total_amount, item_periods.periods
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> action.waived_by_account_id)
        OR bool_or(audit.reason IS DISTINCT FROM action.reason)
        OR bool_or(audit.context->>'itemCount' IS DISTINCT FROM action.item_count::text)
        OR bool_or(audit.context->>'totalAmount' IS DISTINCT FROM action.total_amount::text)
        OR bool_or(audit.context->>'periods' IS DISTINCT FROM item_periods.periods)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action = 'waiver.created'
        AND (
          audit.entity_type <> 'waiver_action'
          OR NOT EXISTS (SELECT 1 FROM public.waiver_actions action WHERE action.id::text = audit.entity_id)
        )`,
  },
  {
    name: "fee_rate_audit_mismatch",
    sql: `
      SELECT rate.id::text AS anomaly_id
      FROM public.fee_rates rate
      JOIN public.billing_years billing_year
        ON billing_year.id = rate.billing_year_id AND billing_year.rt_unit_id = rate.rt_unit_id
      LEFT JOIN public.audit_events audit
        ON audit.action = 'fee_rate.created'
       AND audit.entity_type = 'fee_rate'
       AND audit.entity_id = rate.id::text
      WHERE rate.created_by_account_id IS NOT NULL
      GROUP BY rate.id, rate.created_by_account_id, rate.created_by_account_type,
        rate.effective_month, billing_year.year, rate.monthly_amount
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> rate.created_by_account_id)
        OR bool_or(rate.created_by_account_type <> 'official')
        OR bool_or(audit.reason IS NOT NULL)
        OR bool_or(audit.context->>'period' IS DISTINCT FROM
          (billing_year.year::text || '-' || lpad(rate.effective_month::text, 2, '0')))
        OR bool_or(audit.context->>'monthlyAmount' IS DISTINCT FROM rate.monthly_amount::text)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action = 'fee_rate.created'
        AND (
          audit.entity_type <> 'fee_rate'
          OR NOT EXISTS (SELECT 1 FROM public.fee_rates rate WHERE rate.id::text = audit.entity_id)
        )`,
  },
  {
    name: "payment_request_creation_audit_mismatch",
    sql: `
      SELECT request.id::text AS anomaly_id
      FROM public.payment_requests request
      LEFT JOIN public.audit_events audit
        ON audit.action = 'payment_request.created'
       AND audit.entity_type = 'payment_request'
       AND audit.entity_id = request.id::text
      GROUP BY request.id, request.requested_by_account_id, request.item_count, request.total_amount
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> request.requested_by_account_id)
        OR bool_or(audit.reason IS NOT NULL)
        OR bool_or(audit.context->>'itemCount' IS DISTINCT FROM request.item_count::text)
        OR bool_or(audit.context->>'totalAmount' IS DISTINCT FROM request.total_amount::text)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action = 'payment_request.created'
        AND (
          audit.entity_type <> 'payment_request'
          OR NOT EXISTS (SELECT 1 FROM public.payment_requests request WHERE request.id::text = audit.entity_id)
        )`,
  },
  {
    name: "verified_request_audit_mismatch",
    sql: `
      SELECT request.id::text AS anomaly_id
      FROM public.payment_requests request
      LEFT JOIN public.audit_events audit
        ON audit.action = 'payment_request.verified'
       AND audit.entity_type = 'payment_request'
       AND audit.entity_id = request.id::text
      WHERE request.status = 'verified'
      GROUP BY request.id, request.verified_by_account_id, request.item_count, request.total_amount
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> request.verified_by_account_id)
        OR bool_or(audit.reason IS NOT NULL)
        OR bool_or(audit.context->>'itemCount' IS DISTINCT FROM request.item_count::text)
        OR bool_or(audit.context->>'totalAmount' IS DISTINCT FROM request.total_amount::text)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action = 'payment_request.verified'
        AND (
          audit.entity_type <> 'payment_request'
          OR NOT EXISTS (
          SELECT 1 FROM public.payment_requests request
          WHERE request.id::text = audit.entity_id AND request.status = 'verified'
          )
        )`,
  },
  {
    name: "request_resolution_audit_mismatch",
    sql: `
      SELECT request.id::text AS anomaly_id
      FROM public.payment_requests request
      LEFT JOIN public.audit_events audit
        ON audit.action = 'payment_request.' || request.status
       AND audit.entity_type = 'payment_request'
       AND audit.entity_id = request.id::text
      WHERE request.status IN ('cancelled', 'rejected')
      GROUP BY request.id, request.status, request.resolved_by_account_id,
        request.resolution_reason, request.item_count, request.total_amount
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> request.resolved_by_account_id)
        OR bool_or(audit.reason IS DISTINCT FROM request.resolution_reason)
        OR bool_or(audit.context->>'itemCount' IS DISTINCT FROM request.item_count::text)
        OR bool_or(audit.context->>'totalAmount' IS DISTINCT FROM request.total_amount::text)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action IN ('payment_request.cancelled', 'payment_request.rejected')
        AND (
          audit.entity_type <> 'payment_request'
          OR NOT EXISTS (
            SELECT 1 FROM public.payment_requests request
            WHERE request.id::text = audit.entity_id AND audit.action = 'payment_request.' || request.status
          )
        )`,
  },
  {
    name: "cash_payment_audit_mismatch",
    sql: `
      SELECT payment.id::text AS anomaly_id
      FROM public.payments payment
      LEFT JOIN public.audit_events audit
        ON audit.action = 'payment.cash_recorded'
       AND audit.entity_type = 'payment'
       AND audit.entity_id = payment.id::text
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS item_count
        FROM public.payment_allocations allocation WHERE allocation.payment_id = payment.id
      ) allocations ON true
      WHERE payment.method = 'cash'
      GROUP BY payment.id, payment.verified_by_account_id, payment.amount,
        allocations.item_count, payment.method
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> payment.verified_by_account_id)
        OR bool_or(audit.reason IS NOT NULL)
        OR bool_or(audit.context->>'itemCount' IS DISTINCT FROM allocations.item_count::text)
        OR bool_or(audit.context->>'totalAmount' IS DISTINCT FROM payment.amount::text)
        OR bool_or(audit.context->>'method' IS DISTINCT FROM payment.method)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action = 'payment.cash_recorded'
        AND (
          audit.entity_type <> 'payment'
          OR NOT EXISTS (
            SELECT 1 FROM public.payments payment
            WHERE payment.id::text = audit.entity_id AND payment.method = 'cash'
          )
        )`,
  },
  {
    name: "payment_reversal_audit_mismatch",
    sql: `
      SELECT reversal.payment_id::text AS anomaly_id
      FROM public.payment_reversals reversal
      JOIN public.payments payment ON payment.id = reversal.payment_id
      LEFT JOIN public.audit_events audit
        ON audit.action = 'payment.reversed'
       AND audit.entity_type = 'payment'
       AND audit.entity_id = payment.id::text
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS item_count, coalesce(sum(amount), 0)::numeric AS total_amount
        FROM public.payment_allocations allocation WHERE allocation.payment_id = payment.id
      ) allocations ON true
      GROUP BY reversal.payment_id, reversal.reversed_by_account_id, reversal.reason,
        payment.method, allocations.item_count, allocations.total_amount
      HAVING count(audit.id) <> 1
        OR bool_or(audit.actor_app_account_id <> reversal.reversed_by_account_id)
        OR bool_or(audit.reason IS DISTINCT FROM reversal.reason)
        OR bool_or(audit.context->>'itemCount' IS DISTINCT FROM allocations.item_count::text)
        OR bool_or(audit.context->>'method' IS DISTINCT FROM payment.method)
        OR bool_or(audit.context->>'totalAmount' IS DISTINCT FROM allocations.total_amount::text)
      UNION
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      WHERE audit.action = 'payment.reversed'
        AND (
          audit.entity_type <> 'payment'
          OR NOT EXISTS (
            SELECT 1 FROM public.payment_reversals reversal
            WHERE reversal.payment_id::text = audit.entity_id
          )
        )`,
  },
  {
    name: "system_admin_financial_actor",
    sql: `
      SELECT audit.id::text AS anomaly_id
      FROM public.audit_events audit
      JOIN public.app_accounts actor ON actor.id = audit.actor_app_account_id
      WHERE audit.action IN (
        'payment_request.created', 'payment_request.verified', 'payment_request.rejected',
        'payment_request.cancelled', 'payment.cash_recorded', 'payment.reversed',
        'waiver.created', 'fee_rate.created', 'billing.adjustment_created'
      )
        AND actor.account_type = 'system_admin'
      UNION
      SELECT payment.id::text AS anomaly_id
      FROM public.payments payment
      JOIN public.app_accounts actor ON actor.id = payment.verified_by_account_id
      WHERE actor.account_type = 'system_admin'
      UNION
      SELECT adjustment.id::text AS anomaly_id
      FROM public.due_adjustments adjustment
      JOIN public.app_accounts actor ON actor.id = adjustment.adjusted_by_account_id
      WHERE actor.account_type = 'system_admin'
      UNION
      SELECT reversal.payment_id::text AS anomaly_id
      FROM public.payment_reversals reversal
      JOIN public.app_accounts actor ON actor.id = reversal.reversed_by_account_id
      WHERE actor.account_type = 'system_admin'
      UNION
      SELECT action.id::text AS anomaly_id
      FROM public.waiver_actions action
      JOIN public.app_accounts actor ON actor.id = action.waived_by_account_id
      WHERE actor.account_type = 'system_admin'
      UNION
      SELECT rate.id::text AS anomaly_id
      FROM public.fee_rates rate
      JOIN public.app_accounts actor ON actor.id = rate.created_by_account_id
      WHERE actor.account_type = 'system_admin'`,
  },
  {
    name: "duplicate_active_treasurer_or_chairman",
    sql: `
      SELECT assignment.rt_unit_id::text AS anomaly_id
      FROM public.official_assignments assignment
      JOIN public.app_accounts account
        ON account.id = assignment.app_account_id
       AND account.rt_unit_id = assignment.rt_unit_id
       AND account.account_type = 'official'
       AND account.status = 'active'
      WHERE assignment.app_account_type = 'official'
        AND assignment.role IN ('treasurer', 'rt_chairman')
        AND assignment.starts_on <= (now() AT TIME ZONE 'Asia/Jakarta')::date
        AND (assignment.ends_on IS NULL OR assignment.ends_on >= (now() AT TIME ZONE 'Asia/Jakarta')::date)
      GROUP BY assignment.rt_unit_id, assignment.role
      HAVING count(*) > 1`,
  },
  {
    name: "same_account_active_treasurer_and_chairman",
    sql: `
      SELECT assignment.rt_unit_id::text || ':' || assignment.app_account_id::text AS anomaly_id
      FROM public.official_assignments assignment
      JOIN public.app_accounts account
        ON account.id = assignment.app_account_id
       AND account.rt_unit_id = assignment.rt_unit_id
       AND account.account_type = 'official'
       AND account.status = 'active'
      WHERE assignment.app_account_type = 'official'
        AND assignment.role IN ('treasurer', 'rt_chairman')
        AND assignment.starts_on <= (now() AT TIME ZONE 'Asia/Jakarta')::date
        AND (assignment.ends_on IS NULL OR assignment.ends_on >= (now() AT TIME ZONE 'Asia/Jakarta')::date)
      GROUP BY assignment.rt_unit_id, assignment.app_account_id
      HAVING count(DISTINCT assignment.role) = 2`,
  },
];

function sampleIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function inspectTarget(client: PoolClient) {
  const identity = await client.query<{ database_name: string; role_name: string }>(
    "SELECT current_database() AS database_name, current_user AS role_name",
  );
  if (identity.rows[0]?.database_name !== expectedTarget.database) {
    throw new Error("The guarded Neon endpoint did not resolve to the expected development database.");
  }

  const migration = await client.query<{ entry_count: string; head_hash: string | null }>(`
    SELECT count(*)::text AS entry_count,
      (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS head_hash
    FROM drizzle.__drizzle_migrations
  `);
  const current = migration.rows[0];
  if (current?.entry_count !== String(expectedTarget.migrationCount) || current.head_hash !== expectedTarget.migrationHeadHash) {
    throw new Error("Neon development migration journal is not the frozen F11 head (13 entries / expected 0012 hash).");
  }
  return {
    database: identity.rows[0].database_name,
    databaseRole: identity.rows[0].role_name,
    migrationEntries: Number(current.entry_count),
    migrationHead: "0012_phase_11_tariff_adjustment",
    migrationHeadHash: current.head_hash,
  };
}

async function runAnomalyQuery(client: PoolClient, check: { name: string; sql: string }) {
  const result = await client.query<AnomalyResult>(`
    WITH anomaly_rows AS (
      ${check.sql}
    ), distinct_anomalies AS (
      SELECT DISTINCT anomaly_id FROM anomaly_rows
    ), samples AS (
      SELECT anomaly_id FROM distinct_anomalies ORDER BY anomaly_id LIMIT ${sampleLimit}
    )
    SELECT
      (SELECT count(*)::text FROM distinct_anomalies) AS count,
      coalesce((SELECT json_agg(anomaly_id) FROM samples), '[]'::json) AS sample_ids
  `);
  const row = result.rows[0];
  if (!row) throw new Error(`No aggregate result returned for ${check.name}.`);
  return { name: check.name, count: row.count, sampleIds: sampleIds(row.sample_ids) };
}

async function main() {
  loadEnvConfig(process.cwd());
  const environment = requireDatabaseEnvironment();
  const configuredProjectId = process.env.KARTURT_NEON_DEV_PROJECT_ID;
  const configuredBranchId = process.env.KARTURT_NEON_DEV_BRANCH_ID;
  const configuredEndpointId = process.env.KARTURT_NEON_DEV_ENDPOINT_ID;

  if (environment.appEnv !== "development" || environment.databaseEnv !== "development") {
    throw new Error("Gate C Neon audit requires APP_ENV and DATABASE_ENV to both be development.");
  }
  if (
    configuredProjectId !== expectedTarget.projectId ||
    configuredBranchId !== expectedTarget.branchId ||
    configuredEndpointId !== expectedTarget.endpointId
  ) {
    throw new Error("Explicit KartuRT Neon development project, branch, and endpoint IDs must match the frozen target.");
  }

  const databaseUrl = new URL(environment.databaseUrl);
  const endpointId = databaseUrl.hostname.split(".")[0];
  if (
    endpointId !== expectedTarget.endpointId ||
    endpointId.endsWith("-pooler") ||
    databaseUrl.pathname !== `/${expectedTarget.database}`
  ) {
    throw new Error("DATABASE_URL must use the exact frozen direct development endpoint and neondb database path.");
  }

  const pool = new Pool({ connectionString: environment.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const target = await inspectTarget(client);
    const anomalies = [];
    for (const check of anomalyQueries) {
      anomalies.push(await runAnomalyQuery(client, check));
    }

    const nonzero = anomalies.filter(({ count }) => count !== "0");
    console.info(JSON.stringify({
      event: "gate_c.financial_invariants_neon_read_only_audit",
      environment: "development",
      projectId: expectedTarget.projectId,
      branchName: expectedTarget.branchName,
      branchId: expectedTarget.branchId,
      endpointId: expectedTarget.endpointId,
      ...target,
      sampleLimit,
      operationMode: "SELECT-only; no fixtures, writes, schema changes, or migrations",
      anomalyCount: anomalies.length,
      zeroTargetAnomalies: anomalies,
      nonzeroAnomalyKeys: nonzero.map(({ name }) => name),
    }, null, 2));
    if (nonzero.length > 0) process.exitCode = 2;
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected read-only Neon audit failure.";
  console.error(`Gate C Neon development audit failed: ${message}`);
  process.exitCode = 1;
});
