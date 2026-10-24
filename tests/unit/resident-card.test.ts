import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResidentDuesSummary,
  ResidentDueStatus,
  ResidentMonthCard,
  ResidentPaymentRequestPanel,
} from "../../src/components/resident-card";
import {
  dueToken,
  duesSummary,
  formatResidentDate,
  residentStatusLabels,
  yearMonths,
  type ResidentStatusToken,
  type ResidentDue,
} from "../../src/lib/billing/resident-card";
const due = (status: ResidentDue["status"], month: number): ResidentDue => ({
  status,
  month,
  billingYear: 2026,
  amount: status === "not_due" ? 0 : 40000,
  originalAmount: status === "not_due" ? 0 : 40000,
  adjustmentTotal: 0,
  effectiveTarget: status === "not_due" ? 0 : 40000,
  activeReceived: status === "paid" ? 40000 : 0,
  outstanding: status === "unpaid" ? 40000 : 0,
  dueDate: `2026-${String(month).padStart(2, "0")}-10`,
});

const visibleText = (markup: string) =>
  markup.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]*>/g, "");

describe("resident card semantics", () => {
  it("keeps current domain statuses separate from the future pending visual token", () => {
    expect(dueToken(due("unpaid", 12))).toBe("UNPAID");
    expect(dueToken(due("paid", 1))).toBe("PAID");
    expect(dueToken(due("waived", 2))).toBe("WAIVED");
    expect(dueToken(due("not_due", 3))).toBe("NOT_DUE");
    expect(dueToken({ ...due("unpaid", 4), paymentRequestStatus: "pending" })).toBe("PENDING");
    expect(dueToken({ ...due("paid", 5), paymentRequestStatus: "pending" })).toBe("PAID");
    expect(residentStatusLabels.PENDING).toBe("Menunggu konfirmasi");
  });

  it("renders simple Indonesian labels without showing domain tokens", () => {
    const tokens: ResidentStatusToken[] = [
      "PAID",
      "UNPAID",
      "WAIVED",
      "NOT_DUE",
      "UPCOMING",
      "OVERDUE",
      "PENDING",
    ];
    const markup = tokens
      .map((token) =>
        renderToStaticMarkup(
          createElement(ResidentDueStatus, { token }),
        ),
      )
      .join("");
    const text = visibleText(markup);

    expect(text).toBe(
      "Sudah bayarBelum bayarDibebaskanTidak perlu bayarBelum jatuh tempoMenunggakMenunggu konfirmasi",
    );
    expect(text).not.toMatch(/\b(PAID|UNPAID|WAIVED|NOT_DUE|UPCOMING|OVERDUE|PENDING)\b/i);
    expect(residentStatusLabels).toEqual({
      PAID: "Sudah bayar",
      UNPAID: "Belum bayar",
      WAIVED: "Dibebaskan",
      NOT_DUE: "Tidak perlu bayar",
      UPCOMING: "Belum jatuh tempo",
      OVERDUE: "Menunggak",
      PENDING: "Menunggu konfirmasi",
    });
  });

  it("shows no due date or technical wording on a month card or summary", () => {
    const monthMarkup = renderToStaticMarkup(
      createElement(ResidentMonthCard, {
        name: "Juni",
        due: due("unpaid", 6),
      }),
    );
    const summaryMarkup = renderToStaticMarkup(
      createElement(ResidentDuesSummary, {
        summary: { paid: 40000, pending: 25000, unpaid: 80000 },
      }),
    );
    const text = `${visibleText(monthMarkup)} ${visibleText(summaryMarkup)}`;

    expect(text).toContain("Belum bayar");
    expect(text).toContain("Menunggu konfirmasi");
    expect(text).toContain("Sudah bayar");
    expect(text).not.toMatch(/Tunggakan|Total belum dibayar|Total sudah dibayar/i);
    expect(text).not.toMatch(/2026-06-10|tanggal 10|jatuh tempo/i);
    expect(text).not.toMatch(/\b(PAID|UNPAID|WAIVED|NOT_DUE|PENDING)\b/i);
    expect(text).not.toMatch(/\b(paid|unpaid|due|pending)\b/i);
  });

  it("formats profile dates for residents without changing the stored date", () => {
    expect(formatResidentDate("2026-01-10")).toBe("10 Januari 2026");
  });
  it("distinguishes waiver and absent obligation", () => {
    expect(dueToken(due("waived", 1))).toBe("WAIVED");
    expect(dueToken(due("not_due", 2))).toBe("NOT_DUE");
  });
  it("counts an ordinary unpaid due only under Belum bayar", () => {
    expect(duesSummary([due("unpaid", 4)])).toEqual({
      paid: 0,
      pending: 0,
      unpaid: 40000,
    });
  });

  it("counts an unpaid due with an active request only under Menunggu konfirmasi", () => {
    const pendingDue = { ...due("unpaid", 6), paymentRequestStatus: "pending" as const };
    expect(duesSummary([pendingDue])).toEqual({
      paid: 0,
      pending: 40000,
      unpaid: 0,
    });
    expect(pendingDue.status).toBe("unpaid");
    expect(dueToken(pendingDue)).toBe("PENDING");
  });

  it("counts paid dues only under Sudah bayar", () => {
    expect(duesSummary([due("paid", 3)])).toEqual({
      paid: 40000,
      pending: 0,
      unpaid: 0,
    });
  });

  it("shows the new outstanding after a positive adjustment to a previously paid month", () => {
    const adjustedDue: ResidentDue = {
      ...due("unpaid", 8),
      amount: 50000,
      originalAmount: 40000,
      adjustmentTotal: 10000,
      effectiveTarget: 50000,
      activeReceived: 40000,
      outstanding: 10000,
    };

    expect(duesSummary([adjustedDue])).toEqual({ paid: 40000, pending: 0, unpaid: 10000 });
    const text = visibleText(renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "Agustus",
      due: adjustedDue,
    }))).replace(/\u00a0/g, " ");
    expect(text).toContain("Belum bayar");
    expect(text).toContain("Rp 10.000");
    expect(text).toContain("Penyesuaian bersih Rp 10.000. Sisa kewajiban Rp 10.000 belum dibayar.");
  });

  it("distinguishes a partial adjustment total from the remaining balance", () => {
    const adjustedDue: ResidentDue = {
      ...due("unpaid", 8),
      amount: 30000,
      originalAmount: 40000,
      adjustmentTotal: 10000,
      effectiveTarget: 50000,
      activeReceived: 20000,
      outstanding: 30000,
    };
    const text = renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "Agustus",
      due: adjustedDue,
    })).replace(/\u00a0/g, " ");
    expect(text).toContain("Penyesuaian bersih Rp 10.000. Sisa kewajiban Rp 30.000 belum dibayar.");
    expect(text).not.toContain("Penyesuaian bersih Rp30.000");
  });

  it("excludes waived and not-due obligations from the three totals", () => {
    expect(duesSummary([due("waived", 4), due("not_due", 5)])).toEqual({
      paid: 0,
      pending: 0,
      unpaid: 0,
    });
  });

  it("keeps a waived amount out of paid, pending, and unpaid totals", () => {
    expect(duesSummary([
      { ...due("paid", 3), amount: 10000, activeReceived: 10000, effectiveTarget: 10000 },
      { ...due("unpaid", 6), amount: 20000, effectiveTarget: 20000, outstanding: 20000, paymentRequestStatus: "pending" },
      { ...due("unpaid", 7), amount: 30000, effectiveTarget: 30000, outstanding: 30000 },
      { ...due("waived", 4), amount: 65000 },
    ])).toEqual({ paid: 10000, pending: 20000, unpaid: 30000 });
  });

  it("renders a waived month as Dibebaskan without exposing waiver metadata", () => {
    const markup = renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "April",
      due: { ...due("waived", 4), amount: 65000 },
    }));
    const text = visibleText(markup);

    expect(text).toContain("Dibebaskan");
    expect(text).not.toMatch(/\bWAIVED\b|Alasan|Ketua RT/i);
    expect(markup).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("sums mixed dues across billing years without merging pending into unpaid", () => {
    expect(duesSummary([
      { ...due("unpaid", 12), billingYear: 2025, amount: 25000, effectiveTarget: 25000, outstanding: 25000 },
      { ...due("unpaid", 1), billingYear: 2026, amount: 30000, effectiveTarget: 30000, outstanding: 30000, paymentRequestStatus: "pending" },
      { ...due("unpaid", 2), billingYear: 2026, amount: 45000, effectiveTarget: 45000, outstanding: 45000 },
      { ...due("paid", 11), billingYear: 2024, amount: 10000, effectiveTarget: 10000, activeReceived: 10000 },
      { ...due("waived", 10), billingYear: 2025, amount: 50000 },
      { ...due("not_due", 3), billingYear: 2026, amount: 0 },
    ])).toEqual({
      paid: 10000,
      pending: 30000,
      unpaid: 70000,
    });
  });

  it("keeps the active request visible on a resident month card", () => {
    const pendingDue = { ...due("unpaid", 6), paymentRequestStatus: "pending" as const };
    const markup = renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "Juni",
      due: pendingDue,
    }));
    expect(visibleText(markup)).toContain("Menunggu konfirmasi");
    expect(pendingDue.status).toBe("unpaid");
  });

  it("offers online requests only for past and current unpaid periods", () => {
    const overdue = { ...due("unpaid", 9), periodTiming: "past" as const };
    const current = { ...due("unpaid", 10), periodTiming: "current" as const };
    const future = { ...due("unpaid", 11), periodTiming: "future" as const };
    const markup = renderToStaticMarkup(createElement(ResidentPaymentRequestPanel, {
      dues: [overdue, current, future],
      onCreated: () => {},
    }));
    const optionValues = [...markup.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);

    expect(optionValues).toEqual(["2026-09", "2026-10"]);
    expect(markup).not.toContain("2026-11");
  });

  it("shows a pending request on a future month as pending rather than upcoming", () => {
    const futurePending = {
      ...due("unpaid", 11),
      periodTiming: "future" as const,
      paymentRequestStatus: "pending" as const,
    };
    const text = visibleText(renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "November",
      due: futurePending,
    })));

    expect(duesSummary([futurePending])).toEqual({ paid: 0, pending: 40000, unpaid: 0 });
    expect(dueToken(futurePending)).toBe("PENDING");
    expect(text).toContain("Menunggu konfirmasi");
    expect(text).not.toContain("Belum jatuh tempo");
  });

  it("separates upcoming unpaid months from arrears and keeps prepaid future months paid", () => {
    const overdue = { ...due("unpaid", 9), periodTiming: "past" as const };
    const currentPending = {
      ...due("unpaid", 10),
      periodTiming: "current" as const,
      paymentRequestStatus: "pending" as const,
    };
    const upcoming = { ...due("unpaid", 11), periodTiming: "future" as const };
    const prepaidFuture = { ...due("paid", 12), periodTiming: "future" as const };

    expect(dueToken(overdue)).toBe("OVERDUE");
    expect(dueToken(currentPending)).toBe("PENDING");
    expect(dueToken(upcoming)).toBe("UPCOMING");
    expect(dueToken(prepaidFuture)).toBe("PAID");
    expect(duesSummary([overdue, currentPending, upcoming, prepaidFuture])).toEqual({
      paid: 40000,
      pending: 40000,
      unpaid: 40000,
    });
    expect(overdue.status).toBe("unpaid");
    expect(upcoming.status).toBe("unpaid");

    const upcomingText = visibleText(renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "November",
      due: upcoming,
    })));
    expect(upcomingText).toContain("Belum jatuh tempo");
    expect(upcomingText).not.toContain("Rp 40.000");
    expect(visibleText(renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "September",
      due: overdue,
    })))).toContain("Menunggak");
  });

  it("shows each paid-month allocation with its verified Jakarta date and canonical reference", () => {
    const receiptDate = "2026-10-24T12:30:00.000Z";
    const paidDue: ResidentDue = {
      ...due("paid", 10),
      amount: 80000,
      effectiveTarget: 80000,
      activeReceived: 80000,
      periodTiming: "current",
      receipts: [
        { allocationAmount: 40000, method: "cash", verifiedAt: receiptDate, reference: "KRT-ABCDEF123456" },
        { allocationAmount: 40000, method: "transfer", verifiedAt: receiptDate, reference: "KRT-123456ABCDEF" },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ResidentMonthCard, {
      name: "Oktober",
      due: paidDue,
    }));
    const text = visibleText(markup).replace(/\u00a0/g, " ");

    expect(markup).toContain("<details class=\"due-receipt\">");
    expect(text).toContain("Sudah bayar");
    expect(text).toContain("Ketuk untuk lihat kuitansi");
    expect(text).toContain("Tunai");
    expect(text).toContain("Transfer");
    expect(text.match(/Rp 40\.000/g)).toHaveLength(2);
    expect(text).toContain("Diverifikasi 24 Okt 2026, 19.30 WIB");
    expect(text).toContain("KRT-ABCDEF123456");
    expect(text).toContain("Nominal di atas adalah alokasi untuk bulan ini, bukan total satu transaksi lintas bulan.");
    expect(markup).toContain(`dateTime=\"${receiptDate}\"`);
  });

  it("renders Jan-Dec in order and preserves missing records without assigning NOT_DUE", () => {
    const months = yearMonths([due("unpaid", 12), due("paid", 1)], 2026);
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(months[1].due).toBeUndefined();
    expect(months[11].due?.status).toBe("unpaid");
    expect(yearMonths([due("paid", 1)], 2025).every((m) => !m.due)).toBe(true);
  });
});
