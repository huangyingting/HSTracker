"use client";

import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "./theme-init";

type Theme = "light" | "dark";
type Locale = "en" | "zh-Hans";

const THEME_CHANGE_EVENT = "hs-tracker:theme-change";

const copy = {
  en: {
    toLight: "Switch to light theme",
    toDark: "Switch to dark theme",
    light: "Light",
    dark: "Dark",
  },
  "zh-Hans": {
    toLight: "切换到浅色主题",
    toDark: "切换到深色主题",
    light: "浅色",
    dark: "深色",
  },
} as const;

// Read the theme the pre-hydration script applied to <html>, and stay in
// sync with our own toggle plus other tabs — without ever calling setState
// inside an effect, which keeps hydration clean and lint-compliant.
function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle({ locale }: { locale: Locale }) {
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "light");
  const messages = copy[locale];
  const isDark = theme === "dark";

  function toggleTheme() {
    const next: Theme = isDark ? "light" : "dark";
    const root = document.documentElement;
    root.dataset.theme = next;
    root.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the in-page choice still holds.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? messages.toLight : messages.toDark}
      title={isDark ? messages.toLight : messages.toDark}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-icon theme-toggle-icon-sun">☀</span>
        <span className="theme-toggle-icon theme-toggle-icon-moon">☾</span>
        <span className="theme-toggle-thumb" />
      </span>
      <span className="theme-toggle-text" aria-hidden="true">
        <span className="theme-toggle-text-light">{messages.light}</span>
        <span className="theme-toggle-text-dark">{messages.dark}</span>
      </span>
    </button>
  );
}
