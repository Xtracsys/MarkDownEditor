// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package app

import (
	"encoding/json"
	"github.com/xtracsys/xtracsys-editor/internal/recovery"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func headlessApp(t *testing.T) (*App, *[]event) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("APPDATA", filepath.Join(dir, "AppData"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(dir, ".config"))

	a := NewApp()
	var mu sync.Mutex
	events := &[]event{}
	a.InitHeadless(t.Context(), func(name string, data interface{}) {
		mu.Lock()
		*events = append(*events, event{name: name, data: data})
		mu.Unlock()
	})
	return a, events
}

type event struct {
	name string
	data interface{}
}

func TestExternalOpenQueuesUntilReady(t *testing.T) {
	a, events := headlessApp(t)

	a.QueueExternalOpen([]string{"/tmp/a.md"})
	time.Sleep(200 * time.Millisecond)
	if len(*events) != 0 {
		t.Fatalf("no event expected before MarkExternalReady, got %d", len(*events))
	}

	returned := a.MarkExternalReady()
	// Pull-based: the backlog arrives as the RPC result, never racing events.
	if len(returned) != 1 || returned[0] != "/tmp/a.md" {
		t.Fatalf("MarkExternalReady returned %v", returned)
	}
	time.Sleep(100 * time.Millisecond)
	if len(*events) != 0 {
		t.Fatalf("backlog must not also fire as an event: %d events", len(*events))
	}
}

func TestExternalOpenAfterReadyEmitsImmediately(t *testing.T) {
	a, events := headlessApp(t)
	if got := a.MarkExternalReady(); len(got) != 0 {
		t.Fatalf("first ready returned %v, want empty", got)
	}
	a.QueueExternalOpen([]string{"/tmp/b.md"})
	deadline := time.After(time.Second)
	for {
		if len(*events) > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("open event never emitted after ready")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if (*events)[0].name != EventOpenPaths {
		t.Fatalf("event = %s", (*events)[0].name)
	}
}

func TestExternalOpenFiltersFlagsAndEmpties(t *testing.T) {
	a, events := headlessApp(t)
	a.MarkExternalReady()
	a.QueueExternalOpen([]string{"", "-psn_0_12345", "--flag", "/tmp/real.md"})
	deadline := time.After(time.Second)
	for {
		if len(*events) > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("expected exactly one filtered path event")
		case <-time.After(10 * time.Millisecond):
		}
	}
	paths := (*events)[0].data.([]string)
	if len(paths) != 1 || paths[0] != "/tmp/real.md" {
		t.Fatalf("flags leaked into open queue: %v", paths)
	}
}

func TestContextCancelled(t *testing.T) {
	// InitHeadless must not blow up when the context ends (watcher goroutine).
	a, _ := headlessApp(t)
	a.MarkExternalReady()
	time.Sleep(50 * time.Millisecond)
	if _, err := os.Stat("/"); err != nil {
		t.Fatal("sanity")
	}
}

// Regression for the production crash: ListRecovery on a fresh store must
// marshal as [] (not null) — JS consumers evaluate .length on it.
func TestListRecoveryMarshalsEmptyNotNUll(t *testing.T) {
	a, _ := headlessApp(t)
	data, err := json.Marshal(a.ListRecovery())
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "[]" {
		t.Fatalf("ListRecovery JSON = %s, want []", data)
	}
}

// Crash recovery is opt-in: SnapshotTab must write nothing when disabled,
// and InitHeadless must erase stale snapshots at boot.
func TestSnapshotTabGatedBySetting(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("APPDATA", filepath.Join(dir, "AppData"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(dir, ".config"))

	a := NewApp()
	var mu sync.Mutex
	events := &[]event{}
	a.InitHeadless(t.Context(), func(name string, data interface{}) {
		mu.Lock()
		*events = append(*events, event{name: name, data: data})
		mu.Unlock()
	})
	// InitHeadless loaded settings with recovery OFF (default) and cleared
	// stale snapshots. Seed one manually to prove the gate, not just absence.
	if a.recov == nil {
		t.Fatal("recovery store should exist")
	}
	if err := a.recov.Save(recovery.Entry{ID: "stale", Content: "old"}); err != nil {
		t.Fatal(err)
	}
	if err := a.SnapshotTab("t1", "/tmp/x.md", "secret draft", []string{"\n"}, "utf8"); err != nil {
		t.Fatal(err)
	}
	entries, _ := a.recov.List()
	if len(entries) != 1 || entries[0].ID != "stale" {
		t.Fatalf("disabled SnapshotTab must write nothing: %+v", entries)
	}
}

func TestStartupErasesSnapshotsWhenDisabled(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("APPDATA", filepath.Join(dir, "AppData"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(dir, ".config"))

	// A previous session left snapshots behind.
	st, _ := recovery.New(filepath.Join(dir, "Library/Application Support/xtracsys-editor"))
	_ = st.Save(recovery.Entry{ID: "leftover", Content: "old draft"})
	a := NewApp()
	a.InitHeadless(t.Context(), func(string, interface{}) {})
	entries, _ := a.recov.List()
	if len(entries) != 0 {
		t.Fatalf("startup with recovery disabled must erase snapshots: %+v", entries)
	}
}
func TestNewTabWarningsNotNull(t *testing.T) {
	a, _ := headlessApp(t)
	data, err := json.Marshal(a.NewTab())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"warnings":[]`) {
		t.Fatalf("NewTab JSON missing warnings:[]: %s", data)
	}
}
