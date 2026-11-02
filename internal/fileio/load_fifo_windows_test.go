// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

//go:build windows

package fileio

import "testing"

func createTestFIFO(t *testing.T, _ string) {
	t.Skip("FIFOs are unavailable on Windows")
}
