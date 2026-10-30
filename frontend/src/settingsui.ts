// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// The settings modal. Returns the new settings on Save, or null on cancel.

import type { AppSettings } from "./ipc";
import { showModal } from "./ui";

interface Row {
  key: string;
  label: string;
  sub?: string;
  control: HTMLElement;
}

function toggle(label: string, sub: string | undefined, checked: boolean, onChange: (v: boolean) => void): Row {
  const wrap = document.createElement("label");
  wrap.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const track = document.createElement("span");
  track.className = "track";
  wrap.append(input, track);
  return { key: "", label, sub, control: wrap };
}

function select(label: string, sub: string | undefined, options: [string, string][], value: string, onChange: (v: string) => void): Row {
  const sel = document.createElement("select");
  for (const [val, text] of options) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = text;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener("change", () => onChange(sel.value));
  return { key: "", label, sub, control: sel };
}

export async function openSettingsModal(current: AppSettings): Promise<AppSettings | null> {
  const draft: AppSettings = { ...current };

  const rows: Row[] = [
    {
      ...select("Theme", "Light and dark follow the supplied Xtracsys palette.", [
        ["system", "Follow System"],
        ["light", "Light"],
        ["dark", "Dark"],
      ], current.theme, (v) => (draft.theme = v)),
    },
    {
      ...toggle("Auto-save", "Off by default. When on, named files save after the idle delay below. Untitled documents are never auto-saved, and files changed on disk are never auto-overwritten.",
        current.autoSaveEnabled, (v) => (draft.autoSaveEnabled = v)),
    },
    {
      ...toggle("Restore session on launch", "Reopens the documents that were open when you last quit. Paths only, stored in this app's private data folder; turning it off also erases the recorded session.",
        current.restoreSession, (v) => (draft.restoreSession = v)),
    },
  ];

  const delayInput = document.createElement("input");
  delayInput.type = "number";
  delayInput.min = "250";
  delayInput.max = "60000";
  delayInput.step = "250";
  delayInput.value = String(current.autoSaveDelayMs);
  delayInput.addEventListener("change", () => {
    const n = Math.round(Number(delayInput.value));
    draft.autoSaveDelayMs = Math.min(60000, Math.max(250, Number.isFinite(n) ? n : 2000));
  });
  rows.push({ key: "", label: "Auto-save delay (ms)", sub: "Idle time before an auto-save fires.", control: delayInput });

  rows.push({
    ...toggle("Word wrap", "Soft-wrap long lines to the window (never modifies the file).",
      current.wordWrap, (v) => (draft.wordWrap = v)),
  });
  rows.push({
    ...select("Indent size", undefined, [["2", "2 spaces"], ["4", "4 spaces"], ["8", "8 spaces"]],
      String(current.tabSize), (v) => (draft.tabSize = Number(v))),
  });
  rows.push({
    ...toggle("Insert spaces for Tab", undefined, current.insertSpaces, (v) => (draft.insertSpaces = v)),
  });
  rows.push({
    ...toggle("Line numbers", undefined, current.showLineNumbers, (v) => (draft.showLineNumbers = v)),
  });
  rows.push({
    ...toggle("Highlight active line", undefined, current.highlightActiveLine, (v) => (draft.highlightActiveLine = v)),
  });
  rows.push({
    ...select("Editor font size", undefined, [["0", "Default"], ...[11, 12, 13, 14, 15, 16, 18].map((n) => [String(n), `${n} px`] as [string, string])],
      String(current.editorFontSize), (v) => (draft.editorFontSize = Number(v))),
  });
  rows.push({
    ...toggle("Block remote resources in preview", "On by default: the Markdown preview loads no remote images or fonts — local-first and offline.",
      current.blockRemoteResources, (v) => (draft.blockRemoteResources = v)),
  });

  // Disclosed, always-on crash recovery (informational row).
  const recovInfo = document.createElement("div");
  recovInfo.style.cssText = "color: var(--text-faint); font-size: 11px; max-width: 260px; text-align: right;";
  recovInfo.textContent = "Always on";
  rows.push({
    key: "recovery",
    label: "Crash recovery",
    sub: "Unsaved changes are periodically copied to this app's private data folder and offered for recovery after a crash. They never touch your files or your project folders.",
    control: recovInfo,
  });

  // Build DOM.
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("role", "dialog");
  const head = document.createElement("div");
  head.className = "modal-head";
  head.textContent = "Settings";
  const body = document.createElement("div");
  body.className = "modal-body";
  body.style.width = "480px";

  const sectionOf = (r: Row) => {
    if (r.label === "Theme") return "Appearance";
    if (r.label.startsWith("Auto-save") || r.label.startsWith("Restore session")) return "Auto-save";
    if (r.label === "Block remote resources in preview") return "Preview";
    if (r.label === "Crash recovery") return "Preview";
    return "Editor";
  };
  let lastSection = "";
  for (const r of rows) {
    const sec = sectionOf(r);
    if (sec !== lastSection) {
      const h = document.createElement("div");
      h.className = "settings-section";
      h.textContent = sec;
      body.appendChild(h);
      lastSection = sec;
    }
    const row = document.createElement("div");
    row.className = "setting-row";
    const labelWrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = r.label;
    labelWrap.appendChild(label);
    if (r.sub) {
      const sub = document.createElement("div");
      sub.className = "setting-sub";
      sub.textContent = r.sub;
      labelWrap.appendChild(sub);
    }
    row.append(labelWrap, r.control);
    body.appendChild(row);
  }

  const foot = document.createElement("div");
  foot.className = "modal-foot";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.className = "btn primary";
  save.textContent = "Save";
  foot.append(cancel, save);
  modal.append(head, body, foot);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Inert background while the dialog is open — keyboard input cannot reach
  // the editor behind the overlay, and Tab cannot escape the dialog.
  const appRoot = document.getElementById("app");
  if (appRoot) appRoot.inert = true;
  const saveBtn = foot.querySelector(".btn.primary") as HTMLButtonElement | null;
  setTimeout(() => (saveBtn ?? modal).focus(), 0);

  return new Promise((resolve) => {
    const close = (result: AppSettings | null) => {
      overlay.remove();
      if (appRoot && !document.querySelector(".overlay")) appRoot.inert = false;
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (document.body.querySelector(".overlay:last-of-type") !== overlay) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay && document.body.querySelector(".overlay:last-of-type") === overlay) close(null);
    });
    cancel.addEventListener("click", () => close(null));
    save.addEventListener("click", () => close(draft));
  });
}

