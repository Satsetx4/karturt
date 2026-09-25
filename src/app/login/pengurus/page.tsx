import type { Metadata } from "next";
import { LoginPage } from "@/components/login-page";

export const metadata: Metadata = {
  title: "Masuk pengurus",
  alternates: { canonical: "/login/pengurus" },
  robots: { index: false, follow: false },
};

export default function OfficialLoginPage() {
  return <LoginPage kind="official" />;
}
