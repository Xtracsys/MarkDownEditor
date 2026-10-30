// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Package app hosts the editor application service: the tab registry,
// dialogs, events, and every file operation the UI can request. It is bound
// to the webview by main and reused headlessly by cmd/e2e-serve.
package app

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sync"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/xtracsys/xtracsys-editor/internal/fileio"
	"github.com/xtracsys/xtracsys-editor/internal/recovery"
	"github.com/xtracsys/xtracsys-editor/internal/session"
	"github.com/xtracsys/xtracsys-editor/internal/settings"
)

// AppVersion and BuildStamp are written to buildstamp_gen.go by
// scripts/build-all.sh before compiling. ( -ldflags -X proved unreliable
// under the build cache in this setup, so the stamp is a source literal. )
var (
	AppVersion = GeneratedAppVersion
	BuildStamp = GeneratedBuildStamp
)

// Event names emitted to the frontend.
const (
	EventWatch       = "watch:event"
	EventMenuAction  = "menu:action"
	EventQuitRequest = "app:quit-requested"
	EventOpenPaths   = "open:paths"
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
	recov    *recovery.Store
	sess     *session.Store

	// eventSink routes Go→frontend events. In the desktop app it wraps
	// runtime.EventsEmit; the E2E bridge server swaps it for SSE.
	eventSink func(name string, data interface{})

	// headless marks the E2E bridge mode: no webview, no native dialogs.
	headless bool

	// external opens (Open With, argv, drag-drop) queue until the frontend
	// signals it can receive open:paths events, then flush in order.
	extMu      sync.Mutex
	extReady   bool
	extPending []string

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
	if dir, err := settings.Dir(); err == nil {
		a.recov, _ = recovery.New(dir)
		a.sess, _ = session.New(dir)
	}
	a.watcher = fileio.NewWatcher(func(ev fileio.WatchEvent) {
		a.emitEvent(EventWatch, ev)
	})
	go a.watcher.Run(ctx)
}

// rebuildMenu refreshes the native application menu (recent files) when the
// menu has been installed. Defined in menu.go.
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
	a.debugLog("Startup", AppVersion+"/"+BuildStamp)
	a.ctx = ctx
	a.settings, _ = settings.Load()
	if dir, err := settings.Dir(); err == nil {
		a.recov, _ = recovery.New(dir)
		a.sess, _ = session.New(dir)
	}
	a.rebuildMenu() // now that ctx exists: install menu with recent files
	a.watcher = fileio.NewWatcher(func(ev fileio.WatchEvent) {
		a.emitEvent(EventWatch, ev)
	})
	runtime.OnFileDrop(ctx, func(x, y int, paths []string) {
		a.QueueExternalOpen(paths)
	})
	if os.Getenv("XTRACSYS_EDITOR_DEBUG") == "1" {
		// Diagnostics only: after 6s, emit a synthetic external open so the
		// Go->JS event loop can be verified end to end without Apple Events.
		go func() {
			time.Sleep(6 * time.Second)
			a.debugLog("EmittingTestOpen", nil)
			a.emitEvent(EventOpenPaths, []string{"/tmp/verify-open.md"})
		}()
	}
	go a.watcher.Run(ctx)
}

// Shutdown cancels the watcher and records the session (open named
// documents, in tab order) so the next launch can restore it.
func (a *App) Shutdown(ctx context.Context) {
	a.SaveSessionNow()
}

// SaveSessionNow records the currently open named documents. Called
// automatically on graceful shutdown; also exposed for tests.
func (a *App) SaveSessionNow() {
	if a.sess == nil {
		return
	}
	a.mu.Lock()
	restore := a.settings.RestoreSession
	a.mu.Unlock()
	if !restore {
		return // the user turned session persistence off
	}
	a.mu.Lock()
	paths := make([]string, 0, len(a.tabs))
	for _, t := range a.tabs {
		if t.path != "" {
			paths = append(paths, t.path)
		}
	}
	a.mu.Unlock()
	_ = a.sess.SaveLastSession(paths)
}

