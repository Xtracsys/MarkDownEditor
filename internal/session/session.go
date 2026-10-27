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
)

const maxRecent = 10

type Data struct {
	Recent      []string `json:"recent"`
	LastSession []string `json:"lastSession"`
}

type Store struct {
	file string
}

func New(base string) (*Store, error) {
	if err := os.MkdirAll(base, 0o700); err != nil {
		return nil, err
	}
	return &Store{file: filepath.Join(base, "session.json")}, nil
}

func (s *Store) load() Data {
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
	return out
}

// AddRecent moves path to the front of the recent list (deduplicated,
// capped at maxRecent).
func (s *Store) AddRecent(path string) error {
	d := s.load()
	out := []string{path}
	for _, p := range d.Recent {
		if p != path && len(out) < maxRecent {
			out = append(out, p)
		}
	}
	d.Recent = out
	return s.save(d)
}

// LoadRecent returns the recent list, most recent first. Missing files are
// kept (menus gray out naturally) — the caller decides presentation.
func (s *Store) LoadRecent() []string {
	return s.load().Recent
}

// ClearRecent empties the recent list.
func (s *Store) ClearRecent() error {
	d := s.load()
	d.Recent = []string{}
	return s.save(d)
}
