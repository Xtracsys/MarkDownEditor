// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Package app hosts the editor application service: the tab registry,
// dialogs, events, and every file operation the UI can request. It is bound
// to the webview by main and reused headlessly by cmd/e2e-serve.
package app

import (
	"context"
	"fmt"
	"net/url"
	goruntime "runtime"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/xtracsys/xtracsys-editor/internal/fileio"
	"github.com/xtracsys/xtracsys-editor/internal/settings"
)

// AppVersion is stamped at build time via -ldflags.
var AppVersion = "0.1.0"

// Event names emitted to the frontend.
const (
	EventWatch       = "watch:event"
	EventMenuAction  = "menu:action"
	EventQuitRequest = "app:quit-requested"
)

// ErrHeadlessDialog is returned when a native dialog is requested while
// running without a webview (E2E bridge).
const ErrHeadlessDialog = "native dialogs are unavailable in the headless bridge"

// TabInfo is the full frontend view of one open document.
type TabInfo struct {
	TabId       string   `json:"tabId"`
	Path        string   `json:"path"`
	Content     string   `json:"content"`
	Encoding    string   `json:"encoding"`
	Eols        []string `json:"eols"`
	DefaultEol  string   `json:"defaultEol"`
	EolSummary  string   `json:"eolSummary"`
	ReadOnly    bool     `json:"readOnly"`
	Warnings    []string `json:"warnings"`
}

// OpenOutcome is either an opened tab or a structured explanation.
type OpenOutcome struct {
	Tab   *TabInfo       `json:"tab,omitempty"`
	Issue *fileio.Issue  `json:"issue,omitempty"`
}

// SaveResponse is the result of a save attempt. Ok=false always carries an
// Issue or Message; a failed write is never reported as success.
type SaveResponse struct {
	Ok      bool              `json:"ok"`
	Written bool              `json:"written"`
	Tab     *TabInfo          `json:"tab,omitempty"`
	Issue   *fileio.SaveIssue `json:"issue,omitempty"`
	Message string            `json:"message,omitempty"`
}

type tabState struct {
	id          string
	path        string // "" until the document is named
	known       fileio.KnownState
	encoding    string
	defaultEol  string
	eolSummary  string
	readOnly    bool
	dirty       bool
}

// App is the service bound to the webview. Every method here is callable from
// the frontend; the frontend has no file access of its own.
type App struct {
	ctx context.Context

	mu     sync.Mutex
	tabs   map[string]*tabState
	nextID int

	watcher  *fileio.Watcher
	settings settings.Settings

	// eventSink routes Go→frontend events. In the desktop app it wraps
	// runtime.EventsEmit; the E2E bridge server swaps it for SSE.
	eventSink func(name string, data interface{})

	// headless marks the E2E bridge mode: no webview, no native dialogs.
	headless bool

	// quitting lets the second phase of the quit-guard close the window.
	quitting bool
}

func NewApp() *App {
	return &App{tabs: make(map[string]*tabState)}
}

// SetEventSink installs an alternate event router (used by cmd/e2e-serve).
func (a *App) SetEventSink(sink func(name string, data interface{})) {
	a.mu.Lock()
	a.eventSink = sink
	a.mu.Unlock()
}

// InitHeadless boots the app without a webview for the E2E bridge server:
// settings load and the file watcher run exactly as in the desktop app;
// native dialogs are refused and events go through the provided sink.
func (a *App) InitHeadless(ctx context.Context, sink func(name string, data interface{})) {
	a.headless = true
	a.SetEventSink(sink)
	a.settings, _ = settings.Load()
	a.watcher = fileio.NewWatcher(func(ev fileio.WatchEvent) {
		a.emitEvent(EventWatch, ev)
	})
	go a.watcher.Run(ctx)
}

func (a *App) emitEvent(name string, data interface{}) {
	a.mu.Lock()
	sink := a.eventSink
	a.mu.Unlock()
	if sink != nil {
		sink(name, data)
		return
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, name, data)
	}
}

// Startup is the wails OnStartup hook: capture ctx, load settings, start watching.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.settings, _ = settings.Load()
	a.watcher = fileio.NewWatcher(func(ev fileio.WatchEvent) {
		a.emitEvent(EventWatch, ev)
	})
	go a.watcher.Run(ctx)
}

// Shutdown cancels the watcher.
func (a *App) Shutdown(ctx context.Context) {}

