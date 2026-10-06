import { describe, expect, it } from "vitest";
import { createResidentPaymentWhatsAppLink } from "../../src/lib/billing/resident-payment-whatsapp";

const base = {
  destinationNumber: "6289234234737",
  rtName: "RT.05",
  houseNumber: "D-07",
};

function messageFor(periods: string[], totalAmount: number) {
  const url = createResidentPaymentWhatsAppLink({
    ...base,
    request: {
      requestCode: "KRT-91A2B3C4D5E6",
      status: "pending",
      periods,
      totalAmount,
    },
  });
  expect(url).not.toBeNull();
  return {
    url: url!,
    message: new URL(url!).searchParams.get("text")!,
    readableMessage: new URL(url!).searchParams.get("text")!.replace(/\u00a0/g, " "),
  };
}

describe("resident demo WhatsApp verification link", () => {
  it("formats one requested month in Indonesian with stored amount, house and code", () => {
    const { url, message, readableMessage } = messageFor(["2026-10"], 40000);
    expect(url).toMatch(/^https:\/\/wa\.me\/6289234234737\?text=/);
    expect(message).toContain("rumah D-07");
    expect(readableMessage).toContain("Oktober 2026 sebesar Rp40.000");
    expect(message).toContain("Kode permintaan: KRT-91A2B3C4D5E6.");
  });

  it("formats two periods in Indonesian", () => {
    expect(messageFor(["2026-07", "2026-08"], 80000).readableMessage)
      .toContain("Juli 2026, dan Agustus 2026 sebesar Rp80.000");
  });

  it("formats three or more exact periods and retains the stored request total", () => {
    const { readableMessage } = messageFor(["2026-07", "2026-08", "2026-09", "2026-10"], 125000);
    expect(readableMessage).toContain("Juli 2026, Agustus 2026, September 2026, dan Oktober 2026");
    expect(readableMessage).toContain("sebesar Rp125.000");
    expect(readableMessage).not.toContain("Rp160.000");
  });

  it("URL-encodes the full Indonesian message", () => {
    const { url, message } = messageFor(["2026-10"], 40000);
    const encoded = url.split("?text=")[1];
    expect(encoded).toBe(encodeURIComponent(message));
    expect(url).toContain("%20");
    expect(url).toContain("%20Rp40.000");
  });

  it("fails safely without a configured demo number", () => {
    expect(createResidentPaymentWhatsAppLink({
      ...base,
      destinationNumber: undefined,
      request: { requestCode: "KRT-91A2B3C4D5E6", status: "pending", periods: ["2026-10"], totalAmount: 40000 },
    })).toBeNull();
  });

  it("only creates links for pending requests and rejects invalid request snapshots", () => {
    expect(createResidentPaymentWhatsAppLink({
      ...base,
      request: { requestCode: "KRT-91A2B3C4D5E6", status: "verified", periods: ["2026-10"], totalAmount: 40000 },
    })).toBeNull();
    expect(createResidentPaymentWhatsAppLink({
      ...base,
      request: { requestCode: "KRT-91A2B3C4D5E6", status: "pending", periods: [], totalAmount: 40000 },
    })).toBeNull();
  });
});
