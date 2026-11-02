// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

//go:build darwin || linux

package fileio

import (
	"syscall"
	"testing"
)

func createTestFIFO(t *testing.T, path string) {
	t.Helper()
	if err := syscall.Mkfifo(path, 0o600); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}
}
