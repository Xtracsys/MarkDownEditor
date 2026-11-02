// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// The application controller: tab lifecycle, save flows, auto-save, preview
// modes, external-change handling, status bar, and event wiring. All file
// operations go through the Backend interface; this file performs no I/O of
// its own.

import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import type { Backend, Eol, OpenOutcome, TabInfo, AppSettings, WatchEvent } from "./ipc";
import { eolField, equalsSaved, setEolsEffect, DEFAULT_EOL } from "./eol";
import { makeState, settingsEffects, isMarkdownPath, reconfigureLanguage } from "./editor";
import { PreviewPane } from "./preview";
import { parseOutline } from "./outline";
import { copyText, revealLabel } from "./util";
import { imageNameDialog } from "./settingsui";
import { showModal, toast, unsavedPrompt, quitPrompt, showBanner, removeBanner } from "./ui";
import { initTheme, setTheme, effective, onThemeChange, type ThemeMode } from "./theme";

export type ViewMode = "source" | "split" | "preview";

class Tab {
  dirtyRecheck: number | undefined;
  encodingDirty = false;
  info: TabInfo;
  state: EditorState;
  dirty = false;
  savedContent: string;
  savedEols: Eol[];
  extState: "none" | "changed" | "deleted" = "none";
  markdown: boolean;
  mode: ViewMode = "source";
  bannerResolve: ((v: string) => void) | null = null;

  constructor(info: TabInfo, state: EditorState) {
    this.info = info;
    this.state = state;
    this.savedContent = info.content;
    this.savedEols = info.eols ? info.eols.slice() : [""];
    this.markdown = isMarkdownPath(info.path);
  }
  fileName(): string {
    if (!this.info.path) return "Untitled";
    return this.info.path.split(/[\\/]/).pop() || this.info.path;
  }
}

export class Application {
  private backend: Backend;
  private view!: EditorView;
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  // Field-initialized so startup-adjacent callers (tests, early events) can
  // never observe undefined settings; start() overwrites with persisted
  // values as soon as they arrive.
  private settings = defaultSettings();
  private preview: PreviewPane;
  private autosaveTimer: number | undefined;
  private snapshotTimer: number | undefined;
  private previewDebounce: number | undefined;
  private saveInFlight = new Set<string>();
  private saveCanceled = false;
  private mode: ViewMode = "source";
  private splitRatio = 0.5;
  private quitting = false;

  // DOM anchors
  private tabbar: HTMLElement;
  private main: HTMLElement;
  private editorHost: HTMLElement;
  private bannerSlot: HTMLElement;
  private previewHost: HTMLElement;
  private statusbar: HTMLElement;
  private empty: HTMLElement;

  constructor(backend: Backend) {
    this.backend = backend;
    this.tabbar = document.getElementById("tabbar")!;
    this.main = document.getElementById("main")!;
    this.editorHost = document.getElementById("editor-host")!;
    this.bannerSlot = document.getElementById("banner-slot")!;
    this.previewHost = document.getElementById("preview-host")!;
    this.statusbar = document.getElementById("statusbar")!;
    this.empty = document.getElementById("empty")!;
    this.preview = new PreviewPane(this.previewHost, {
      openExternal: (url) => {
        void this.backend.openExternal(url).then((err) => {
          if (err) toast("Link not opened", err);
        });
      },
      remoteBlocked: (urls) => {
        if (this.settings.blockRemoteResources && urls.length) {
          toast("Remote resources blocked", `${urls.length} remote image${urls.length === 1 ? "" : "s"} in this document ${urls.length === 1 ? "was" : "were"} not loaded (offline by default).`);
        }
      },
    });
  }

  private appVersion = "";

