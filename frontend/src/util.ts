// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fallback for restricted webview contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
  }
}

export function revealLabel(): string {
  const p = navigator.platform || "";
  if (p.includes("Mac")) return "Finder";
  if (p.includes("Win")) return "Explorer";
  return "File Manager";
}
