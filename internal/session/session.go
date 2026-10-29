// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Package session persists the last session's open documents and the recent
// files list in the operating system's application-data location. It stores
// PATHS only — never document content (unsaved work belongs to the recovery
// store) — and is disclosed in Settings.
package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const maxRecent = 10

type Data struct {
	Recent      []string `json:"recent"`
	LastSession []string `json:"lastSession"`
}

type Store struct {
	mu   sync.Mutex
	file string
}

func New(base string) (*Store, error) {
	if err := os.MkdirAll(base, 0o700); err != nil {
		return nil, err
	}
	return &Store{file: filepath.Join(base, "session.json")}, nil
}

func (s *Store) load() Data {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) loadLocked() Data {
	var d Data
	if data, err := os.ReadFile(s.file); err == nil {
		_ = json.Unmarshal(data, &d)
	}
	if d.Recent == nil {
		d.Recent = []string{}
	}
	if d.LastSession == nil {
		d.LastSession = []string{}
	}
	return d
}

func (s *Store) save(d Data) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(d)
}

func (s *Store) saveLocked(d Data) error {
	data, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.file + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.file)
}

// SaveLastSession overwrites the recorded session with the given paths
// (order preserved). An empty list is a valid result (fresh start).
func (s *Store) SaveLastSession(paths []string) error {
	d := s.load()
	if paths == nil {
		paths = []string{}
	}
	d.LastSession = paths
	return s.save(d)
}

// LoadLastSession returns the recorded session, dropping paths that no
// longer exist so a deleted file never errors at every launch.
func (s *Store) LoadLastSession() []string {
	d := s.load()
	out := make([]string, 0, len(d.LastSession))
	for _, p := range d.LastSession {
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	if len(out) > maxRecent {
		out = out[:maxRecent]
	}
	return out
}

// AddRecent moves path to the front of the recent list (deduplicated,
// capped at maxRecent). The whole load-modify-save cycle holds the lock so
// concurrent callers cannot lose entries.
func (s *Store) AddRecent(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.loadLocked()
	out := []string{path}
	for _, p := range d.Recent {
		if p != path && len(out) < maxRecent {
			out = append(out, p)
		}
	}
	d.Recent = out
	return s.saveLocked(d)
}

// LoadRecent returns the recent list, most recent first, capped. Missing
// files are kept (menus gray out naturally) — the caller decides
// presentation.
func (s *Store) LoadRecent() []string {
	d := s.load()
	if len(d.Recent) > maxRecent {
		d.Recent = d.Recent[:maxRecent]
	}
	return d.Recent
}

// ClearRecent empties the recent list.
func (s *Store) ClearRecent() error {
	d := s.load()
	d.Recent = []string{}
	return s.save(d)
}
