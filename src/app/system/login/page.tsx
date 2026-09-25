import type { Metadata } from "next";
import { LoginPage } from "@/components/login-page";

export const metadata: Metadata = {
  title: "Pemulihan sistem",
  alternates: { canonical: "/system/login" },
  robots: { index: false, follow: false },
};

export default function SystemAdminLoginPage() {
  return <LoginPage kind="system_admin" />;
}
