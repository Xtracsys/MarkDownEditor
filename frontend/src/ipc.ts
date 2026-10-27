// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Shared frontend/backend types. These mirror the Go structs in app.go and
// internal/fileio — keep both sides in sync.

export type Eol = "\n" | "\r\n" | "\r" | "";

export interface TabInfo {
  tabId: string;
  path: string;
  content: string;
  encoding: string;
  eols: Eol[];
  defaultEol: Eol;
  eolSummary: string; // lf | crlf | cr | mixed | none
  readOnly: boolean;
  warnings: string[];
}

export interface FileIssue {
  reason: string;
  message: string;
  detail?: string;
  hexPreview?: string;
  canReadOnly: boolean;
}

export interface OpenOutcome {
  tab?: TabInfo;
  issue?: FileIssue;
}

export interface SaveIssue {
  reason: string; // external-change | validation | io | permission | read-only | untitled
  message: string;
  detail?: string;
}

export interface SaveResponse {
  ok: boolean;
  written: boolean;
  tab?: TabInfo;
  issue?: SaveIssue;
  message?: string;
}

export interface WatchEvent {
  tabId: string;
  kind: "changed" | "deleted" | "restored";
}

export interface AppSettings {
  theme: string; // system | light | dark
  autoSaveEnabled: boolean;
  autoSaveDelayMs: number;
  wordWrap: boolean;
  tabSize: number;
  insertSpaces: boolean;
  showLineNumbers: boolean;
  highlightActiveLine: boolean;
  editorFontSize: number; // px, 0 = default
  blockRemoteResources: boolean;
}

// Field names match the Go JSON marshaling of internal/recovery.Entry.
export interface RecoveryEntry {
  id: string;
  tabId: string;
  path: string;
  content: string;
  eols: Eol[];
  encoding: string;
  savedAt: number;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
}

/**
 * Backend is the complete interface the UI needs from the Go side. The
 * production adapter wraps the wails bindings; the E2E test bridge implements
 * the same interface over HTTP. The UI never touches files directly.
 */
export interface Backend {
  appInfo(): Promise<AppInfo>;
  newTab(): Promise<TabInfo>;
  openPaths(paths: string[]): Promise<OpenOutcome[]>;
  openPathReadOnly(path: string): Promise<OpenOutcome>;
  pickAndOpen(): Promise<OpenOutcome[]>;
  pickSaveAsPath(defaultName: string): Promise<string>;
  saveTab(
    tabId: string,
    path: string,
    content: string,
    eols: Eol[],
    encoding: string,
    overwrite: boolean,
  ): Promise<SaveResponse>;
  closeTab(tabId: string): Promise<void>;
  setDirty(tabId: string, dirty: boolean): Promise<void>;
  setWindowTitle(title: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  putSettings(s: AppSettings): Promise<void>;
  openExternal(url: string): Promise<string>;
  quitApp(): Promise<void>;
  snapshotTab(tabId: string, path: string, content: string, eols: Eol[], encoding: string): Promise<void>;
  clearRecovery(tabId: string): Promise<void>;
  listRecovery(): Promise<RecoveryEntry[]>;
  discardRecovery(ids: string[]): Promise<void>;
  recoverEntry(id: string): Promise<OpenOutcome>;
  onWatchEvent(cb: (e: WatchEvent) => void): void;
  onMenuAction(cb: (action: string) => void): void;
  onQuitRequest(cb: () => void): void;
  onOpenPaths(cb: (paths: string[]) => void): void;
  markExternalReady(): Promise<void>;
}

/** Filter launch/second-instance arguments down to document paths. */
export function fileArgs(args: string[]): string[] {
  return args
    .map((a) => a.trim())
    .filter((a) => a !== "" && !a.startsWith("-"));
}

/** Wails injects window.go bindings and window.runtime when running as an app. */
interface WailsGlobal {
  go?: {
    main?: {
      App?: Record<string, (...args: unknown[]) => Promise<unknown>>;
    };
  };
  runtime?: {
    EventsOn: (name: string, cb: (data: unknown) => void) => void;
  };
}

function wails(): WailsGlobal {
  return window as unknown as WailsGlobal;
}

// The bound App lives at window.go.<package>.App — the package part changed
// when App moved from main to internal/app, so resolve it structurally instead
// of hard-coding the namespace.
function appBinding(): Record<string, (...args: unknown[]) => Promise<unknown>> | undefined {
  const go = wails().go as
    | Record<string, Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>>
    | undefined;
  if (!go) return undefined;
  for (const pkg of Object.values(go)) {
    for (const struct of Object.values(pkg)) {
      if (struct && typeof struct.NewTab === "function") return struct;
    }
  }
  return undefined;
}

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const fn = appBinding()?.[method];
  if (!fn) {
    return Promise.reject(new Error(`backend method unavailable: ${method}`));
  }
  return fn(...args) as Promise<T>;
}

