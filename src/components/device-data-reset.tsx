"use client";

import { RotateCcw } from "lucide-react";

export function DeviceDataReset() {
  function resetDeviceData() {
    if (!window.confirm("Hapus preferensi KartuRT yang tersimpan di perangkat ini?")) return;

    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
    try {
      const keys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("karturt:")) keys.push(key);
      }
      for (const key of keys) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // Continue clearing the other KartuRT preferences.
        }
      }
    } catch {
      // Storage can be unavailable in private browsing; the visual reset still applies.
    }
  }

  return (
    <button className="text-button reset-button" type="button" onClick={resetDeviceData}>
      <RotateCcw size={15} aria-hidden="true" />
      Reset data di perangkat
    </button>
  );
}
