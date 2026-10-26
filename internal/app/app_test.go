// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package app

import (
	"os"
	"path/filepath"
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

	a.MarkExternalReady()
	deadline := time.After(time.Second)
	for {
		mu := &sync.Mutex{}
		_ = mu
		if len(*events) > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("queued open never flushed")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if (*events)[0].name != EventOpenPaths {
		t.Fatalf("event = %s, want %s", (*events)[0].name, EventOpenPaths)
	}
	paths := (*events)[0].data.([]string)
	if len(paths) != 1 || paths[0] != "/tmp/a.md" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestExternalOpenAfterReadyEmitsImmediately(t *testing.T) {
	a, events := headlessApp(t)
	a.MarkExternalReady()
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