export function createBackend(): Backend {
  // The E2E bridge (cmd/e2e-serve) serves the same frontend with ?e2e=1 and
  // exposes the identical method surface over loopback HTTP + SSE.
  if (new URLSearchParams(window.location.search).has("e2e")) {
    return createBridgeBackend();
  }
  const evWatch: ((e: WatchEvent) => void)[] = [];
  const evMenu: ((a: string) => void)[] = [];
  const evQuit: (() => void)[] = [];
  const evOpen: ((p: string[]) => void)[] = [];
  const wire = () => {
    const rt = wails().runtime;
    if (!rt) return;
    rt.EventsOn("watch:event", (d) => evWatch.forEach((f) => f(d as WatchEvent)));
    rt.EventsOn("menu:action", (d) => evMenu.forEach((f) => f(String(d))));
    rt.EventsOn("app:quit-requested", () => evQuit.forEach((f) => f()));
    rt.EventsOn("open:paths", (d) => evOpen.forEach((f) => f((d as string[]) || [])));
  };
  // EventsOn may be injected slightly after first paint; retry lazily.
  const tryWire = setInterval(() => {
    if (wails().runtime) {
      wire();
      clearInterval(tryWire);
    }
  }, 150);
  setTimeout(() => clearInterval(tryWire), 10000);

  return {
    appInfo: () => call<AppInfo>("AppInfo"),
    newTab: () => call<TabInfo>("NewTab"),
    openPaths: async (p) => (await call<OpenOutcome[]>("OpenPaths", p)) ?? [],
    openPathReadOnly: (p) => call<OpenOutcome>("OpenPathReadOnly", p),
    pickAndOpen: () => call<OpenOutcome[]>("PickAndOpen"),
    pickSaveAsPath: (n) => call<string>("PickSaveAsPath", n),
    saveTab: (tabId, path, content, eols, encoding, overwrite) =>
      call<SaveResponse>("SaveTab", tabId, path, content, eols, encoding, overwrite),
    closeTab: (id) => call<void>("CloseTab", id),
    setDirty: (id, d) => call<void>("SetDirty", id, d),
    setWindowTitle: (t) => call<void>("SetWindowTitle", t),
    getSettings: () => call<AppSettings>("GetSettings"),
    putSettings: (s) => call<void>("PutSettings", s),
    openExternal: (u) => call<string>("OpenExternalURL", u),
    quitApp: () => call<void>("QuitApp"),
    snapshotTab: (tabId, path, content, eols, encoding) =>
      call<void>("SnapshotTab", tabId, path, content, eols, encoding),
    clearRecovery: (tabId) => call<void>("ClearRecovery", tabId),
    listRecovery: async () => (await call<RecoveryEntry[]>("ListRecovery")) ?? [],
    discardRecovery: (ids) => call<void>("DiscardRecovery", ids),
    recoverEntry: (id) => call<OpenOutcome>("RecoverEntry", id),
    onWatchEvent: (cb) => evWatch.push(cb),
    onMenuAction: (cb) => evMenu.push(cb),
    onQuitRequest: (cb) => evQuit.push(cb),
    onOpenPaths: (cb) => evOpen.push(cb),
    markExternalReady: () => call<void>("MarkExternalReady"),
  };
}


// ------------------------------------------------------------------
// E2E bridge backend (cmd/e2e-serve) — same interface, loopback HTTP.

interface BridgeEnvelope {
  result?: unknown;
  error?: string;
}

function createBridgeBackend(): Backend {
  const watch: ((e: WatchEvent) => void)[] = [];
  const menu: ((a: string) => void)[] = [];
  const quit: (() => void)[] = [];
  const open: ((p: string[]) => void)[] = [];

  const call = async (method: string, ...args: unknown[]): Promise<any> => {
    const res = await fetch(`/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    });
    const env = (await res.json()) as BridgeEnvelope;
    if (env.error) throw new Error(env.error);
    return env.result;
  };

  // EventSource for Go → JS events.
  const es = new EventSource("/api/events");
  es.addEventListener("watch:event", (ev) => {
    const payload = JSON.parse((ev as MessageEvent).data);
    watch.forEach((f) => f(payload.data as WatchEvent));
  });
  es.addEventListener("menu:action", (ev) => {
    const payload = JSON.parse((ev as MessageEvent).data);
    menu.forEach((f) => f(String(payload.data)));
  });
  es.addEventListener("app:quit-requested", () => quit.forEach((f) => f()));
  es.addEventListener("open:paths", (ev) => {
    const payload = JSON.parse((ev as MessageEvent).data);
    open.forEach((f) => f((payload.data as string[]) || []));
  });

  return {
    appInfo: () => call("AppInfo"),
    newTab: () => call("NewTab"),
    openPaths: async (p) => (await call("OpenPaths", p)) ?? [],
    openPathReadOnly: (p) => call("OpenPathReadOnly", p),
    pickAndOpen: () => call("PickAndOpen"),
    pickSaveAsPath: (n) => call("PickSaveAsPath", n),
    saveTab: (tabId, path, content, eols, encoding, overwrite) =>
      call("SaveTab", tabId, path, content, eols, encoding, overwrite),
    closeTab: (id) => call("CloseTab", id),
    setDirty: (id, d) => call("SetDirty", id, d),
    setWindowTitle: (t) => call("SetWindowTitle", t),
    getSettings: () => call("GetSettings"),
    putSettings: (s) => call("PutSettings", s),
    openExternal: (u) => call("OpenExternalURL", u),
    quitApp: () => call("QuitApp"),
    snapshotTab: (tabId, path, content, eols, encoding) =>
      call("SnapshotTab", tabId, path, content, eols, encoding),
    clearRecovery: (tabId) => call("ClearRecovery", tabId),
    listRecovery: async () => (await call("ListRecovery")) ?? [],
    discardRecovery: (ids) => call("DiscardRecovery", ids),
    recoverEntry: (id) => call("RecoverEntry", id),
    onWatchEvent: (cb) => watch.push(cb),
    onMenuAction: (cb) => menu.push(cb),
    onQuitRequest: (cb) => quit.push(cb),
    onOpenPaths: (cb) => open.push(cb),
    markExternalReady: () => call("MarkExternalReady"),
  };
}
