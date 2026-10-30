// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Small DOM helpers for modals, toasts, and the status bar. No framework;
// the whole UI is a few hundred lines of typed DOM code on purpose.

export interface ModalButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

export interface ModalSpec {
  title: string;
  body: string; // text content; newlines preserved
  mono?: string; // optional monospace detail block
  buttons: ModalButton[];
  cancelValue?: string; // value returned on Escape/overlay click
}

export function showModal(spec: ModalSpec): Promise<string> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const head = document.createElement("div");
    head.className = "modal-head";
    head.textContent = spec.title;
    const body = document.createElement("div");
    body.className = "modal-body";
    body.textContent = spec.body;
    if (spec.mono) {
      const mono = document.createElement("div");
      mono.className = "mono";
      mono.textContent = spec.mono;
      body.appendChild(mono);
    }
    const foot = document.createElement("div");
    foot.className = "modal-foot";
    for (const b of spec.buttons) {
      const btn = document.createElement("button");
      btn.className = "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : "");
      btn.textContent = b.label;
      btn.addEventListener("click", () => close(b.value));
      foot.appendChild(btn);
    }

    modal.append(head, body, foot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    // Move focus into the dialog and make the app background inert: keyboard
    // input goes to the modal, never to the editor behind the overlay
    // (Enter/Escape then act on the dialog only, Tab cannot escape).
    const primaryBtn = foot.querySelector(".btn.primary") as HTMLButtonElement | null;
    const appRoot = document.getElementById("app");
    if (appRoot) appRoot.inert = true;
    setTimeout(() => (primaryBtn ?? modal).focus(), 0);
    modal.tabIndex = -1;

    const isTopmost = () =>
      document.body.querySelector(".overlay:last-of-type") === overlay ||
      document.body.lastElementChild === overlay;
    const onKey = (e: KeyboardEvent) => {
      if (!isTopmost()) return; // stacked modals resolve one at a time
      if (e.key === "Escape") {
        e.preventDefault();
        close(spec.cancelValue ?? "cancel");
      } else if (e.key === "Enter") {
        const primary = spec.buttons.find((b) => b.primary);
        if (primary) {
          e.preventDefault();
          close(primary.value);
        }
      }
    };
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay && isTopmost()) close(spec.cancelValue ?? "cancel");
    });
    document.addEventListener("keydown", onKey, true);

    function close(value: string) {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      const appRoot = document.getElementById("app");
      if (appRoot && !document.querySelector(".overlay")) appRoot.inert = false;
      resolve(value);
    }
  });
}

export function toast(title: string, detail?: string, ms = 5000) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  const t = document.createElement("div");
  t.className = "toast-title";
  t.textContent = title;
  el.appendChild(t);
  if (detail) {
    const d = document.createElement("div");
    d.className = "toast-detail";
    d.textContent = detail;
    el.appendChild(d);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Async confirm-style helper used by unsaved-work prompts. */
export function unsavedPrompt(fileName: string): Promise<"save" | "discard" | "cancel"> {
  return showModal({
    title: "Unsaved changes",
    body: `“${fileName}” has unsaved changes. Save before closing?`,
    buttons: [
      { label: "Save", value: "save", primary: true },
      { label: "Discard", value: "discard", danger: true },
      { label: "Cancel", value: "cancel" },
    ],
    cancelValue: "cancel",
  }) as Promise<"save" | "discard" | "cancel">;
}

export function quitPrompt(dirtyNames: string[]): Promise<"save-all" | "discard-all" | "cancel"> {
  const list = dirtyNames.length === 1
    ? `“${dirtyNames[0]}” has unsaved changes.`
    : `${dirtyNames.length} documents have unsaved changes:\n${dirtyNames.map((n) => `• ${n}`).join("\n")}`;
  return showModal({
    title: "Quit Xtracsys Editor",
    body: list + "\n\nSave before quitting?",
    buttons: [
      { label: dirtyNames.length === 1 ? "Save" : "Save All", value: "save-all", primary: true },
      { label: "Discard", value: "discard-all", danger: true },
      { label: "Cancel", value: "cancel" },
    ],
    cancelValue: "cancel",
  }) as Promise<"save-all" | "discard-all" | "cancel">;
}

export interface BannerAction {
  label: string;
  value: string;
  primary?: boolean;
}

/** Info/warning strip above the editor (external changes, read-only notes). */
export function showBanner(
  slot: HTMLElement,
  id: string,
  text: string,
  actions: BannerAction[],
): Promise<string> {
  return new Promise((resolve) => {
    const existing = slot.querySelector(`[data-banner="${CSS.escape(id)}"]`);
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "banner";
    el.dataset.banner = id;
    const span = document.createElement("span");
    span.className = "banner-text";
    span.textContent = text;
    el.appendChild(span);
    for (const a of actions) {
      const b = document.createElement("button");
      b.textContent = a.label;
      if (a.primary) b.className = "primary";
      b.addEventListener("click", () => {
        el.remove();
        resolve(a.value);
      });
      el.appendChild(b);
    }
    slot.appendChild(el);
  });
}

export function removeBanner(slot: HTMLElement, id: string) {
  slot.querySelector(`[data-banner="${CSS.escape(id)}"]`)?.remove();
}
