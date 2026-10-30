// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package session

import (
	"os"
	"path/filepath"
	"testing"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLastSessionRoundTrip(t *testing.T) {
	s := newStore(t)
	dir := t.TempDir()
	a := filepath.Join(dir, "a.md")
	b := filepath.Join(dir, "b.txt")
	os.WriteFile(a, []byte("x"), 0o600)
	os.WriteFile(b, []byte("x"), 0o600)
	paths := []string{a, b}
	if err := s.SaveLastSession(paths); err != nil {
		t.Fatal(err)
	}
	got := s.LoadLastSession()
	if len(got) != 2 || got[0] != a {
		t.Fatalf("session = %v", got)
	}
}

func TestLastSessionDropsMissingFiles(t *testing.T) {
	s := newStore(t)
	existing := filepath.Join(t.TempDir(), "exists.md")
	os.WriteFile(existing, []byte("x"), 0o600)
	if err := s.SaveLastSession([]string{existing, "/gone/missing.md"}); err != nil {
		t.Fatal(err)
	}
	got := s.LoadLastSession()
	if len(got) != 1 || got[0] != existing {
		t.Fatalf("missing files must be dropped: %v", got)
	}
}

func TestLastSessionEmptyIsValid(t *testing.T) {
	s := newStore(t)
	if err := s.SaveLastSession(nil); err != nil {
		t.Fatal(err)
	}
	if got := s.LoadLastSession(); len(got) != 0 {
		t.Fatalf("empty session = %v", got)
	}
}

func TestRecentDedupesAndCaps(t *testing.T) {
	s := newStore(t)
	for i := 0; i < 15; i++ {
		if err := s.AddRecent(string(rune('a'+i)) + ".md"); err != nil {
			t.Fatal(err)
		}
	}
	got := s.LoadRecent()
	if len(got) != 10 {
		t.Fatalf("recent cap = %d, want 10", len(got))
	}
	if got[0] != "o.md" || got[1] != "n.md" {
		t.Fatalf("most-recent-first violated: %v", got)
	}
	// Re-opening a file moves it to the front.
	if err := s.AddRecent("a.md"); err != nil {
		t.Fatal(err)
	}
	got = s.LoadRecent()
	if got[0] != "a.md" {
		t.Fatalf("re-open did not move to front: %v", got)
	}
	// Exactly one entry per path (deduplicated).
	count := 0
	for _, p := range got {
		if p == "a.md" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("duplicate recent entries: %v", got)
	}
}

func TestClearRecent(t *testing.T) {
	s := newStore(t)
	s.AddRecent("a.md")
	if err := s.ClearRecent(); err != nil {
		t.Fatal(err)
	}
	if got := s.LoadRecent(); len(got) != 0 {
		t.Fatalf("clear failed: %v", got)
	}
}

func TestFilePermissions(t *testing.T) {
	s := newStore(t)
	s.AddRecent("a.md")
	fi, err := os.Stat(s.file)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("session file perms = %o, want 600", fi.Mode().Perm())
	}
}
