import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResidentDuesSummary,
  ResidentDueStatus,
  ResidentMonthCard,
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
    expect(residentStatusLabels.PENDING).toBe("Menunggu konfirmasi");
  });

  it("renders simple Indonesian labels without showing domain tokens", () => {
    const tokens: ResidentStatusToken[] = [
      "PAID",
      "UNPAID",
      "WAIVED",
      "NOT_DUE",
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
      "Sudah bayarBelum bayarDibebaskanTidak perlu bayarMenunggu konfirmasi",
    );
    expect(text).not.toMatch(/\b(PAID|UNPAID|WAIVED|NOT_DUE|PENDING)\b/i);
    expect(residentStatusLabels).toEqual({
      PAID: "Sudah bayar",
      UNPAID: "Belum bayar",
      WAIVED: "Dibebaskan",
      NOT_DUE: "Tidak perlu bayar",
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
        summary: { paid: 40000, arrears: 40000, unpaid: 80000 },
      }),
    );
    const text = `${visibleText(monthMarkup)} ${visibleText(summaryMarkup)}`;

    expect(text).toContain("Belum bayar");
    expect(text).toMatch(/Tunggakan/);
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
  it("excludes waived/not due/future from arrears, includes future in unpaid", () => {
    expect(
      duesSummary(
        [
          due("waived", 1),
          due("not_due", 2),
          due("paid", 3),
          due("unpaid", 4),
          due("unpaid", 12),
        ],
        "2026-06-15",
      ),
    ).toEqual({ paid: 40000, arrears: 40000, unpaid: 80000 });
  });
  it("does not call a due overdue on day 10", () => {
    expect(duesSummary([due("unpaid", 6)], "2026-06-10").arrears).toBe(0);
  });
  it("renders Jan-Dec in order and preserves missing records without assigning NOT_DUE", () => {
    const months = yearMonths([due("unpaid", 12), due("paid", 1)], 2026);
    expect(months.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(months[1].due).toBeUndefined();
    expect(months[11].due?.status).toBe("unpaid");
    expect(yearMonths([due("paid", 1)], 2025).every((m) => !m.due)).toBe(true);
  });
});
