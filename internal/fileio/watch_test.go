// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package fileio

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestWatcherDetectsExternalChange(t *testing.T) {
	p := writeTemp(t, []byte("v1\n"))
	res, _ := Load(p)
	events := make(chan WatchEvent, 8)
	w := NewWatcher(func(e WatchEvent) { events <- e })
	w.Register("tab1", p, KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos})

	ctx, cancel := context.WithCancel(context.Background())
	go w.Run(ctx)
	defer cancel()

	// Touch with identical content: must NOT fire (hash confirmation).
	future := res.ModTimeNanos + 5_000_000_000
	os.Chtimes(p, time.Unix(0, future), time.Unix(0, future))
	drain(t, events, 600*time.Millisecond, "no event expected for touch-with-same-content")

	// Real external change: must fire exactly once.
	os.WriteFile(p, []byte("v2 external\n"), 0o644)
	e := expectEvent(t, events, 3*time.Second)
	if e.Kind != WatchChanged || e.TabID != "tab1" {
		t.Fatalf("event = %+v, want changed/tab1", e)
	}
	drain(t, events, 600*time.Millisecond, "change should fire once")

	// Deletion and restoration.
	os.Remove(p)
	e = expectEvent(t, events, 3*time.Second)
	if e.Kind != WatchDeleted {
		t.Fatalf("event = %+v, want deleted", e)
	}
	os.WriteFile(p, []byte("v3 restored\n"), 0o644)
	e = expectEvent(t, events, 3*time.Second)
	if e.Kind != WatchRestored {
		t.Fatalf("event = %+v, want restored", e)
	}
}

func TestWatcherIgnoresOurOwnSaveState(t *testing.T) {
	p := writeTemp(t, []byte("v1\n"))
	res, _ := Load(p)
	events := make(chan WatchEvent, 8)
	w := NewWatcher(func(e WatchEvent) { events <- e })
	known := KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos}
	w.Register("tab1", p, known)

	ctx, cancel := context.WithCancel(context.Background())
	go w.Run(ctx)
	defer cancel()

	// Simulate what app.go does after a save: write through SaveDocument then
	// Update the watcher with the new state.
	data, _ := BuildBytes("v2 ours\n", EncUTF8, []string{"\n", ""})
	sr, si := SaveDocument(p, data, &known, false)
	if si != nil {
		t.Fatalf("save issue: %+v", si)
	}
	w.Update("tab1", KnownState{Hash: sr.Hash, Size: sr.Size, ModTimeNanos: sr.ModTimeNanos})
	drain(t, events, 600*time.Millisecond, "our own save must not fire an external-change event")
}

func drain(t *testing.T, ch chan WatchEvent, d time.Duration, msg string) {
	t.Helper()
	deadline := time.After(d)
	for {
		select {
		case e := <-ch:
			t.Fatalf("%s; got event %q", msg, e.Kind)
		case <-deadline:
			return
		}
	}
}

func expectEvent(t *testing.T, ch chan WatchEvent, timeout time.Duration) WatchEvent {
	t.Helper()
	select {
	case e := <-ch:
		return e
	case <-time.After(timeout):
		t.Fatal("expected a watcher event, timed out")
		return WatchEvent{}
	}
}
