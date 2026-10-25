// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package fileio

import (
	"context"
	"os"
	"sync"
	"time"
)

// WatchKind describes an external change to a watched tab's file.
type WatchKind string

const (
	WatchChanged  WatchKind = "changed"  // content on disk differs from the last known state
	WatchDeleted  WatchKind = "deleted"  // file disappeared
	WatchRestored WatchKind = "restored" // file reappeared after being deleted
)

// WatchEvent is emitted once per actual external change.
type WatchEvent struct {
	TabID string    `json:"tabId"`
	Kind  WatchKind `json:"kind"`
}

// Watcher polls open documents and reports external modifications. Polling
// (stat + SHA-256 on mtime/size change) is deliberately chosen over inotify
// family APIs: it behaves identically on every OS and every filesystem,
// including network mounts, and for a handful of open tabs it costs nothing.
type Watcher struct {
	mu     sync.Mutex
	tabs   map[string]*watchedTab
	emit   func(WatchEvent)
	interval time.Duration
}

type watchedTab struct {
	path    string
	known   KnownState
	missing bool
}

// NewWatcher creates a watcher that reports events through emit.
func NewWatcher(emit func(WatchEvent)) *Watcher {
	return &Watcher{
		tabs:     make(map[string]*watchedTab),
		emit:     emit,
		interval: 1500 * time.Millisecond,
	}
}

// Register starts watching tabID at path with the given known state.
func (w *Watcher) Register(tabID, path string, known KnownState) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.tabs[tabID] = &watchedTab{path: path, known: known}
}

// Update refreshes the expected state after our own save.
func (w *Watcher) Update(tabID string, known KnownState) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if t, ok := w.tabs[tabID]; ok {
		t.known = known
		t.missing = false
	}
}

// Rename re-points a tab after Save As.
func (w *Watcher) Rename(tabID, path string, known KnownState) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.tabs[tabID] = &watchedTab{path: path, known: known}
}

// Remove stops watching a tab.
func (w *Watcher) Remove(tabID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.tabs, tabID)
}

// Paths returns the set of watched paths (used by the preview image handler to
// validate that an image request belongs to an open document's directory).
func (w *Watcher) Paths() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]string, 0, len(w.tabs))
	for _, t := range w.tabs {
		out = append(out, t.path)
	}
	return out
}

// Run polls until ctx is done. Intended to run as a goroutine from app start.
func (w *Watcher) Run(ctx context.Context) {
	t := time.NewTicker(w.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.poll()
		}
	}
}

func (w *Watcher) poll() {
	// Snapshot under lock, inspect without holding it so a slow disk cannot
	// block Register/Remove from the UI thread.
	type job struct {
		id   string
		path string
		known KnownState
		missing bool
	}
	w.mu.Lock()
	jobs := make([]job, 0, len(w.tabs))
	for id, t := range w.tabs {
		jobs = append(jobs, job{id, t.path, t.known, t.missing})
	}
	w.mu.Unlock()

	for _, j := range jobs {
		ev, newKnown, nowMissing := inspect(j.path, j.known, j.missing)
		if ev != "" {
			w.mu.Lock()
			if t, ok := w.tabs[j.id]; ok {
				if newKnown.Hash != "" {
					t.known = newKnown
				}
				t.missing = nowMissing
			}
			w.mu.Unlock()
			w.emit(WatchEvent{TabID: j.id, Kind: ev})
		}
	}
}

// inspect stats a path and decides whether an event should fire.
func inspect(path string, known KnownState, missing bool) (ev WatchKind, newKnown KnownState, nowMissing bool) {
	fi, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) && !missing {
			return WatchDeleted, KnownState{}, true
		}
		return "", KnownState{}, missing
	}
	if !fi.Mode().IsRegular() {
		// Never read devices/sockets/FIFOs from the watcher.
		return "", KnownState{}, missing
	}
	if missing {
		// File reappeared: report restored if its content differs from what
		// we last knew, otherwise just clear the flag silently.
		data, rerr := os.ReadFile(path)
		if rerr != nil {
			return "", KnownState{}, false
		}
		k := KnownState{Hash: hashBytes(data), Size: fi.Size(), ModTimeNanos: fi.ModTime().UnixNano()}
		if k.Hash != known.Hash {
			return WatchRestored, k, false
		}
		return "", k, false
	}
	if fi.Size() == known.Size && fi.ModTime().UnixNano() == known.ModTimeNanos {
		return "", KnownState{}, false
	}
	// mtime/size changed: confirm with a hash before bothering the user.
	data, rerr := os.ReadFile(path)
	if rerr != nil {
		return "", KnownState{}, false
	}
	h := hashBytes(data)
	if h == known.Hash {
		// Touched but not changed (e.g. a build tool re-writing identical
		// bytes): absorb silently.
		k := KnownState{Hash: h, Size: fi.Size(), ModTimeNanos: fi.ModTime().UnixNano()}
		return "", k, false
	}
	k := KnownState{Hash: h, Size: fi.Size(), ModTimeNanos: fi.ModTime().UnixNano()}
	return WatchChanged, k, false
}
