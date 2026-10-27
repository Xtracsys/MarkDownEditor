// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// The application controller: tab lifecycle, save flows, auto-save, preview
// modes, external-change handling, status bar, and event wiring. All file
// operations go through the Backend interface; this file performs no I/O of
// its own.

import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import type { Backend, Eol, OpenOutcome, TabInfo, AppSettings, WatchEvent } from "./ipc";
import { eolField, equalsSaved } from "./eol";
import { makeState, settingsEffects, isMarkdownPath } from "./editor";
import { PreviewPane } from "./preview";
import { showModal, toast, unsavedPrompt, quitPrompt, showBanner, removeBanner } from "./ui";
import { initTheme, setTheme, effective, onThemeChange, type ThemeMode } from "./theme";

export type ViewMode = "source" | "split" | "preview";

class Tab {
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
    return this.info.path.split("/").pop() || this.info.path;
  }
}

export class Application {
  private backend: Backend;
  private view!: EditorView;
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private settings!: AppSettings;
  private preview: PreviewPane;
  private autosaveTimer: number | undefined;
  private snapshotTimer: number | undefined;
  private previewDebounce: number | undefined;
  private dirtyRecheck: number | undefined;
  private saveInFlight = new Set<string>();
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
      this.showFatalStartupError(String(e));
      return defaultSettings();
    });
    setTheme(this.settings.theme as ThemeMode);
    this.preview.setBlockRemote(this.settings.blockRemoteResources);

    this.view = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({ doc: "", extensions: [] }),
    });

    try {
      this.wireDom();
      this.wireBackendEvents();
      this.bindShortcuts();
      await this.newTab();
      // External opens (Open With, argv, drag-drop) may queue before the UI
      // is up; from here they are delivered live and any backlog flushes.
      // This MUST come before offerRecovery: the recovery modal is
      // interactive and must never gate document delivery.
      await this.backend.markExternalReady();
      await this.offerRecovery();
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

  async openPaths(paths: string[]) {
    if (!paths.length) return;
    const outcomes = await this.backend.openPaths(paths);
    await this.openOutcomes(outcomes, paths);
  }

  private async openOutcomes(outcomes: OpenOutcome[], paths?: string[]) {
    let firstTab: Tab | null = null;
    let issues = 0;
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
        this.lastIssuePath = paths && paths[i] ? paths[i] : this.lastIssuePath;
        await this.showOpenIssue(oc.issue.message, oc.issue.detail || "", oc.issue.hexPreview || "", oc.issue.canReadOnly);
      }
    }
    if (firstTab) {
      // Replace the initial empty untitled tab if it is untouched.
      const pristine = this.tabs.find((t) => !t.info.path && !t.dirty && t.savedContent === "");
      this.setActive(firstTab);
      if (pristine && pristine !== firstTab && this.tabs.length > 1) {
        await this.removeTab(pristine, true);
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
      }
    } else {
      this.renderTabs();
    }
  }

  /** Remove without prompts (used for the pristine initial tab). */
  private async removeTab(tab: Tab, skipBackend = false) {
    const idx = this.tabs.indexOf(tab);
    if (idx >= 0) this.tabs.splice(idx, 1);
    if (!skipBackend) await this.backend.closeTab(tab.info.tabId);
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
    const suggested = tab.info.path ? tab.info.path.split("/").pop()! : tab.markdown ? "Untitled.md" : "Untitled.txt";
    const target = await this.backend.pickSaveAsPath(suggested).catch(() => "");
    if (!target) return false; // canceled
    if (this.saveInFlight.has(tab.info.tabId)) return false;
    this.saveInFlight.add(tab.info.tabId);
    try {
      return await this.doSave(tab, target, false);
    } finally {
      this.saveInFlight.delete(tab.info.tabId);
    }
  }

  private async doSave(tab: Tab, path: string, overwrite: boolean): Promise<boolean> {
    const content = tab.state.doc.toString();
    const eols = tab.state.field(eolField).slice();
    const resp = await this.backend.saveTab(
      tab.info.tabId, path, content, eols, tab.info.encoding, overwrite,
    );
    if (resp.ok) {
      tab.dirty = false;
      tab.savedContent = content;
      tab.savedEols = eols;
      tab.extState = "none";
      void this.backend.clearRecovery(tab.info.tabId);
      removeBanner(this.bannerSlot, `ext-${tab.info.tabId}`);
      const pathChanged = tab.info.path !== path;
      tab.info.path = resp.tab?.path || path;
      await this.backend.setDirty(tab.info.tabId, false);
      if (pathChanged) {
        // Re-detect language/markdown for the new name, keeping content and
        // the live EOL array intact.
        tab.markdown = isMarkdownPath(tab.info.path);
        const eolsNow = tab.state.field(eolField).slice();
        const rebuilt = await makeState({
          info: { ...tab.info, content, eols: eolsNow },
          settings: this.settings,
          theme: effective(),
          extraKeys: this.editorKeys(),
        });
        tab.state = rebuilt;
        if (this.active === tab) this.view.setState(tab.state);
      }
      this.renderTabs();
      this.refreshStatus();
      this.refreshWindowTitle();
      return true;
    }

    if (resp.issue?.reason === "external-change") {
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
    // Swap backend identity: new tab id carries fresh watcher state.
    await this.backend.closeTab(tab.info.tabId);
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
    this.active = tab;
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
    this.main.className = this.mode === "split" ? "split" : this.mode === "preview" ? "preview-only" : "";
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

  updateSettings(next: AppSettings) {
    const themeChanged = next.theme !== this.settings.theme;
    this.settings = next;
    if (themeChanged) setTheme(next.theme as ThemeMode);
    this.preview.setBlockRemote(next.blockRemoteResources);
    this.applySettingsToAllTabs();
    this.refreshPreview(true);
    void this.persistSettings();
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
        const ok = await this.saveTab(tab);
        if (!ok) {
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
    document.getElementById("btn-mode-source")!.addEventListener("click", () => this.setMode("source"));
    document.getElementById("btn-mode-split")!.addEventListener("click", () => this.setMode("split"));
    document.getElementById("btn-mode-preview")!.addEventListener("click", () => this.setMode("preview"));
    document.getElementById("empty-new")!.addEventListener("click", () => void this.newTab());
    document.getElementById("empty-open")!.addEventListener("click", () => void this.openPathsWithDialog());

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
    window.clearTimeout(this.dirtyRecheck);
    this.dirtyRecheck = window.setTimeout(() => {
      if (!tab.dirty) return;
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
      if (tab.extState === "changed" || tab.extState === "deleted") continue;
      if (this.saveInFlight.has(tab.info.tabId)) continue;
      const ok = await this.saveTab(tab);
      if (!ok && tab.dirty) {
        // A failed auto-save stops the timer for this session tick; the user
        // sees the failure toast and decides.
        return;
      }
    }
  }

  // ------------------------------------------------------------------
  // Crash recovery
  //
  // Dirty buffers are snapshotted to the app's private data folder a few
  // seconds after edits settle. Snapshots are cleared on save, clean close,
  // or explicit discard. After a crash, the next start offers recovery.

  private scheduleSnapshot() {
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
    let entries: import("./ipc").RecoveryEntry[] = [];
    try {
      entries = await this.backend.listRecovery();
    } catch {
      return;
    }
    if (!entries || !entries.length) return;
    const names = entries.map((e) => {
      const name = e.path ? e.path.split("/").pop() || e.path : "Untitled";
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
      body: `A local-first text and Markdown editor for programming, configuration files, and documentation.\n\nVersion ${info.version} · ${info.platform}/${info.arch}\nCopyright 2026 Xtracsys\nLicensed under the Apache License 2.0.\n\nFiles stay plain, portable, and byte-faithful. Nothing leaves this machine.`,
      buttons: [{ label: "Close", value: "ok", primary: true }],
    });
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
  const name = (tab.info.path.split("/").pop() || "");
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
