// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package settings

import (
	"os"
	"path/filepath"
	"testing"
)

// withTestHome points UserConfigDir at a temp dir for one test.
func withTestHome(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)               // unix
	t.Setenv("APPDATA", filepath.Join(dir, "AppData")) // windows
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(dir, ".config"))
	return dir
}

// TestFreshInstallAutoSaveDisabled is acceptance test #1: a fresh installation
// has auto-save disabled.
func TestFreshInstallAutoSaveDisabled(t *testing.T) {
	withTestHome(t)
	s, err := Load()
	if err != nil {
		t.Fatalf("fresh load: %v", err)
	}
	if s.AutoSaveEnabled {
		t.Fatal("auto-save must be OFF by default on a fresh installation")
	}
	if s.BlockRemoteResources != true {
		t.Error("remote resource blocking must be on by default")
	}
	if s.CrashRecoveryEnabled {
		t.Error("crash recovery must be OFF by default: snapshots are plaintext document content at rest")
	}
	if s.Theme != "system" {
		t.Errorf("default theme = %q, want system", s.Theme)
	}
}

// TestUserChoicePersists is acceptance test #2's foundation: the user's
// explicit auto-save choice persists across launches.
func TestUserChoicePersists(t *testing.T) {
	withTestHome(t)
	s := Defaults()
	s.AutoSaveEnabled = true
	s.AutoSaveDelayMs = 5000
	s.Theme = "dark"
	if err := Save(s); err != nil {
		t.Fatal(err)
	}
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !got.AutoSaveEnabled || got.AutoSaveDelayMs != 5000 || got.Theme != "dark" {
		t.Fatalf("persisted settings lost: %+v", got)
	}

	// Disabling again also persists.
	got.AutoSaveEnabled = false
	if err := Save(got); err != nil {
		t.Fatal(err)
	}
	again, _ := Load()
	if again.AutoSaveEnabled {
		t.Fatal("disabling auto-save must persist")
	}
}

func TestSettingsLiveInAppDataNotProject(t *testing.T) {
	withTestHome(t)
	p, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(filepath.Dir(p)) != "xtracsys-editor" {
		t.Fatalf("settings dir = %q", p)
	}
	cwd, _ := os.Getwd()
	if filepath.Dir(p) == cwd {
		t.Fatal("settings must never be written beside documents")
	}
	if err := Save(Defaults()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("settings file missing: %v", err)
	}
}

func TestCorruptSettingsFallBackToSafeDefaults(t *testing.T) {
	withTestHome(t)
	p, _ := Path()
	os.WriteFile(p, []byte("{not json"), 0o600)
	s, err := Load()
	if err == nil {
		t.Error("corrupt file should report an error")
	}
	if s.AutoSaveEnabled {
		t.Error("corrupt settings must fall back to auto-save disabled")
	}
}

func TestNormalizeClamps(t *testing.T) {
	s := normalize(Settings{Theme: "neon", AutoSaveDelayMs: 1, TabSize: 99, EditorFontSize: 4})
	if s.Theme != "system" || s.AutoSaveDelayMs != 250 || s.TabSize != 8 || s.EditorFontSize != 0 {
		t.Fatalf("clamping failed: %+v", s)
	}
}
