"use client";

import { LogOut, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await authClient.signOut();
    router.replace("/");
  }
  return (
    <button className="button" type="button" onClick={signOut} disabled={busy}>
      {busy ? <LoaderCircle className="spinner" size={17} /> : <LogOut size={17} aria-hidden="true" />}
      Keluar
    </button>
  );
}