// beforeClose implements the unsaved-work guard: closing with dirty tabs is
// intercepted once; the frontend runs its save/discard/cancel flow and then
// calls QuitApp, which re-enters with quitting=true.
// BeforeClose implements the unsaved-work window-close guard.
func (a *App) BeforeClose(ctx context.Context) bool {
	a.mu.Lock()
	dirty := false
	for _, t := range a.tabs {
		if t.dirty {
			dirty = true
			break
		}
	}
	quitting := a.quitting
	a.mu.Unlock()
	if quitting || !dirty {
		return false
	}
	_ = ctx
	a.emitEvent(EventQuitRequest, nil)
	return true
}

func (a *App) newTabLocked(path string, res *fileio.LoadResult) *TabInfo {
	a.nextID++
	t := &tabState{
		id:         fmt.Sprintf("t%d", a.nextID),
		path:       path,
		encoding:   res.Encoding,
		defaultEol: res.DefaultEol,
		eolSummary: res.EolSummary,
		readOnly:   res.ReadOnly,
	}
	t.known = fileio.KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos}
	a.tabs[t.id] = t
	if path != "" {
		a.watcher.Register(t.id, path, t.known)
	}
	if res.Warnings == nil {
		res.Warnings = []string{}
	}
	return &TabInfo{
		TabId:      t.id,
		Path:       path,
		Content:    res.Content,
		Encoding:   res.Encoding,
		Eols:       res.Eols,
		DefaultEol: res.DefaultEol,
		EolSummary: res.EolSummary,
		ReadOnly:   res.ReadOnly,
		Warnings:   res.Warnings,
	}
}

// AppInfo describes the running build (About dialog, diagnostics).
func (a *App) AppInfo() map[string]string {
	return map[string]string{
		"name":     "Xtracsys Editor",
		"version":  AppVersion,
		"platform": goruntime.GOOS,
		"arch":     goruntime.GOARCH,
	}
}

// NewTab creates an untitled document. Untitled documents are never written
// anywhere until the user names them via Save As.
func (a *App) NewTab() *TabInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	empty := &fileio.LoadResult{Content: "", Encoding: fileio.EncUTF8, Eols: []string{""}, DefaultEol: fileio.LF, EolSummary: string(fileio.SummaryNone)}
	return a.newTabLocked("", empty)
}

// OpenPaths loads files by absolute path (open-with, drag-drop, E2E).
func (a *App) OpenPaths(paths []string) []OpenOutcome {
	out := make([]OpenOutcome, 0, len(paths))
	for _, p := range paths {
		out = append(out, a.openOne(p, false))
	}
	return out
}

// OpenPathReadOnly is the explicit fallback for unsupported encodings.
func (a *App) OpenPathReadOnly(path string) OpenOutcome {
	return a.openOne(path, true)
}

func (a *App) openOne(path string, readOnlyMode bool) OpenOutcome {
	var res *fileio.LoadResult
	var issue *fileio.Issue
	if readOnlyMode {
		res, issue = fileio.LoadReadOnly(path)
	} else {
		res, issue = fileio.Load(path)
	}
	if issue != nil {
		return OpenOutcome{Issue: issue}
	}
	a.mu.Lock()
	tab := a.newTabLocked(path, res)
	a.mu.Unlock()
	return OpenOutcome{Tab: tab}
}

// PickAndOpen shows the native open dialog (hidden files visible, any
// extension or none) and opens every chosen file. Empty slice on cancel.
func (a *App) PickAndOpen() ([]OpenOutcome, error) {
	if a.headless {
		return nil, fmt.Errorf("native dialogs are unavailable in the headless bridge")
	}
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:             "Open Files",
		ShowHiddenFiles:   true,
		CanCreateDirectories: false,
	})
	if err != nil {
		return nil, fmt.Errorf("file dialog failed: %w", err)
	}
	if len(paths) == 0 {
		return []OpenOutcome{}, nil
	}
	return a.OpenPaths(paths), nil
}

// PickSaveAsPath shows the native save dialog and returns the chosen path, or
// "" when canceled.
func (a *App) PickSaveAsPath(defaultName string) (string, error) {
	if a.headless {
		return "", fmt.Errorf("native dialogs are unavailable in the headless bridge")
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:             "Save As",
		DefaultFilename:   defaultName,
		ShowHiddenFiles:   true,
	})
}

