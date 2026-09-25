import type { Metadata } from "next";
import { LoginPage } from "@/components/login-page";

export const metadata: Metadata = {
  title: "Masuk warga",
  alternates: { canonical: "/login/warga" },
  robots: { index: false, follow: false },
};

export default function ResidentLoginPage() {
  return <LoginPage kind="resident" />;
}