// SessionSetter exposes the session store to the test harness (nil-safe).
func (a *App) SessionSetter() *session.Store {
	return a.sess
}

// GetLastSession returns the previously recorded session's existing paths,
// or an empty list when session restore is disabled.
func (a *App) GetLastSession() []string {
	a.mu.Lock()
	restore := a.settings.RestoreSession
	a.mu.Unlock()
	a.debugLog("GetLastSession", restore)
	if !restore {
		return []string{}
	}
	if a.sess == nil {
		return []string{}
	}
	return a.sess.LoadLastSession()
}

// ClearSession empties the recorded session (used by tests and diagnostics).
func (a *App) ClearSession() {
	if a.sess != nil {
		_ = a.sess.SaveLastSession([]string{})
	}
}

// GetRecentFiles returns the recent-files list, most recent first.
func (a *App) GetRecentFiles() []string {
	if a.sess == nil {
		return []string{}
	}
	return a.sess.LoadRecent()
}

// ClearRecentFiles empties the recent-files list.
func (a *App) ClearRecentFiles() {
	if a.sess != nil {
		a.sess.ClearRecent()
		a.rebuildMenu()
	}
}

// RevealPath shows the file in the OS file manager (Finder/Explorer).
// Returns an empty string on success, else a user-readable message.
func (a *App) RevealPath(path string) string {
	if strings.HasPrefix(path, "-") {
		return "Refused to reveal " + path
	}
	if _, err := os.Stat(path); err != nil {
		return "File not found: " + path
	}
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	case "windows":
		cmd = exec.Command("explorer", "/select,", path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	if err := cmd.Start(); err != nil {
		return "Could not open the file manager: " + err.Error()
	}
	go cmd.Wait()
	return ""
}

// WriteImageFile stores pasted clipboard image data next to the document and
// returns the file name actually used (never overwrites; suffixes -1, -2…).
// Only PNG and JPEG are accepted, 20 MB cap — the same policy as the preview.
func (a *App) WriteImageFile(tabId, name, base64Data string) (string, error) {
	a.mu.Lock()
	t, ok := a.tabs[tabId]
	a.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("unknown tab")
	}
	if t.path == "" {
		return "", fmt.Errorf("save the document first so the image has a destination")
	}
	if len(base64Data) > 20*1024*1024/3*4 { // base64 of the 20 MB serve cap
		return "", fmt.Errorf("image exceeds the 20 MB limit")
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("image data could not be decoded")
	}
	ct := http.DetectContentType(data)
	if ct != "image/png" && ct != "image/jpeg" {
		return "", fmt.Errorf("clipboard image is %s; only PNG and JPEG are supported", ct)
	}
	ext := ".png"
	if ct == "image/jpeg" {
		ext = ".jpg"
	}
	dir := filepath.Dir(t.path)
	base := strings.TrimSuffix(name, filepath.Ext(name))
	base = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, base)
	if base == "" || strings.HasPrefix(base, ".") {
		base = "pasted-image"
	}
	for attempt := 0; attempt < 100; attempt++ {
		candidate := base + ext
		if attempt > 0 {
			candidate = fmt.Sprintf("%s-%d%s", base, attempt, ext)
		}
		full := filepath.Join(dir, candidate)
		// O_EXCL: never overwrite, never follow a pre-planted symlink.
		f, err := os.OpenFile(full, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			if os.IsExist(err) {
				continue
			}
			return "", fmt.Errorf("could not write the image: %v", err)
		}
		if _, err := f.Write(data); err != nil {
			f.Close()
			os.Remove(full)
			return "", fmt.Errorf("could not write the image: %v", err)
		}
		if err := f.Close(); err != nil {
			os.Remove(full)
			return "", fmt.Errorf("could not write the image: %v", err)
		}
		return candidate, nil
	}
	return "", fmt.Errorf("could not find a free file name")
}

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
		"build":    BuildStamp,
		"platform": goruntime.GOOS,
		"arch":     goruntime.GOARCH,
	}
}

