// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Package settings persists user preferences in the operating system's
// application-data location. Nothing is ever written next to documents.
package settings

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Settings is the entire persisted application state.
//
// Defaults are chosen for safety: auto-save is OFF on a fresh installation,
// and editing with auto-save disabled never writes to the original file until
// the user explicitly saves.
type Settings struct {
	Theme           string `json:"theme"`           // system | light | dark
	AutoSaveEnabled bool   `json:"autoSaveEnabled"` // default false
	AutoSaveDelayMs int    `json:"autoSaveDelayMs"` // idle delay before named dirty tabs save
	WordWrap        bool   `json:"wordWrap"`        // soft-wrap long lines
	TabSize         int    `json:"tabSize"`         // width of a tab stop
	InsertSpaces    bool   `json:"insertSpaces"`    // Tab key inserts spaces
	ShowLineNumbers bool   `json:"showLineNumbers"` // gutter line numbers
	HighlightActiveLine bool `json:"highlightActiveLine"`
	EditorFontSize  int    `json:"editorFontSize"`  // px, 0 = default
	// RestoreSession reopens the last session's documents on launch. The
	// session store holds paths only and lives in this app-data folder.
	RestoreSession bool `json:"restoreSession"`
	// CrashRecoveryEnabled controls whether unsaved buffers are periodically
	// copied to the app-data recovery folder. OFF by default: snapshots are
	// plaintext copies of document content at rest, and a privacy-first
	// editor does not create them unless the user asks. Turning it off
	// erases any snapshots already stored.
	CrashRecoveryEnabled bool `json:"crashRecoveryEnabled"`
	// BlockRemoteResources stops the Markdown preview from loading anything
	// over the network (images, fonts, styles). The editor is local-first;
	// this is on by default and the only privacy switch of its kind.
	BlockRemoteResources bool `json:"blockRemoteResources"`
}

// Defaults returns the fresh-install settings.
func Defaults() Settings {
	return Settings{
		Theme:                "system",
		AutoSaveEnabled:      false,
		AutoSaveDelayMs:      2000,
		WordWrap:             true,
		TabSize:              4,
		InsertSpaces:         true,
		ShowLineNumbers:      true,
		HighlightActiveLine:  true,
		EditorFontSize:       0,
		RestoreSession:       true,
		CrashRecoveryEnabled: false,
		BlockRemoteResources: true,
	}
}

// Dir returns <OS app-data>/xtracsys-editor, creating it if needed.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "xtracsys-editor")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// Path returns the settings file location.
func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

// Load reads settings, returning defaults for a fresh installation. A corrupt
// or unreadable file yields defaults (which disable auto-save) plus the error;
// the user's explicit choice persists across launches whenever the file is
// readable.
func Load() (Settings, error) {
	s := Defaults()
	p, err := Path()
	if err != nil {
		return s, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return s, nil // fresh installation
		}
		return s, err
	}
	var loaded Settings
	if err := json.Unmarshal(data, &loaded); err != nil {
		return s, err
	}
	loaded = normalize(loaded)
	return loaded, nil
}

// Save validates and persists settings.
func Save(s Settings) error {
	s = normalize(s)
	p, err := Path()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(p, data, 0o600)
}

// normalize clamps values into valid ranges and fills missing fields with
// defaults so older files stay forward-compatible.
func normalize(s Settings) Settings {
	d := Defaults()
	switch s.Theme {
	case "light", "dark", "system":
	default:
		s.Theme = d.Theme
	}
	if s.AutoSaveDelayMs < 250 {
		s.AutoSaveDelayMs = 250
	}
	if s.AutoSaveDelayMs > 60000 {
		s.AutoSaveDelayMs = 60000
	}
	if s.TabSize < 1 {
		s.TabSize = 1
	}
	if s.TabSize > 8 {
		s.TabSize = 8
	}
	if s.EditorFontSize != 0 && (s.EditorFontSize < 10 || s.EditorFontSize > 28) {
		s.EditorFontSize = 0
	}
	return s
}