export { showModal };

/** Editable file-name dialog for pasted images. Returns the chosen name, or
 * null on cancel. */
export async function imageNameDialog(suggested: string): Promise<string | null> {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("role", "dialog");
  const head = document.createElement("div");
  head.className = "modal-head";
  head.textContent = "Save pasted image";
  const body = document.createElement("div");
  body.className = "modal-body";
  body.style.width = "420px";
  const note = document.createElement("div");
  note.textContent =
    "The image will be written as a new file into the document's folder and referenced from the Markdown.";
  note.style.marginBottom = "10px";
  const input = document.createElement("input");
  input.type = "text";
  input.value = suggested;
  input.style.cssText =
    "width:100%;background:var(--bg);border:1px solid var(--border-strong);color:var(--text);border-radius:6px;padding:6px 8px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace";
  body.append(note, input);
  const foot = document.createElement("div");
  foot.className = "modal-foot";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.className = "btn primary";
  save.textContent = "Save Image";
  foot.append(cancel, save);
  modal.append(head, body, foot);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const appRoot = document.getElementById("app");
  if (appRoot) appRoot.inert = true;
  input.focus();
  input.select();

  return new Promise((resolve) => {
    const close = (v: string | null) => {
      overlay.remove();
      const appRoot = document.getElementById("app");
      if (appRoot && !document.querySelector(".overlay")) appRoot.inert = false;
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (document.body.querySelector(".overlay:last-of-type") !== overlay) return;
      if (e.key === "Escape") { e.preventDefault(); close(null); }
      if (e.key === "Enter") { e.preventDefault(); close(input.value.trim() || null); }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(null);
    });
    cancel.addEventListener("click", () => close(null));
    save.addEventListener("click", () => close(input.value.trim() || null));
  });
}