// NewTab creates an untitled document. Untitled documents are never written
// anywhere until the user names them via Save As.
func (a *App) NewTab() *TabInfo {
	a.debugLog("NewTab", nil)
	a.mu.Lock()
	defer a.mu.Unlock()
	empty := &fileio.LoadResult{Content: "", Encoding: fileio.EncUTF8, Eols: []string{""}, DefaultEol: fileio.LF, EolSummary: string(fileio.SummaryNone)}
	return a.newTabLocked("", empty)
}

// OpenPaths loads files by absolute path (open-with, drag-drop, E2E).
func (a *App) OpenPaths(paths []string) []OpenOutcome {
	a.debugLog("OpenPaths", paths)
	out := make([]OpenOutcome, 0, len(paths))
	if out == nil {
		out = []OpenOutcome{}
	}
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
	if a.sess != nil {
		_ = a.sess.AddRecent(path)
		a.rebuildMenu()
	}
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
	if path == "" {
		return SaveResponse{Ok: false, Message: "This document has no filename yet. Use Save As to choose one."}
	}
	if t.readOnly && t.path == path {
		return SaveResponse{Ok: false, Message: "This document is read-only (it could not be decoded cleanly), so saving in place is disabled. Use Save As to export a UTF-8 copy."}
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
	if eols == nil {
		eols = []string{}
	}
	refresh := &TabInfo{TabId: t.id, Path: t.path, Encoding: t.encoding, Eols: eols, DefaultEol: t.defaultEol, EolSummary: t.eolSummary, ReadOnly: t.readOnly, Warnings: []string{}}
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

// QueueExternalOpen schedules documents that reached the app from outside the
// UI: macOS "Open With"/Dock-drop Apple Events, files passed on the command
// line, drag-and-drop onto the window, and second-instance launches. Paths
// queue until the frontend is ready, then arrive through one open:paths event
// and flow through the same open pipeline as the in-app Open dialog.
func (a *App) QueueExternalOpen(paths []string) {
	exe, _ := os.Executable()
	clean := make([]string, 0, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" || strings.HasPrefix(p, "-") {
			continue
		}
		// Second-instance argv can include the executable itself. Full-path
		// comparison only — a document may legitimately share the basename.
		if exe != "" && strings.EqualFold(p, exe) {
			continue
		}
		clean = append(clean, p)
	}
	if len(clean) == 0 {
		return
	}
	a.debugLog("QueueExternalOpen", clean)
	a.extMu.Lock()
	if !a.extReady {
		a.extPending = append(a.extPending, clean...)
		a.extMu.Unlock()
		return
	}
	a.extMu.Unlock()
	a.emitEvent(EventOpenPaths, clean)
}

// debugLog appends diagnostics when XTRACSYS_EDITOR_DEBUG=1 (set via
// `launchctl setenv` to inspect GUI-launched instances). Opt-in, app-data
// only, never enabled by default.
func (a *App) debugLog(what string, detail interface{}) {
	if os.Getenv("XTRACSYS_EDITOR_DEBUG") != "1" {
		return
	}
	dir, err := settings.Dir()
	if err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "debug.log"),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %s %v\n", time.Now().Format(time.RFC3339), what, detail)
}

// QueueExternalOpenOne adapts single-path callbacks (macOS OnFileOpen).
func (a *App) QueueExternalOpenOne(path string) {
	a.QueueExternalOpen([]string{path})
}

// MarkExternalReady flips the app into live event delivery AND returns any
// externally queued paths directly as its RPC result — the backlog is
// delivered pull-based so it can never race event-listener wiring.
func (a *App) MarkExternalReady() []string {
	a.extMu.Lock()
	pending := a.extPending
	a.extPending = nil
	a.extReady = true
	a.extMu.Unlock()
	if pending == nil {
		pending = []string{}
	}
	return pending
}

