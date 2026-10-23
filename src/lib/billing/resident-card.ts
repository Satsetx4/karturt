export type ResidentMonthReceipt = {
  /** Amount allocated to this month from the canonical payment ledger. */
  allocationAmount: number;
  method: "cash" | "transfer";
  verifiedAt: string;
  reference: string;
};

export type ResidentDue = {
  billingYear: number;
  month: number;
  /** Compatibility alias for the current effective target shown as the obligation amount. */
  amount: number;
  originalAmount: number;
  adjustmentTotal: number;
  effectiveTarget: number;
  activeReceived: number;
  outstanding: number;
  dueDate: string;
  status: "paid" | "unpaid" | "waived" | "not_due";
  /** Calendar display only; the persisted due status remains unchanged. */
  periodTiming?: "past" | "current" | "future";
  /** Active payment allocations for a paid month, excluding reversed payments. */
  receipts?: ResidentMonthReceipt[];
  paymentRequestStatus?: "pending" | "verified" | "rejected" | "cancelled" | null;
};
export type CurrentResidentStatusToken =
  | "PAID"
  | "UNPAID"
  | "WAIVED"
  | "NOT_DUE"
  | "UPCOMING"
  | "OVERDUE";
export type ResidentStatusToken = CurrentResidentStatusToken | "PENDING";

export const monthNames = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const domainStatusTokens: Record<
  ResidentDue["status"],
  CurrentResidentStatusToken
> = {
  paid: "PAID",
  unpaid: "UNPAID",
  waived: "WAIVED",
  not_due: "NOT_DUE",
};

export const residentStatusLabels: Record<ResidentStatusToken, string> = {
  PAID: "Sudah bayar",
  UNPAID: "Belum bayar",
  WAIVED: "Dibebaskan",
  NOT_DUE: "Tidak perlu bayar",
  UPCOMING: "Belum jatuh tempo",
  OVERDUE: "Menunggak",
  PENDING: "Menunggu konfirmasi",
};

export function dueToken(due: ResidentDue): ResidentStatusToken {
  if (due.status === "unpaid" && due.paymentRequestStatus === "pending") return "PENDING";
  if (due.status === "unpaid" && due.periodTiming === "future") return "UPCOMING";
  if (due.status === "unpaid" && due.periodTiming === "past") return "OVERDUE";
  return domainStatusTokens[due.status];
}

export function formatResidentDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(
    new Date(year, month - 1, day),
  );
}
export function yearMonths(dues: ResidentDue[], year: number) {
  return monthNames.map((name, index) => ({
    name,
    month: index + 1,
    due: dues.find((d) => d.billingYear === year && d.month === index + 1),
  }));
}
export function duesSummary(dues: ResidentDue[]) {
  return dues.reduce(
    (total, due) => ({
      paid: total.paid + (due.status === "paid" || due.status === "unpaid" ? due.activeReceived : 0),
      pending:
        total.pending +
        (due.status === "unpaid" && due.paymentRequestStatus === "pending"
          ? due.outstanding
          : 0),
      unpaid:
        total.unpaid +
        (due.status === "unpaid" && due.periodTiming !== "future" && due.paymentRequestStatus !== "pending"
          ? due.outstanding
          : 0),
    }),
    { paid: 0, pending: 0, unpaid: 0 },
  );
}