  async start() {
    initTheme();
    onThemeChange(() => this.applyThemeToEditor());
    this.appVersion = await this.backend
      .appInfo()
      .then((i) => i.version || "")
      .catch(() => "");
    this.settings = await this.backend.getSettings().catch((e) => {
      console.error("getSettings failed:", e);
      toast("Settings unavailable", String(e));
      return defaultSettings();
    });
    setTheme(this.settings.theme as ThemeMode);
    this.preview.setBlockRemote(this.settings.blockRemoteResources);

    this.view = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({ doc: "", extensions: [] }),
    });
    this.view.dom.addEventListener("paste", (e) => this.handlePaste(e as ClipboardEvent));

    try {
      this.wireDom();
      this.wireBackendEvents();
      this.bindShortcuts();
      await this.newTab();
      // External opens (Open With, argv, drag-drop) may queue before the UI
      // is up. markExternalReady returns the backlog as its RPC response —
      // delivered here directly, immune to event-wiring races — and flips
      // the app to live event delivery. MUST come before offerRecovery:
      // the recovery modal is interactive and must never gate delivery.
      const queued = await this.backend.markExternalReady();
      if (queued && queued.length) {
        try {
          await this.openPaths(queued);
        } catch (e) {
          toast("Could not open queued documents", String(e));
        }
      }
      // The recovery offer must not gate startup or session restore: it is a
      // modal the user answers while the editor is already usable.
      void this.offerRecovery();
      if (this.settings.restoreSession) {
        try {
          const last = await this.backend.getLastSession();
          const known = new Set(this.tabs.map((t) => t.info.path));
          const missing = last.filter((p) => p && !known.has(p));
          // Never block the launch with per-file modals: unreadable session
          // entries are skipped and summarized in one toast.
          if (missing.length) await this.openPaths(missing, { silentFailures: true });
        } catch {
          // session restore is best-effort
        }
      }
    } catch (e) {
      this.showFatalStartupError(String(e));
      return;
    }
  }

  /** Full-window error instead of a half-initialized UI when the backend
   * bindings never arrive (build/packaging problem, not user error). */
  private showFatalStartupError(detail: string) {
    const el = document.getElementById("empty")!;
    el.classList.remove("hidden");
    el.innerHTML = "";
    const box = document.createElement("div");
    box.className = "empty-title";
    box.style.maxWidth = "520px";
    box.style.textAlign = "center";
    box.textContent =
      "The editor could not reach its backend. This build is broken — please reinstall. (" +
      detail + ")";
    el.appendChild(box);
    console.error("backend unavailable:", detail);
  }

  // ------------------------------------------------------------------
  // Tab lifecycle

  async newTab() {
    const info = await this.backend.newTab();
    const state = await makeState({
      info: { ...info, eols: info.eols ?? [""], defaultEol: info.defaultEol ?? "\n" },
      settings: this.settings,
      theme: effective(),
      extraKeys: this.editorKeys(),
    });
    const tab = new Tab(info, state);
    this.tabs.push(tab);
    this.setActive(tab);
  }

  async openPathsWithDialog() {
    const outcomes = await this.backend.pickAndOpen().catch((e) => {
      toast("Could not open files", String(e));
      return [];
    });
    await this.openOutcomes(outcomes);
  }

  async openPaths(paths: string[], opts: { silentFailures?: boolean } = {}) {
    try {
      if (!paths.length) return;
      const outcomes = await this.backend.openPaths(paths);
      await this.openOutcomes(outcomes, paths, opts);
    } catch (e) {
      console.error("openPaths INTERNAL:", e && (e as Error).stack ? (e as Error).stack : String(e));
      throw e;
    }
  }

  private async openOutcomes(outcomes: OpenOutcome[], paths?: string[], opts: { silentFailures?: boolean } = {}) {
    let firstTab: Tab | null = null;
    let issues = 0;
    const skipped: string[] = [];
    for (let i = 0; i < outcomes.length; i++) {
      const oc = outcomes[i];
      if (oc.tab) {
        const state = await makeState({
          info: { ...oc.tab, eols: oc.tab.eols ?? [""], defaultEol: oc.tab.defaultEol ?? "\n" },
          settings: this.settings,
          theme: effective(),
          extraKeys: this.editorKeys(),
        });
        const tab = new Tab(oc.tab, state);
        if (oc.tab.warnings && oc.tab.warnings.length) {
          toast("Opened with warnings", oc.tab.warnings[0]);
        }
        this.tabs.push(tab);
        if (!firstTab) firstTab = tab;
      } else if (oc.issue) {
        issues++;
        if (opts.silentFailures) {
          skipped.push((paths && paths[i] ? paths[i] : "file") + " — " + oc.issue.message);
          continue;
        }
        this.lastIssuePath = paths && paths[i] ? paths[i] : this.lastIssuePath;
        await this.showOpenIssue(oc.issue.message, oc.issue.detail || "", oc.issue.hexPreview || "", oc.issue.canReadOnly);
      }
    }
    if (skipped.length) {
      toast("Some files could not be opened", skipped.join("\n"), 8000);
    }
    if (firstTab) {
      // Replace the initial empty untitled tab if it is untouched.
      const pristine = this.tabs.find((t) => !t.info.path && !t.dirty && t.savedContent === "");
      this.setActive(firstTab);
      if (pristine && pristine !== firstTab && this.tabs.length > 1) {
        await this.closeTabBackendOnly(pristine);
      }
    } else if (!issues) {
      // canceled dialog: nothing to do
    }
  }

  private async showOpenIssue(message: string, detail: string, hex: string, canReadOnly: boolean) {
    const buttons = canReadOnly
      ? [
          { label: "Open Read-Only", value: "ro", primary: true },
          { label: "Cancel", value: "cancel" },
        ]
      : [{ label: "OK", value: "ok", primary: true }];
    const choice = await showModal({
      title: "Cannot open this file",
      body: message + (detail ? `\n\n${detail}` : ""),
      mono: hex ? `bytes: ${hex}` : undefined,
      buttons,
      cancelValue: "cancel",
    });
    if (choice === "ro" && canReadOnly) {
      // Re-open the most recently refused path read-only.
      const ro = await this.backend.openPathReadOnly(this.lastIssuePath);
      if (ro.tab) {
        const state = await makeState({ info: ro.tab, settings: this.settings, theme: effective(), extraKeys: this.editorKeys() });
        const tab = new Tab(ro.tab, state);
        this.tabs.push(tab);
        this.setActive(tab);
      } else if (ro.issue) {
        toast("Still cannot open", ro.issue.message);
      }
    }
  }
  private lastIssuePath = "";

  async closeActiveTab() {
    if (!this.active) return;
    await this.closeTab(this.active);
  }

  private async closeTab(tab: Tab) {
    if (tab.dirty) {
      const choice = await unsavedPrompt(tab.fileName());
      if (choice === "cancel") return;
      if (choice === "save") {
        const ok = await this.saveTab(tab);
        if (!ok) return; // save failed or was canceled; keep the tab open
      }
    }
    const idx = this.tabs.indexOf(tab);
    if (idx < 0) return;
    this.tabs.splice(idx, 1);
    removeBanner(this.bannerSlot, `ext-${tab.info.tabId}`);
    await this.backend.closeTab(tab.info.tabId);
    void this.backend.clearRecovery(tab.info.tabId);
    if (this.active === tab) {
      const next = this.tabs[idx] || this.tabs[idx - 1] || null;
      this.active = null;
      if (next) this.setActive(next);
      else {
        this.view.setState(EditorState.create({ doc: "", extensions: [] }));
        this.renderTabs();
        this.refreshStatus();
        this.refreshLayout();
        this.empty.classList.remove("hidden");
        await this.backend.setWindowTitle("Xtracsys Editor");
        void this.renderEmptyRecents();
      }
    } else {
      this.renderTabs();
    }
  }

  /** Remove the untouched initial tab without prompts. */
  private async closeTabBackendOnly(tab: Tab) {
    const idx = this.tabs.indexOf(tab);
    if (idx >= 0) this.tabs.splice(idx, 1);
    await this.backend.closeTab(tab.info.tabId);
    this.renderTabs();
  }

  // ------------------------------------------------------------------
  // Saving

  async saveActive(): Promise<boolean> {
    if (!this.active) return false;
    return this.saveTab(this.active);
  }

  async saveActiveAs(): Promise<boolean> {
    if (!this.active) return false;
    return this.saveTabAs(this.active);
  }

  async saveTab(tab: Tab, overwrite = false): Promise<boolean> {
    if (tab.info.readOnly) {
      toast("Read-only document", "This file could not be decoded cleanly, so saving in place is disabled. Use Save As to export a UTF-8 copy.");
      return false;
    }
    if (!tab.info.path) return this.saveTabAs(tab);
    if (this.saveInFlight.has(tab.info.tabId)) return false;
    this.saveInFlight.add(tab.info.tabId);
    try {
      return await this.doSave(tab, tab.info.path, overwrite);
    } finally {
      this.saveInFlight.delete(tab.info.tabId);
    }
  }

  async saveTabAs(tab: Tab): Promise<boolean> {
    const suggested = tab.info.path ? tab.fileName() : tab.markdown ? "Untitled.md" : "Untitled.txt";
    const target = await this.backend.pickSaveAsPath(suggested).catch((e) => {
      this.saveCanceled = true;
      toast("Save dialog unavailable", String(e));
      return "";
    });
    if (!target) this.saveCanceled = true; // user declined the dialog
    if (!target) return false; // canceled
    if (this.saveInFlight.has(tab.info.tabId)) return false;
    this.saveInFlight.add(tab.info.tabId);
    try {
      return await this.doSave(tab, target, false);
    } finally {
      this.saveInFlight.delete(tab.info.tabId);
    }
  }

  private async doSave(tab: Tab, path: string, overwrite: boolean, quiet = false): Promise<boolean> {
    const content = tab.state.doc.toString();
    const eols = tab.state.field(eolField).slice();
    const resp = await this.backend.saveTab(
      tab.info.tabId, path, content, eols, tab.info.encoding, overwrite,
    );
    if (resp.ok) {
      tab.dirty = false;
      tab.encodingDirty = false;
      tab.savedContent = content;
      tab.savedEols = eols;
      tab.extState = "none";
      void this.backend.clearRecovery(tab.info.tabId);
      removeBanner(this.bannerSlot, `ext-${tab.info.tabId}`);
      const oldPath = tab.info.path;
      const pathChanged = oldPath !== path;
      tab.info.path = resp.tab?.path || path;
      if (resp.tab) tab.info.readOnly = resp.tab.readOnly;
      await this.backend.setDirty(tab.info.tabId, false);
      if (pathChanged) {
        // Only the language follows the new name — the editor state (undo
        // history, cursor, scroll, EOL field) must survive Save As.
        tab.markdown = isMarkdownPath(tab.info.path);
        tab.state = reconfigureLanguage(tab.state, oldPath, tab.info.path);
        if (this.active === tab) this.view.setState(tab.state);
        void content;
      }
      this.renderTabs();
      this.refreshStatus();
      this.refreshWindowTitle();
      return true;
    }

    if (resp.issue?.reason === "external-change") {
      if (quiet) {
        // Auto-save must never pop a decision modal from a background save.
        tab.extState = "changed";
        if (this.active === tab) this.showTabBanners(tab);
        toast("Auto-save paused", `“${tab.fileName()}” changed on disk — auto-save will not overwrite it. Decide via the banner.`);
        return false;
      }
      const choice = await showModal({
        title: "File changed on disk",
        body: `“${tab.fileName()}” was modified outside the editor after you opened it.\n\nOverwriting will replace the disk version with your edits. Reload discards your edits and loads the disk version.`,
        buttons: [
          { label: "Overwrite", value: "overwrite", danger: true },
          { label: "Reload Disk Version", value: "reload" },
          { label: "Open Disk Version in New Tab", value: "compare" },
          { label: "Cancel", value: "cancel" },
        ],
        cancelValue: "cancel",
      });
      // Note: this.doSave, not saveTab — the original guarded saveTab call is
      // still awaiting this modal, so a re-entrant saveTab would no-op.
      if (choice === "cancel") this.saveCanceled = true;
      if (choice === "overwrite") {
        const ok = await this.doSave(tab, tab.info.path, true);
        if (ok && this.active === tab) this.renderTabs();
        return ok;
      }
      if (choice === "reload") return this.reloadFromDisk(tab, true);
      if (choice === "compare") await this.openPaths([tab.info.path]);
      return false;
    }
    toast("Save failed", resp.issue?.message || resp.message || "The file was not written.");
    return false;
  }

  /** Reload the on-disk content into an existing tab. */
  private async reloadFromDisk(tab: Tab, discardEdits: boolean): Promise<boolean> {
    if (tab.dirty && !discardEdits) {
      const choice = await showModal({
        title: "Discard your edits?",
        body: "Reloading from disk will discard your unsaved changes to this document. Your edits can be kept by saving them to a new file first (Save As).",
        buttons: [
          { label: "Discard and Reload", value: "discard", danger: true },
          { label: "Cancel", value: "cancel" },
        ],
        cancelValue: "cancel",
      });
      if (choice !== "discard") return false;
    }
    const outcome = await this.backend.openPaths([tab.info.path]);
    const fresh = outcome[0]?.tab;
    if (!fresh) {
      toast("Reload failed", outcome[0]?.issue?.message || "unknown error");
      return false;
    }
    // Swap backend identity: new tab id carries fresh watcher state. The old
    // tab's recovery snapshot is discarded work — never let it resurrect.
    await this.backend.closeTab(tab.info.tabId);
    void this.backend.clearRecovery(tab.info.tabId);
    removeBanner(this.bannerSlot, `ext-${tab.info.tabId}`);
    fresh.eols = fresh.eols.length ? fresh.eols : [""];
    const state = await makeState({
      info: fresh,
      settings: this.settings,
      theme: effective(),
      extraKeys: this.editorKeys(),
    });
    const idx = this.tabs.indexOf(tab);
    const newTab = new Tab(fresh, state);
    newTab.mode = tab.mode;
    this.tabs[idx] = newTab;
    if (this.active === tab) this.setActive(newTab);
    this.renderTabs();
    return true;
  }

  // ------------------------------------------------------------------
  // Active tab + rendering

  private setActive(tab: Tab) {
    // External-change banners describe one tab: drop them all on switch.
    this.bannerSlot.querySelectorAll('[data-banner^="ext-"]').forEach((el) => el.remove());
    this.active = tab;
    if (this.outlineVisible) this.renderOutline(); // per-tab headings, never stale
    this.view.setState(tab.state);
    this.mode = tab.mode;
    this.empty.classList.add("hidden");
    removeBanner(this.bannerSlot, "welcome");
    this.renderTabs();
    this.refreshStatus();
    this.refreshLayout();
    this.refreshPreview(true);
    this.refreshWindowTitle();
    this.showTabBanners(tab);
    if (this.mode !== "preview") this.view.focus();
  }

  private refreshWindowTitle() {
    const tab = this.active;
    const app = `Xtracsys Editor${this.appVersion ? " " + this.appVersion : ""}`;
    const title = tab ? `${tab.dirty ? "● " : ""}${tab.fileName()} — ${app}` : app;
    void this.backend.setWindowTitle(title);
  }

  private renderTabs() {
    // Keep the trailing controls, rebuild the tab buttons.
    const controls = this.tabbar.querySelector("#tabbar-controls");
    this.tabbar.querySelectorAll(".tab").forEach((el) => el.remove());
    for (const tab of this.tabs) {
      const el = document.createElement("div");
      el.className = "tab" + (tab === this.active ? " active" : "") + (tab.dirty ? " dirty" : "") + (tab.info.readOnly ? " readonly" : "");
      el.title = tab.info.path || "Untitled";
      const dirty = document.createElement("span");
      dirty.className = "tab-dirty";
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tab.fileName();
      const ro = document.createElement("span");
      ro.className = "tab-ro";
      ro.textContent = "RO";
      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.closeTab(tab);
      });
      el.append(dirty, label, ro, close);
      el.addEventListener("click", () => {
        if (this.active !== tab) this.setActive(tab);
      });
      el.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.closeTab(tab);
        }
      });
      this.tabbar.insertBefore(el, controls || null);
    }
    (document.getElementById("btn-save") as HTMLButtonElement).disabled = !this.active || this.active.info.readOnly;

    const md = !!this.active?.markdown;
    for (const b of ["btn-mode-source", "btn-mode-split", "btn-mode-preview"]) {
      const el = document.getElementById(b) as HTMLButtonElement;
      el.disabled = !md;
    }
    (document.getElementById("btn-outline") as HTMLButtonElement).disabled = !md;
    (document.getElementById("btn-print") as HTMLButtonElement).disabled = !this.active;
    document.getElementById("btn-mode-source")!.classList.toggle("active", this.mode === "source");
    document.getElementById("btn-mode-split")!.classList.toggle("active", this.mode === "split");
    document.getElementById("btn-mode-preview")!.classList.toggle("active", this.mode === "preview");
  }

  // ------------------------------------------------------------------
  // Modes, layout, preview

  setMode(mode: ViewMode) {
    if (!this.active) return;
    if (!this.active.markdown && mode !== "source") {
      toast("Preview is for Markdown", "This document is not recognized as Markdown, so only source mode is available.");
      return;
    }
    this.mode = mode;
    if (this.active) this.active.mode = mode;
    this.refreshLayout();
    this.refreshPreview(true);
    this.renderTabs();
    if (mode !== "preview") this.view.focus();
  }

  toggleWrap() {
    this.settings.wordWrap = !this.settings.wordWrap;
    void this.persistSettings();
    this.applySettingsToAllTabs();
  }

  private refreshLayout() {
    const base = this.mode === "split" ? "split" : this.mode === "preview" ? "preview-only" : "";
    this.main.className = base + (this.outlineVisible && this.active?.markdown ? " with-outline" : "");
    if (this.mode === "split") {
      const wrap = document.getElementById("editor-wrap")!;
      wrap.style.flex = `${this.splitRatio} 1 0`;
    } else {
      document.getElementById("editor-wrap")!.style.flex = "";
    }
    if (this.mode === "source") this.view.focus();
  }

  private refreshPreview(immediate = false) {
    const tab = this.active;
    if (!tab || this.mode === "source" || !tab.markdown) return;
    const run = () => {
      if (!this.active || this.mode === "source") return;
      this.preview.setBlockRemote(this.settings.blockRemoteResources);
      this.preview.update(this.active.state.doc.toString(), this.active.info.tabId, effective());
    };
    if (immediate) {
      window.clearTimeout(this.previewDebounce);
      run();
    } else {
      window.clearTimeout(this.previewDebounce);
      this.previewDebounce = window.setTimeout(run, 250);
    }
  }

  private applyThemeToEditor() {
    this.applySettingsToAllTabs();
    this.refreshPreview(true);
  }

  private applySettingsToAllTabs() {
    // Effects must be applied to each tab state; compartments are per-state.
    for (const tab of this.tabs) {
      const eff = settingsEffects(this.settings, effective());
      tab.state = tab.state.update({ effects: eff }).state;
      if (tab === this.active) this.view.setState(tab.state);
    }
  }

  // ------------------------------------------------------------------
  // Status bar

  private refreshStatus() {
    const tab = this.active;
    const path = document.getElementById("status-path")!;
    const enc = document.getElementById("status-encoding")!;
    const eol = document.getElementById("status-eol")!;
    const pos = document.getElementById("status-pos")!;
    const langName = document.getElementById("status-lang-name")!;
    langName.textContent = tab ? languageName(tab) : "";
    if (!tab) {
      path.textContent = "No document";
      enc.textContent = "";
      eol.textContent = "";
      pos.textContent = "";
      this.statusbar.classList.remove("dirty");
      return;
    }
    path.textContent = tab.info.path || "Untitled — not yet saved to disk";
    path.title = tab.info.path || "";
    const encLabel: Record<string, string> = {
      utf8: "UTF-8",
      utf8bom: "UTF-8 · BOM",
      utf16le: "UTF-16 LE · BOM",
      utf16be: "UTF-16 BE · BOM",
    };
    enc.textContent = (encLabel[tab.info.encoding] || tab.info.encoding) + (tab.info.readOnly ? " · read-only" : "");
    const eolLabel: Record<string, string> = { lf: "LF", crlf: "CRLF", cr: "CR", mixed: "Mixed EOL", none: "" };
    eol.textContent = eolLabel[tab.info.eolSummary] ?? "";
    this.statusbar.classList.toggle("dirty", tab.dirty);
    this.updateCursor();
  }

  private updateCursor() {
    const pos = document.getElementById("status-pos")!;
    const tab = this.active;
    if (!tab) {
      pos.textContent = "";
      return;
    }
    const sel = tab.state.selection.main;
    const line = tab.state.doc.lineAt(sel.head);
    let text = `Ln ${line.number}, Col ${sel.head - line.from + 1}`;
    if (!sel.empty) {
      text += `  ·  ${sel.to - sel.from} selected`;
    }
    pos.textContent = text;
  }

  // ------------------------------------------------------------------
  // Settings

  async persistSettings() {
    try {
      await this.backend.putSettings(this.settings);
    } catch (e) {
      toast("Could not save settings", String(e));
    }
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  async updateSettings(next: AppSettings) {
    const themeChanged = next.theme !== this.settings.theme;
    this.settings = next;
    if (themeChanged) setTheme(next.theme as ThemeMode);
    this.preview.setBlockRemote(next.blockRemoteResources);
    this.applySettingsToAllTabs();
    this.refreshPreview(true);
    await this.persistSettings();
  }

  // ------------------------------------------------------------------
  // Backend events

  private wireBackendEvents() {
    this.backend.onWatchEvent((e) => void this.onWatch(e));
    this.backend.onMenuAction((a) => void this.onMenu(a));
    this.backend.onQuitRequest(() => void this.onQuitRequest());
    this.backend.onOpenPaths((paths) => {
      if (paths.length) void this.openPaths(paths);
    });
  }

  private async onWatch(e: WatchEvent) {
    const tab = this.tabs.find((t) => t.info.tabId === e.tabId);
    if (!tab) return;
    if (e.kind === "changed") tab.extState = "changed";
    else if (e.kind === "deleted") tab.extState = "deleted";
    else tab.extState = "none";
    if (tab === this.active) this.showTabBanners(tab);
    this.renderTabs();
  }

  private showTabBanners(tab: Tab) {
    removeBanner(this.bannerSlot, `ext-${tab.info.tabId}`);
    if (tab.extState === "changed") {
      tab.bannerResolve = null;
      void showBanner(this.bannerSlot, `ext-${tab.info.tabId}`,
        "This file changed on disk while it was open.",
        [
          { label: "Reload", value: "reload", primary: true },
          { label: "Keep Mine", value: "keep" },
        ],
      ).then(async (v) => {
        if (v === "reload") await this.reloadFromDisk(tab, tab.dirty);
        else tab.extState = "none"; // user acknowledged; save flow still guards
      });
    } else if (tab.extState === "deleted") {
      void showBanner(this.bannerSlot, `ext-${tab.info.tabId}`,
        "This file was deleted or moved outside the editor.",
        [
          { label: "Save to Recreate", value: "recreate", primary: true },
          { label: "Dismiss", value: "dismiss" },
        ],
      ).then(async (v) => {
        if (v === "recreate") await this.saveTab(tab);
        tab.extState = "none";
      });
    }
  }

  private async onMenu(action: string) {
    if (action.startsWith("open-recent\u001f")) {
      const p = action.slice("open-recent\u001f".length);
      if (p) await this.openPaths([p]);
      return;
    }
    switch (action) {
      case "new-tab": return this.newTab();
      case "open": return this.openPathsWithDialog();
      case "save": return this.saveActive();
      case "save-as": return this.saveActiveAs();
      case "close-tab": return this.closeActiveTab();
      case "quit": return this.onQuitRequest();
      case "mode-source": return this.setMode("source");
      case "mode-split": return this.setMode("split");
      case "mode-preview": return this.setMode("preview");
      case "toggle-wrap": return this.toggleWrap();
      case "theme-light": this.settings.theme = "light"; setTheme("light"); return this.persistSettings();
      case "theme-dark": this.settings.theme = "dark"; setTheme("dark"); return this.persistSettings();
      case "theme-system": this.settings.theme = "system"; setTheme("system"); return this.persistSettings();
      case "settings": return this.openSettings();
      case "about": return this.showAbout();
      case "help-shortcuts": return this.showShortcuts();
      case "convert-utf8": return this.convertToUTF8();
      case "normalize-eol": return this.normalizeLineEndings();
      case "toggle-outline": return this.toggleOutline();
      case "print": return this.printPreview();
      case "clear-recent": return this.clearRecent();
      case "open-recent\u001f": return undefined; // handled by prefix below
    }
  }

  private async onQuitRequest() {
    if (this.quitting) return;
    const dirty = this.tabs.filter((t) => t.dirty);
    if (!dirty.length) {
      this.quitting = true;
      await this.backend.quitApp();
      return;
    }
    const choice = await quitPrompt(dirty.map((t) => t.fileName()));
    if (choice === "cancel") return;
    if (choice === "save-all") {
      for (const tab of dirty) {
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          this.saveCanceled = false;
          ok = await this.saveTab(tab);
          if (!ok && tab.dirty && !this.saveCanceled) {
            await new Promise((r) => setTimeout(r, 150));
          }
          if (this.saveCanceled) break; // a declined dialog is an answer, not an error
        }
        if (!ok && tab.dirty) {
          toast("Quit canceled", "Not all documents could be saved.");
          return;
        }
      }
    } else {
      for (const tab of dirty) {
        await this.backend.setDirty(tab.info.tabId, false);
        void this.backend.clearRecovery(tab.info.tabId);
      }
    }
    this.quitting = true;
    await this.backend.quitApp();
  }

  // ------------------------------------------------------------------
  // Shortcuts

  private editorKeys() {
    return [
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (void this.saveActive(), true) },
        { key: "Mod-Shift-s", preventDefault: true, run: () => (void this.saveActiveAs(), true) },
        { key: "Mod-n", preventDefault: true, run: () => (void this.newTab(), true) },
        { key: "Mod-o", preventDefault: true, run: () => (void this.openPathsWithDialog(), true) },
        { key: "Mod-w", preventDefault: true, run: () => (void this.closeActiveTab(), true) },
        { key: "Mod-,", preventDefault: true, run: () => (void this.openSettings(), true) },
        { key: "Alt-1", preventDefault: true, run: () => (this.setMode("source"), true) },
        { key: "Alt-2", preventDefault: true, run: () => (this.setMode("split"), true) },
        { key: "Alt-3", preventDefault: true, run: () => (this.setMode("preview"), true) },
        { key: "Alt-z", preventDefault: true, run: () => (this.toggleWrap(), true) },
      ]),
      // Shared update listener: travels inside every tab state so edits are
      // observed no matter which tab is active.
      EditorView.updateListener.of((update) => {
        const tab = this.active;
        if (!tab) return;
        if (update.startState === tab.state) {
          tab.state = update.state;
        } else if (update.state !== tab.state) {
          return; // update from a state that is no longer active
        }
        if (update.docChanged) {
          if (!tab.dirty) {
            tab.dirty = true;
            void this.backend.setDirty(tab.info.tabId, true);
            this.renderTabs();
            this.refreshWindowTitle();
            this.statusbar.classList.add("dirty");
          }
          this.scheduleDirtyRecheck(tab);
          this.refreshPreview();
          this.scheduleOutline();
          this.resetAutosaveTimer();
          this.scheduleSnapshot();
        }
        if (update.docChanged || update.selectionSet) this.updateCursor();
      }),
    ];
  }

  private bindShortcuts() {
    window.addEventListener("keydown", (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const inField = target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
      if (mod && !inField && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); void this.saveActive(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); void this.saveActiveAs(); }
      else if (mod && !inField && e.key.toLowerCase() === "o") { e.preventDefault(); void this.openPathsWithDialog(); }
      else if (mod && !inField && e.key.toLowerCase() === "n") { e.preventDefault(); void this.newTab(); }
      else if (mod && !inField && e.key.toLowerCase() === "w") { e.preventDefault(); void this.closeActiveTab(); }
      else if (mod && e.key === ",") { e.preventDefault(); void this.openSettings(); }
      else if (mod && !inField && e.key.toLowerCase() === "p") { e.preventDefault(); this.printPreview(); }
      else if (mod && !inField && e.key.toLowerCase() === "q") { e.preventDefault(); void this.onQuitRequest(); }
      else if (e.altKey && !mod) {
        if (e.key === "1") { e.preventDefault(); this.setMode("source"); }
        else if (e.key === "2") { e.preventDefault(); this.setMode("split"); }
        else if (e.key === "3") { e.preventDefault(); this.setMode("preview"); }
        else if (e.key.toLowerCase() === "z") { e.preventDefault(); this.toggleWrap(); }
      }
    });
  }

  // ------------------------------------------------------------------
  // DOM wiring

  private wireDom() {
    document.getElementById("btn-new")!.addEventListener("click", () => void this.newTab());
    document.getElementById("btn-open")!.addEventListener("click", () => void this.openPathsWithDialog());
    document.getElementById("btn-save")!.addEventListener("click", () => void this.saveActive());
    document.getElementById("btn-settings")!.addEventListener("click", () => void this.openSettings());
    document.getElementById("btn-theme")!.addEventListener("click", () => {
      const next = effective() === "dark" ? "light" : "dark";
      this.settings.theme = next;
      setTheme(next);
      void this.persistSettings();
      this.applyThemeToEditor();
    });
    document.getElementById("btn-outline")!.addEventListener("click", () => this.toggleOutline());
    document.getElementById("btn-print")!.addEventListener("click", () => this.printPreview());
    document.getElementById("btn-mode-source")!.addEventListener("click", () => this.setMode("source"));
    document.getElementById("btn-mode-split")!.addEventListener("click", () => this.setMode("split"));
    document.getElementById("btn-mode-preview")!.addEventListener("click", () => this.setMode("preview"));
    document.getElementById("empty-new")!.addEventListener("click", () => void this.newTab());
    document.getElementById("empty-open")!.addEventListener("click", () => void this.openPathsWithDialog());
    this.wireTabContextMenu();

    // Splitter drag.
    const splitter = document.getElementById("splitter")!;
    let dragging = false;
    splitter.addEventListener("mousedown", (e) => {
      dragging = true;
      splitter.classList.add("active");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const rect = this.main.getBoundingClientRect();
      this.splitRatio = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      document.getElementById("editor-wrap")!.style.flex = `${this.splitRatio} 1 0`;
    });
    window.addEventListener("mouseup", () => {
      dragging = false;
      splitter.classList.remove("active");
    });

    // Editor updates ride on every tab state via the shared listener built in
    // editorKeys(); nothing needs wrapping here. Scroll → preview sync only.
    this.view.scrollDOM.addEventListener("scroll", () => {
      if (this.mode !== "split") return;
      const sc = this.view.scrollDOM;
      this.preview.syncFromEditor(sc.scrollTop, sc.scrollHeight, sc.clientHeight);
    });
  }

  /** Undo-back-to-clean clears the dirty flag without touching the file. */
  private scheduleDirtyRecheck(tab: Tab) {
    window.clearTimeout(tab.dirtyRecheck);
    tab.dirtyRecheck = window.setTimeout(() => {
      if (!tab.dirty) return;
      if (tab.encodingDirty) return; // encoding conversion keeps the dirty flag
      const content = tab.state.doc.toString();
      const eols = tab.state.field(eolField);
      if (equalsSaved(content, eols, tab.savedContent, tab.savedEols)) {
        tab.dirty = false;
        void this.backend.setDirty(tab.info.tabId, false);
        this.renderTabs();
        this.refreshWindowTitle();
        this.statusbar.classList.remove("dirty");
      }
    }, 400);
  }

  // ------------------------------------------------------------------
  // Auto-save

  /** Accept an explicit hint (used by tests and the settings UI). */
  pokeAutosave() {
    this.resetAutosaveTimer();
  }

  private resetAutosaveTimer() {
    window.clearTimeout(this.autosaveTimer);
    if (!this.settings.autoSaveEnabled) return;
    this.autosaveTimer = window.setTimeout(() => void this.autosaveFire(), Math.max(250, this.settings.autoSaveDelayMs));
  }

  private async autosaveFire() {
    if (!this.settings.autoSaveEnabled) return;
    for (const tab of this.tabs.slice()) {
      // Never auto-save untitled documents, read-only documents, or tabs with
      // unresolved external changes (no silent overwrites, ever).
      if (!tab.dirty || !tab.info.path || tab.info.readOnly) continue;
      if (tab.encodingDirty) continue; // a conversion waits for the user's Save
      if (tab.extState === "changed" || tab.extState === "deleted") continue;
      if (this.saveInFlight.has(tab.info.tabId)) continue;
      this.saveInFlight.add(tab.info.tabId);
      let ok: boolean;
      try {
        ok = await this.doSave(tab, tab.info.path, false, true);
      } finally {
        this.saveInFlight.delete(tab.info.tabId);
      }
      if (!ok && tab.dirty) {
        // A failed auto-save stops the timer for this session tick; the user
        // sees the failure toast and decides.
        return;
      }
    }
  }

  // ------------------------------------------------------------------
  // Image paste (markdown tabs): clipboard image -> file next to document

  private handlePaste(e: ClipboardEvent) {
    const tab = this.active;
    if (!tab || !e.clipboardData) return;
    const image = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!image) return;
    if (!tab.markdown) {
      toast("Paste image", "Images can be pasted into Markdown documents.");
      return;
    }
    if (!tab.info.path) {
      toast("Save the document first", "Paste the image after the document has a name and folder (⌘S).");
      return;
    }
    e.preventDefault();
    const suggested = `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
    void (async () => {
      const name = await imageNameDialog(suggested);
      if (name === null) return;
      const buffer = await image.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      try {
        const finalName = await this.backend.writeImageFile(
          tab.info.tabId, name, btoa(binary),
        );
        const sel = tab.state.selection.main;
        this.view.dispatch({ changes: { from: sel.from, insert: `![${finalName}](${finalName})` } });
        this.forceDirty(tab);
        toast("Image saved", `${finalName} written next to the document and referenced.`);
      } catch (err) {
        toast("Could not save image", String(err));
      }
    })();
  }

  // ------------------------------------------------------------------
  // Tab context menu: reveal in file manager, copy path, close

  private wireTabContextMenu() {
    this.tabbar.addEventListener("contextmenu", (e) => {
      const target = (e.target as HTMLElement).closest(".tab") as HTMLElement | null;
      if (!target) return;
      e.preventDefault();
      const tabs = this.tabs;
      const idx = [...this.tabbar.querySelectorAll(".tab")].indexOf(target);
      const tab = tabs[idx];
      if (!tab) return;
      document.getElementById("tab-context")?.remove();
      const menu = document.createElement("div");
      menu.id = "tab-context";
      const item = (label: string, fn: () => void) => {
        const el = document.createElement("div");
        el.className = "ctx-item";
        el.textContent = label;
        el.addEventListener("click", () => { menu.remove(); fn(); });
        menu.appendChild(el);
      };
      if (tab.info.path) {
        item(`Reveal in ${revealLabel()}`, () => {
          void this.backend.revealPath(tab.info.path).then((err) => {
            if (err) toast("Could not reveal", err);
          });
        });
        item("Copy Path", () => void copyText(tab.info.path).then(() => toast("Path copied")));
      }
      menu.querySelector(".ctx-sep") || tab.info.path && menu.appendChild(Object.assign(document.createElement("div"), { className: "ctx-sep" }));
      item("Close Tab", () => void this.closeTab(tab));
      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.min(e.clientX, window.innerWidth - rect.width - 8)}px`;
      menu.style.top = `${Math.min(e.clientY, window.innerHeight - rect.height - 8)}px`;
      setTimeout(() => {
        window.addEventListener(
          "mousedown",
          (ev) => {
            if (!menu.contains(ev.target as Node)) menu.remove();
          },
          { once: true },
        );
      });
    });
  }

  // ------------------------------------------------------------------
  // Crash recovery
  //
  // Dirty buffers are snapshotted to the app's private data folder a few
  // seconds after edits settle. Snapshots are cleared on save, clean close,
  // or explicit discard. After a crash, the next start offers recovery.

  private scheduleSnapshot() {
    if (!this.settings.crashRecoveryEnabled) return; // opt-in feature
    window.clearTimeout(this.snapshotTimer);
    this.snapshotTimer = window.setTimeout(() => void this.snapshotDirty(), 4000);
  }

  private async snapshotDirty() {
    for (const tab of this.tabs) {
      if (!tab.dirty) continue;
      const content = tab.state.doc.toString();
      const eols = tab.state.field(eolField).slice();
      try {
        await this.backend.snapshotTab(tab.info.tabId, tab.info.path, content, eols, tab.info.encoding);
      } catch {
        // Recovery is best-effort; never disturb editing on failure.
      }
    }
  }

  private async offerRecovery() {
    // Recovery is opt-in: when off, any stale snapshots are erased rather
    // than offered, and the offer never appears.
    if (!this.settings.crashRecoveryEnabled) {
      try {
        const stale = await this.backend.listRecovery();
        if (stale && stale.length) await this.backend.discardRecovery(stale.map((e) => e.id));
      } catch { /* best effort */ }
      return;
    }
    let entries: import("./ipc").RecoveryEntry[] = [];
    try {
      entries = await this.backend.listRecovery();
    } catch {
      return;
    }
    if (!entries || !entries.length) return;
    const names = entries.map((e) => {
      const name = e.path ? e.path.replace(/\\/g, "/").split("/").pop() || e.path : "Untitled";
      return `• ${name}${e.path ? "" : " (never saved)"} — recovered copy from ${new Date(e.savedAt * 1000).toLocaleTimeString()}`;
    });
    const choice = await showModal({
      title: "Recover unsaved work?",
      body:
        `The previous session ended with unsaved changes in ${entries.length} document${entries.length === 1 ? "" : "s"}:\n\n` +
        names.join("\n") +
        "\n\nRecovered documents open as unsaved tabs — nothing is written to your files until you save. Snapshots live only in this app's private data folder.",
      buttons: [
        { label: "Recover All", value: "recover", primary: true },
        { label: "Discard", value: "discard", danger: true },
        { label: "Decide Later", value: "later" },
      ],
      cancelValue: "later",
    });
    if (choice === "discard") {
      await this.backend.discardRecovery(entries.map((e) => e.id));
      return;
    }
    if (choice !== "recover") return;
    for (const e of entries) {
      const oc = await this.backend.recoverEntry(e.id);
      if (oc.tab) {
        const state = await makeState({
          info: { ...oc.tab, eols: oc.tab.eols ?? [""], defaultEol: oc.tab.defaultEol ?? "\n" },
          settings: this.settings,
          theme: effective(),
          extraKeys: this.editorKeys(),
        });
        const tab = new Tab(oc.tab, state);
        tab.dirty = true;
        tab.savedContent = "";
        this.tabs.push(tab);
        this.setActive(tab);
        await this.backend.setDirty(tab.info.tabId, true);
        await this.backend.discardRecovery([e.id]);
      }
    }
    toast("Recovered", "Documents restored as unsaved tabs. Save them to keep the changes.");
  }

  // ------------------------------------------------------------------
  // Dialogs: settings, about, shortcuts

  async openSettings() {
    const { openSettingsModal } = await import("./settingsui");
    const next = await openSettingsModal(this.settings);
    if (next) this.updateSettings(next);
  }

  private async showAbout() {
    const info = await this.backend.appInfo();
    await showModal({
      title: "Xtracsys Editor",
      body: `A local-first text and Markdown editor for programming, configuration files, and documentation.\n\nVersion ${info.version} · ${info.platform}/${info.arch}\nCopyright 2026 Xtracsys LLC\nLicensed under the Apache License 2.0.\n\nFiles stay plain, portable, and byte-faithful. Nothing leaves this machine.`,
      buttons: [{ label: "Close", value: "ok", primary: true }],
    });
  }

  private async clearRecent() {
    await this.backend.clearRecentFiles();
    toast("Recent files cleared");
  }

  // ------------------------------------------------------------------
  // Convert commands: deliberate, two-step (the save is still yours).

  private async convertToUTF8() {
    const tab = this.active;
    if (!tab) return;
    if (tab.info.encoding === "utf8") {
      toast("Already UTF-8", "This document is saved as UTF-8 without a BOM.");
      return;
    }
    if (tab.info.readOnly) {
      toast("Read-only document", "Convert is unavailable; use Save As to export a UTF-8 copy.");
      return;
    }
    const from = ({ utf8bom: "UTF-8 with BOM", utf16le: "UTF-16 LE", utf16be: "UTF-16 BE" } as Record<string, string>)[tab.info.encoding] || tab.info.encoding;
    const choice = await showModal({
      title: "Convert to UTF-8",
      body: `Re-encode “${tab.fileName()}” from ${from} to UTF-8 (no BOM)?\n\nThe document is marked as modified and saved when YOU choose Save — the file on disk is not touched until then.`,
      buttons: [
        { label: "Convert", value: "convert", primary: true },
        { label: "Cancel", value: "cancel" },
      ],
      cancelValue: "cancel",
    });
    if (choice !== "convert") return;
    tab.info.encoding = "utf8";
    tab.encodingDirty = true;
    this.forceDirty(tab);
    toast("Converted to UTF-8", "Save (⌘S) to write the converted file.");
  }

  private async normalizeLineEndings() {
    const tab = this.active;
    if (!tab) return;
    const eols = tab.state.field(eolField);
    // The final line never carries a terminator (the trailing entry is "").
    // Normalize target: the file's own predominant style.
    const target = (eols.find((e) => e !== "") as Eol | undefined) ?? tab.info.defaultEol ?? DEFAULT_EOL;
    const label = target === "\r\n" ? "CRLF (Windows)" : target === "\r" ? "CR (classic Mac)" : "LF (Unix)";
    const body = eols.slice(0, -1); // terminators that precede the final line
    if (body.length === 0) {
      toast("Nothing to normalize", "A single line has no line endings to rewrite.");
      return;
    }
    const alreadyUniform = body.every((e) => e === target);
    if (alreadyUniform) {
      toast("Already uniform", `Every line already ends with ${label}.`);
      return;
    }
    const choice = await showModal({
      title: "Normalize line endings",
      body: `Rewrite every line ending in “${tab.fileName()}” to ${label}?\n\n` +
        "Only the endings of existing line breaks are rewritten — a missing final newline is not added. " +
        "The document is marked as modified and saved when YOU choose Save — the file on disk is not touched until then. This change is not undoable with ⌘Z.",
      buttons: [
        { label: "Normalize", value: "norm", primary: true },
        { label: "Cancel", value: "cancel" },
      ],
      cancelValue: "cancel",
    });
    if (choice !== "norm") return;
    // Preserve the trailing "" entry — the final line has no terminator.
    const next = eols.map((_, i) => (i === eols.length - 1 ? "" : target));
    // Route through the view so the shared update listener runs (preview,
    // autosave timer, snapshot, outline).
    this.view.dispatch({ effects: setEolsEffect.of(next) });
    const summary = target === "\r\n" ? "crlf" : target === "\r" ? "cr" : "lf";
    tab.info.eolSummary = summary;
    tab.info.defaultEol = target;
    this.forceDirty(tab);
    this.refreshStatus();
    toast("Normalized", `All line endings set to ${label}. Save to write the file.`);
  }

  /** Mark a tab dirty for non-text changes (encoding/EOL conversions). */
  private forceDirty(tab: Tab) {
    tab.dirty = true;
    void this.backend.setDirty(tab.info.tabId, true);
    this.renderTabs();
    this.refreshWindowTitle();
    this.refreshStatus();
    this.statusbar.classList.add("dirty");
  }

  // ------------------------------------------------------------------
  // Outline panel

  private outlineVisible = false;
  private outlineTimer: number | undefined;

  private scheduleOutline() {
    if (!this.active?.markdown || !this.outlineVisible) return;
    window.clearTimeout(this.outlineTimer);
    this.outlineTimer = window.setTimeout(() => this.renderOutline(), 300);
  }

  toggleOutline() {
    this.outlineVisible = !this.outlineVisible;
    this.refreshLayout();
    this.renderOutline();
  }

  private renderOutline() {
    const host = document.getElementById("outline")!;
    host.textContent = "";
    const tab = this.active;
    const show = this.outlineVisible && tab?.markdown;
    this.main.classList.toggle("with-outline", !!show);
    if (!show) return;
    const headings = parseOutline(tab.state.doc.toString());
    for (const h of headings) {
      const el = document.createElement("div");
      el.className = "outline-item outline-h" + h.level;
      el.textContent = h.text || "(untitled)";
      el.title = `Line ${h.line + 1}`;
      el.addEventListener("click", () => {
        const line = tab.state.doc.line(h.line + 1);
        this.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
        this.view.focus();
      });
      host.appendChild(el);
    }
    if (!headings.length) {
      const el = document.createElement("div");
      el.className = "outline-item";
      el.textContent = "No headings";
      host.appendChild(el);
    }
  }

  // ------------------------------------------------------------------
  // Print (preview content)

  private printPreview() {
    if (this.mode === "source" || !this.active?.markdown) {
      toast("Printing previews", "Switch to Split or Preview mode to print the rendered document (⌘P).");
      return;
    }
    const frame = document.getElementById("preview-frame") as HTMLIFrameElement | null;
    try {
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    } catch (e) {
      toast("Print failed", String(e));
    }
  }

  private async renderEmptyRecents() {
    const host = document.getElementById("empty-recent");
    if (!host) return;
    host.textContent = "";
    let recents: string[] = [];
    try {
      recents = (await this.backend.getRecentFiles()).slice(0, 5);
    } catch {
      return;
    }
    if (!recents.length) {
      host.style.display = "none";
      return;
    }
    host.style.display = "flex";
    const title = document.createElement("div");
    title.className = "er-title";
    title.textContent = "Recent";
    host.appendChild(title);
    for (const p of recents) {
      const el = document.createElement("div");
      el.className = "er-item";
      el.textContent = p;
      el.title = p;
      el.addEventListener("click", () => void this.openPaths([p]));
      host.appendChild(el);
    }
  }

  private async showShortcuts() {
    await showModal({
      title: "Keyboard shortcuts",
      body: shortcutText(),
      buttons: [{ label: "Close", value: "ok", primary: true }],
    });
  }
}

