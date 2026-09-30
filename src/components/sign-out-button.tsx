"use client";

import { LogOut, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setBusy(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign out failed");
      router.replace("/");
      router.refresh();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        className="button"
        type="button"
        onClick={signOut}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="spinner" size={17} />
        ) : (
          <LogOut size={17} aria-hidden="true" />
        )}
        Keluar
      </button>
      {error && (
        <p className="resident-note" role="alert">
          Belum berhasil keluar. Silakan coba lagi.
        </p>
      )}
    </div>
  );
}
