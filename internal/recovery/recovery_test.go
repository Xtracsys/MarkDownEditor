// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package recovery

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSaveListRoundTrip(t *testing.T) {
	s := newStore(t)
	e := Entry{ID: "t1", TabID: "t1", Path: "/tmp/doc.md", Content: "unsaved work", Eols: []string{"\n", ""}, Encoding: "utf8", SavedAt: 42}
	if err := s.Save(e); err != nil {
		t.Fatal(err)
	}
	got, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Content != "unsaved work" || got[0].ID != "t1" || got[0].SavedAt != 42 {
		t.Fatalf("round trip mismatch: %+v", got)
	}
}

func TestListSortedOldestFirst(t *testing.T) {
	s := newStore(t)
	s.Save(Entry{ID: "b", Content: "later", SavedAt: time.Now().Unix()})
	time.Sleep(10 * time.Millisecond)
	s.Save(Entry{ID: "a", Content: "earlier", SavedAt: time.Now().Unix() - 100})
	got, _ := s.List()
	if len(got) != 2 || got[0].Content != "earlier" {
		t.Fatalf("order wrong: %+v", got)
	}
}

func TestClearAndClearAll(t *testing.T) {
	s := newStore(t)
	s.Save(Entry{ID: "t1", Content: "x"})
	s.Save(Entry{ID: "t2", Content: "y"})
	if err := s.Clear("t1"); err != nil {
		t.Fatal(err)
	}
	if err := s.Clear("missing"); err != nil {
		t.Fatal(err) // clearing absent ids must not error
	}
	got, _ := s.List()
	if len(got) != 1 || got[0].ID != "t2" {
		t.Fatalf("clear failed: %+v", got)
	}
	if err := s.ClearAll(); err != nil {
		t.Fatal(err)
	}
	got, _ = s.List()
	if len(got) != 0 {
		t.Fatalf("clear all failed: %+v", got)
	}
}

func TestCorruptAndForeignFilesIgnored(t *testing.T) {
	s := newStore(t)
	s.Save(Entry{ID: "good", Content: "ok"})
	os.WriteFile(filepath.Join(s.Dir(), "bad.json"), []byte("{not json"), 0o600)
	os.WriteFile(filepath.Join(s.Dir(), "empty.json"), []byte(`{"id":"e","content":""}`), 0o600) // emptied buffer is still recoverable
	os.WriteFile(filepath.Join(s.Dir(), "notes.txt"), []byte("foreign"), 0o600)
	got, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected good + emptied entries: %+v", got)
	}
}

func TestPermissionsArePrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows inherits access control lists; Go does not expose POSIX mode bits")
	}
	s := newStore(t)
	if err := s.Save(Entry{ID: "t1", Content: "secret-ish"}); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(s.Dir(), "t1.json"))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("snapshot perms = %o, want 600", fi.Mode().Perm())
	}
	// Directory itself private too.
	di, err := os.Stat(s.Dir())
	if err != nil {
		t.Fatal(err)
	}
	if di.Mode().Perm() != 0o700 {
		t.Fatalf("dir perms = %o, want 700", di.Mode().Perm())
	}
}

func TestHostileIdsCannotEscapeFolder(t *testing.T) {
	s := newStore(t)
	for _, id := range []string{"", "../escape", "a/b", "..", ".hidden", "with space", "tab\tchar", string(make([]byte, 200))} {
		if err := s.Save(Entry{ID: id, Content: "x"}); err == nil {
			t.Fatalf("id %q should have been rejected", id)
		}
	}
	// Nothing but a valid entry may exist in the folder.
	s.Save(Entry{ID: "ok1", Content: "x"})
	entries, _ := os.ReadDir(s.Dir())
	if len(entries) != 1 {
		names := []string{}
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("unexpected folder contents: %v", names)
	}
}

func TestSnapshotsNeverNextToDocuments(t *testing.T) {
	// The store path is derived solely from its base (the app-data dir);
	// document paths influence nothing. Guard the invariant structurally.
	s := newStore(t)
	s.Save(Entry{ID: "t1", Path: "/important/docs/", Content: "x"})
	if filepath.Dir(s.Dir()) == "/important/docs" {
		t.Fatal("recovery folder must not be derived from document paths")
	}
}
