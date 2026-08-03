"use client";

import { useEffect } from "react";

type Theme = "dark" | "light";

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem("theme");
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}

function toggle() {
  // Effective current theme first checks for an explicit prior choice, and
  // only falls back to system preference — not `classList.contains("dark")`,
  // which doesn't reflect the CSS-media-query-only case (OS dark, no class
  // set yet) and would otherwise make the first click a no-op.
  const current = storedTheme() ?? systemTheme();
  const next: Theme = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("theme", next);
}

export function ThemeToggle() {
  // Re-applies a previously chosen theme override on mount. globals.css
  // handles the no-override case (system preference) via a plain CSS media
  // query, so this only matters — and only ever fires — for a user who
  // explicitly picked a theme different from their OS default; a direct DOM
  // mutation here (not a setState call) doesn't run afoul of this project's
  // set-state-in-effect lint rule.
  useEffect(() => {
    const stored = storedTheme();
    if (stored) applyTheme(stored);
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="fixed right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm shadow-[0_0_0_1px_rgba(0,0,0,0.08)] dark:bg-zinc-900 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
    >
      <span className="dark:hidden">🌙</span>
      <span className="hidden dark:inline">☀️</span>
    </button>
  );
}