export function shortcutText(): string {
  return [
    "New Tab             ⌘/Ctrl+N",
    "Open…               ⌘/Ctrl+O",
    "Save                ⌘/Ctrl+S",
    "Save As…            ⇧⌘/Ctrl+S",
    "Close Tab           ⌘/Ctrl+W",
    "Quit                ⌘/Ctrl+Q",
    "Find / Replace       ⌘/Ctrl+F  ·  ⇧⌘/Ctrl+H",
    "Undo / Redo          ⌘/Ctrl+Z  ·  ⇧⌘/Ctrl+Z",
    "Source / Split / Preview   Alt+1 / Alt+2 / Alt+3",
    "Toggle word wrap     Alt+Z",
    "Settings             ⌘/Ctrl+,",
  ].join("\n");
}

function defaultSettings(): AppSettings {
  return {
    restoreSession: true,
    crashRecoveryEnabled: false,
    theme: "system",
    autoSaveEnabled: false,
    autoSaveDelayMs: 2000,
    wordWrap: true,
    tabSize: 4,
    insertSpaces: true,
    showLineNumbers: true,
    highlightActiveLine: true,
    editorFontSize: 0,
    blockRemoteResources: true,
  };
}

function languageName(tab: Tab): string {
  if (tab.markdown) return "Markdown";
  const name = tab.fileName();
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const map: Record<string, string> = {
    go: "Go", ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX",
    py: "Python", rs: "Rust", c: "C", h: "C header", cpp: "C++", cc: "C++",
    java: "Java", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
    sh: "Shell", bash: "Shell", zsh: "Shell", html: "HTML", css: "CSS",
    sql: "SQL", rb: "Ruby", php: "PHP", swift: "Swift", kt: "Kotlin",
    xml: "XML", md: "Markdown", txt: "Text", csv: "CSV", ini: "INI",
    conf: "Config", cfg: "Config", lock: "Lockfile", Makefile: "Makefile",
  };
  if (!ext) {
    if (/^Makefile$/i.test(name)) return "Makefile";
    if (/^Dockerfile$/i.test(name)) return "Dockerfile";
    return "Plain text";
  }
  return map[ext.toLowerCase()] || (ext.toUpperCase() + " file");
}

export { Tab };
