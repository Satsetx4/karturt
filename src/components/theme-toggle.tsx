"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme, persist: boolean) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  if (persist) {
    try {
      window.localStorage.setItem("karturt:theme", theme);
    } catch {
      // The selected theme still applies for this page even when storage is unavailable.
    }
  }
  window.dispatchEvent(new Event("karturt:theme-change"));
}

function subscribe(callback: () => void) {
  window.addEventListener("karturt:theme-change", callback);
  return () => window.removeEventListener("karturt:theme-change", callback);
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerThemeSnapshot);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    applyTheme(next, true);
  }

  return (
    <button className="icon-button theme-toggle" type="button" onClick={toggleTheme} aria-label={`Aktifkan tema ${theme === "light" ? "gelap" : "terang"}`}>
      {theme === "light" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
      <span className="theme-toggle-label">{theme === "light" ? "Gelap" : "Terang"}</span>
    </button>
  );
}