// SnapshotTab stores a crash-recovery snapshot of an unsaved buffer under the
// OS app-data folder. Originals are never touched; restoring produces a
// normal dirty tab the user saves deliberately.
func (a *App) SnapshotTab(tabId, path, content string, eols []string, encoding string) error {
	if a.recov == nil {
		return nil // recovery unavailable; editing still works
	}
	a.mu.Lock()
	_, exists := a.tabs[tabId]
	a.mu.Unlock()
	if !exists {
		return nil // tab closed while a debounced snapshot was in flight
	}
	if _, err := fileio.Rebuild(content, eols); err != nil {
		return err // never snapshot something we could not save faithfully
	}
	return a.recov.Save(recovery.Entry{
		ID: tabId, TabID: tabId, Path: path,
		Content: content, Eols: eols, Encoding: encoding,
		SavedAt: time.Now().Unix(),
	})
}

// ClearRecovery drops a tab's snapshot after a clean save, close, or discard.
func (a *App) ClearRecovery(tabId string) {
	if a.recov != nil {
		a.recov.Clear(tabId)
	}
}

// Nil slices marshal as JSON null, which crashes JS consumers evaluating
// .length — every slice crossing the binding boundary is materialized.
func (a *App) ListRecovery() []recovery.Entry {
	empty := []recovery.Entry{}
	if a.recov == nil {
		return empty
	}
	list, err := a.recov.List()
	if err != nil {
		return empty
	}
	a.debugLog("ListRecovery", len(list))
	if list == nil {
		return empty
	}
	for i := range list {
		if list[i].Eols == nil {
			list[i].Eols = []string{}
		}
	}
	return list
}

// DiscardRecovery deletes the given snapshots (explicit user choice).
func (a *App) DiscardRecovery(ids []string) {
	if a.recov != nil {
		a.recov.Clear(ids...)
	}
}

// RecoverEntry restores a snapshot as a new dirty tab.
func (a *App) RecoverEntry(id string) OpenOutcome {
	if a.recov == nil {
		return OpenOutcome{Issue: &fileio.Issue{Reason: "io", Message: "Recovery is unavailable."}}
	}
	entries, err := a.recov.List()
	if err != nil {
		return OpenOutcome{Issue: &fileio.Issue{Reason: "io", Message: "Recovery data could not be read."}}
	}
	var entry *recovery.Entry
	for i := range entries {
		if entries[i].ID == id {
			entry = &entries[i]
			break
		}
	}
	if entry == nil {
		return OpenOutcome{Issue: &fileio.Issue{Reason: "not-found", Message: "That recovery snapshot no longer exists."}}
	}
	encoding := entry.Encoding
	if !fileio.ValidEncoding(encoding) {
		encoding = fileio.EncUTF8
	}
	eols := entry.Eols
	if eols == nil {
		eols = []string{""}
	}
	pred, summary := fileio.EolInfo(eols)
	res := &fileio.LoadResult{
		Path:        entry.Path,
		Content:     entry.Content,
		Encoding:    encoding,
		Eols:        eols,
		DefaultEol:  pred,
		EolSummary:  string(summary),
		Warnings:    []string{},
	}
	// Known on-disk state = whatever is on disk right now, so the watcher and
	// the save guard treat the restored tab consistently from here on.
	if fi, err := os.Stat(entry.Path); err == nil && fi.Mode().IsRegular() {
		if data, rerr := os.ReadFile(entry.Path); rerr == nil {
			res.Hash = fileio.HashOf(data)
		}
		res.Size = fi.Size()
		res.ModTimeNanos = fi.ModTime().UnixNano()
	}
	a.mu.Lock()
	tab := a.newTabLocked(entry.Path, res)
	a.tabs[tab.TabId].dirty = true
	a.mu.Unlock()
	return OpenOutcome{Tab: tab}
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
	a.debugLog("GetSettings", nil)
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
	a.debugLog("PutSettings", s.RestoreSession)
	if err := settings.Save(s); err != nil {
		return err
	}
	a.mu.Lock()
	a.settings = s
	a.mu.Unlock()
	if !s.RestoreSession && a.sess != nil {
		// Opting out is also an erasure: the recorded session is discarded.
		_ = a.sess.SaveLastSession([]string{})
	}
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
