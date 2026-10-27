// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Package recovery stores periodic snapshots of unsaved (dirty) buffers so a
// crash or forced quit never loses user work.
//
// Disclosure and constraints, enforced here and by tests:
//   - snapshots live ONLY under <OS app-data>/xtracsys-editor/recovery,
//     never next to documents, never in project directories;
//   - originals are never touched — restoring produces ordinary dirty tabs
//     that the user saves deliberately;
//   - snapshot files are written atomically with 0600 permissions (they can
//     contain private document content);
//   - corrupt or foreign files in the folder are ignored, never fatal.
package recovery

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Entry is one snapshot of an unsaved buffer.
type Entry struct {
	ID       string `json:"id"` // stable per tab, used as the file name
	TabID    string `json:"tabId"`
	Path     string `json:"path"` // "" for untitled documents
	Content  string `json:"content"`
	Eols     []string `json:"eols"`
	Encoding string `json:"encoding"`
	SavedAt  int64  `json:"savedAt"` // unix seconds
}

// Store manages the recovery folder.
type Store struct {
	dir string
}

// New returns a store rooted at <base>/recovery, creating it with 0700.
func New(base string) (*Store, error) {
	dir := filepath.Join(base, "recovery")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

// Dir reports the recovery folder (for diagnostics and tests).
func (s *Store) Dir() string { return s.dir }

func (s *Store) fileFor(id string) (string, error) {
	name, err := safeName(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.dir, name+".json"), nil
}

// safeName restricts ids to [A-Za-z0-9._-] so a hostile id can never escape
// the folder through path separators, traversal, or empty names.
func safeName(id string) (string, error) {
	if id == "" || len(id) > 128 {
		return "", fmt.Errorf("invalid recovery id")
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '_', r == '-':
		default:
			return "", fmt.Errorf("invalid character %q in recovery id", r)
		}
	}
	if strings.HasPrefix(id, ".") {
		return "", fmt.Errorf("invalid recovery id")
	}
	return id, nil
}

// Save atomically writes (or overwrites) the snapshot for e.ID.
func (s *Store) Save(e Entry) error {
	if e.SavedAt == 0 {
		e.SavedAt = time.Now().Unix()
	}
	path, err := s.fileFor(e.ID)
	if err != nil {
		return err
	}
	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// List returns all valid snapshots, oldest first. Corrupt or unreadable
// files are skipped, and reported via the error only when nothing could be
// read at all — recovery must never fail the app start.
func (s *Store) List() ([]Entry, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var out []Entry
	for _, de := range entries {
		if de.IsDir() {
			continue
		}
		// Sweep crash-orphaned temp files — but only stale ones, so an
		// in-flight snapshot write is never unlinked mid-save.
		if strings.HasSuffix(de.Name(), ".tmp") {
			if info, ierr := de.Info(); ierr == nil && time.Since(info.ModTime()) > 5*time.Minute {
				os.Remove(filepath.Join(s.dir, de.Name()))
			}
			continue
		}
		if !strings.HasSuffix(de.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(s.dir, de.Name()))
		if err != nil {
			continue
		}
		var e Entry
		if json.Unmarshal(data, &e) != nil {
			continue // foreign or corrupt file: ignore
		}
		if e.ID == "" {
			continue
		}
		if e.Eols == nil {
			e.Eols = []string{}
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SavedAt < out[j].SavedAt })
	return out, nil
}

// Clear removes snapshots for the given tab ids (missing files are fine).
func (s *Store) Clear(ids ...string) error {
	for _, id := range ids {
		path, err := s.fileFor(id)
		if err != nil {
			continue
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// ClearAll empties the recovery folder.
func (s *Store) ClearAll() error {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, de := range entries {
		if !de.IsDir() {
			if err := os.Remove(filepath.Join(s.dir, de.Name())); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}
