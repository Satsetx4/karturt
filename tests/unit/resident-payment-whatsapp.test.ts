import { describe, expect, it } from "vitest";
import { createResidentPaymentWhatsAppUrl } from "../../src/lib/billing/resident-payment-whatsapp";

const base = {
  destinationNumber: "08123456789",
  houseNumber: "A-02",
  residentName: "Warga Uji",
  request: {
    requestCode: "KRT-91A2B3C4D5E6F708",
    status: "pending" as const,
    periods: ["2026-08", "2026-09"],
    totalAmount: 80000,
    createdAt: new Date("2026-09-10T07:00:00.000Z"),
  },
};

describe("manual pending payment request WhatsApp link", () => {
  it("uses valid same-RT phone and a pending, NOT verified-payment claim", () => {
    const url = createResidentPaymentWhatsAppUrl(base);
    expect(url).toMatch(/^https:\/\/wa\.me\/628123456789\?text=/);
    const text = new URL(url!).searchParams.get("text") ?? "";
    expect(text).toContain("meminta konfirmasi atas pengajuan pembayaran");
    expect(text).toContain("masih menunggu verifikasi");
    expect(text).toContain("Agustus 2026, September 2026");
    expect(text.replace(/\s/g, "")).toContain("Rp80.000");
    expect(text).toContain(base.request.requestCode);
    expect(text).not.toMatch(/telah melakukan pembayaran|sudah diterima|sudah terverifikasi/i);
  });

  it.each(["verified", "rejected", "cancelled"] as const)(
    "never creates a pending CTA for %s request", (status) => {
      expect(createResidentPaymentWhatsAppUrl({ ...base, request: { ...base.request, status } })).toBeNull();
    },
  );

  it("fails closed on missing, invalid or unrelated destination", () => {
    for (const destinationNumber of [null, "", "+1 212 111 0100", "https://evil.example/620000", "0812/invalid"]) {
      expect(createResidentPaymentWhatsAppUrl({ ...base, destinationNumber })).toBeNull();
    }
  });

  it("rejects malformed periods, duplicate items, nonpositive amount, bad request code and invalid date", () => {
    const cases = [
      { ...base.request, periods: [] },
      { ...base.request, periods: ["2026-13"] },
      { ...base.request, periods: ["2026-09", "2026-09"] },
      { ...base.request, totalAmount: 0 },
      { ...base.request, totalAmount: -10 },
      { ...base.request, totalAmount: 1.5 },
      { ...base.request, requestCode: "invalid" },
      { ...base.request, createdAt: new Date("invalid") },
    ];
    for (const request of cases) {
      expect(createResidentPaymentWhatsAppUrl({ ...base, request })).toBeNull();
    }
  });
});
