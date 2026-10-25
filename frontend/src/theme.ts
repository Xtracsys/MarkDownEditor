// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Theme application. Brand tokens are sampled from the supplied Xtracsys
// brand reference (design/brand-reference.png):
//   warm white #F6F5F1 · black #080808 · dark-field #0A0B0C · rust #B14831
// Derived UI shades (borders, muted text, dark-theme link tint) are
// interpolations of those four values built for contrast, and are NOT claimed
// to be official brand tokens. See docs/BRAND.md.

export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

let systemDark = false;
let mode: ThemeMode = "system";
const listeners: ((t: EffectiveTheme) => void)[] = [];

export function initTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  systemDark = mq.matches;
  mq.addEventListener("change", (e) => {
    systemDark = e.matches;
    if (mode === "system") apply();
  });
}

export function effective(): EffectiveTheme {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

export function setTheme(next: ThemeMode) {
  mode = next;
  apply();
}

export function themeMode(): ThemeMode {
  return mode;
}

export function onThemeChange(cb: (t: EffectiveTheme) => void) {
  listeners.push(cb);
}

function apply() {
  const t = effective();
  document.documentElement.dataset.theme = t;
  // Swap the logo treatment: black mark on light surfaces, white mark on dark.
  document.documentElement.querySelectorAll<HTMLImageElement>("img[data-logo]").forEach((img) => {
    const light = img.dataset.logoLight || "";
    const dark = img.dataset.logoDark || "";
    img.src = t === "dark" ? dark : light;
  });
  for (const cb of listeners) cb(t);
}