// SaveTab persists a tab. content is the LF-normalized buffer; eols the
// per-line terminators maintained by the frontend. The tab's recorded on-disk
// state gates silent overwrites (overwrite=true is the user's explicit
// decision after an external-change prompt).
func (a *App) SaveTab(tabId, path, content string, eols []string, encoding string, overwrite bool) SaveResponse {
	a.mu.Lock()
	t, ok := a.tabs[tabId]
	a.mu.Unlock()
	if !ok {
		return SaveResponse{Ok: false, Message: "Unknown tab; it may have been closed."}
	}
	if t.readOnly {
		return SaveResponse{Ok: false, Message: "This document is read-only (it could not be decoded cleanly). Use Save As to export a UTF-8 copy."}
	}
	if path == "" {
		return SaveResponse{Ok: false, Message: "This document has no filename yet. Use Save As to choose one."}
	}
	if !fileio.ValidEncoding(encoding) {
		return SaveResponse{Ok: false, Message: "Internal error: unknown encoding " + encoding}
	}
	data, err := fileio.BuildBytes(content, encoding, eols)
	if err != nil {
		return SaveResponse{Ok: false, Issue: &fileio.SaveIssue{Reason: "validation", Message: "The edited text could not be encoded safely.", Detail: err.Error()}}
	}

	// Saving to a different path (Save As) has no previous on-disk state to
	// guard; saving in place compares against what we last saw.
	var known *fileio.KnownState
	if t.path == path {
		k := t.known
		known = &k
	}
	sr, si := fileio.SaveDocument(path, data, known, overwrite)
	if si != nil {
		return SaveResponse{Ok: false, Issue: si}
	}

	a.mu.Lock()
	t.path = path
	t.encoding = encoding
	t.known = fileio.KnownState{Hash: sr.Hash, Size: sr.Size, ModTimeNanos: sr.ModTimeNanos}
	refresh := &TabInfo{TabId: t.id, Path: t.path, Encoding: t.encoding, Eols: eols, DefaultEol: t.defaultEol, EolSummary: t.eolSummary, ReadOnly: t.readOnly}
	a.mu.Unlock()
	a.watcher.Rename(tabId, path, fileio.KnownState{Hash: sr.Hash, Size: sr.Size, ModTimeNanos: sr.ModTimeNanos})
	return SaveResponse{Ok: true, Written: sr.Written, Tab: refresh}
}

// CloseTab drops a tab's server-side state (watcher included).
func (a *App) CloseTab(tabId string) {
	a.mu.Lock()
	delete(a.tabs, tabId)
	a.mu.Unlock()
	if a.watcher != nil {
		a.watcher.Remove(tabId)
	}
}

// SetDirty mirrors a tab's unsaved state so the window-close guard works even
// when the webview is not in the loop.
func (a *App) SetDirty(tabId string, dirty bool) {
	a.mu.Lock()
	if t, ok := a.tabs[tabId]; ok {
		t.dirty = dirty
	}
	a.mu.Unlock()
}

// SetWindowTitle updates the native window title (active file, app name).
func (a *App) SetWindowTitle(title string) {
	if a.ctx != nil {
		runtime.WindowSetTitle(a.ctx, title)
	}
}

// GetSettings returns effective settings, creating defaults on fresh install.
func (a *App) GetSettings() (settings.Settings, error) {
	s, err := settings.Load()
	if err == nil {
		a.mu.Lock()
		a.settings = s
		a.mu.Unlock()
	}
	return s, err
}

// PutSettings validates and persists settings.
func (a *App) PutSettings(s settings.Settings) error {
	if err := settings.Save(s); err != nil {
		return err
	}
	a.mu.Lock()
	a.settings = s
	a.mu.Unlock()
	return nil
}

// OpenExternalURL opens a link in the system browser. Only http(s) is
// allowed; this is the app's single outbound-network action and it requires a
// user click in the preview.
func (a *App) OpenExternalURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "Refused to open " + raw + ": only http and https links are allowed."
	}
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, u.String())
	}
	return ""
}

// QuitApp closes the window, bypassing the dirty guard because the frontend
// has already resolved unsaved work.
func (a *App) QuitApp() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	if a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}

// ResolveTabPath exposes open-tab paths to the localimg handler.
func (a *App) ResolveTabPath(tabID string) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	t, ok := a.tabs[tabID]
	if !ok {
		return "", false
	}
	return t.path, true
}

// EmitMenuAction broadcasts a menu action to the frontend. The desktop app
// wires native menu items to this; tests call it directly.
func (a *App) EmitMenuAction(action string) {
	a.emitEvent(EventMenuAction, action)
}

// EmitQuitRequest simulates the window-close guard for tests.
func (a *App) EmitQuitRequest() {
	a.emitEvent(EventQuitRequest, nil)
}
