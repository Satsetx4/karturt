import type { Metadata } from "next";
import { TwoFactorChallenge } from "@/components/two-factor-challenge";

export const metadata: Metadata = {
  title: "Verifikasi dua langkah",
  alternates: { canonical: "/system/2fa" },
  robots: { index: false, follow: false },
};

export default function TwoFactorPage() {
  return <TwoFactorChallenge />;
}
