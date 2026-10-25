// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package localimg

import (
	httptest "net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// tinyPNG is a minimal valid 1x1 PNG.
var tinyPNG = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // signature
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89,
	0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, // IDAT
	0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
	0x0D, 0x0A, 0x2D, 0xB4,
	0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
}

func setup(t *testing.T) (*Handler, string) {
	t.Helper()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	os.WriteFile(filepath.Join(dir, "assets", "pic.png"), tinyPNG, 0o644)
	os.WriteFile(filepath.Join(dir, "plain.txt"), []byte("not an image"), 0o644)
	os.WriteFile(filepath.Join(dir, "vector.svg"), []byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), 0o644)
	doc := filepath.Join(dir, "doc.md")
	os.WriteFile(doc, []byte("# doc\n"), 0o644)
	tabs := map[string]string{"tab1": doc, "tab-untitled": ""}
	h := &Handler{ResolveTab: func(id string) (string, bool) {
		p, ok := tabs[id]
		return p, ok
	}}
	return h, dir
}

func get(h *Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestServesImageWithinDocTree(t *testing.T) {
	h, _ := setup(t)
	rec := get(h, "/ximg/tab1/assets/pic.png")
	if rec.Code != 200 {
		t.Fatalf("code = %d body=%q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("content type = %q", ct)
	}
	if rec.Body.Len() != len(tinyPNG) {
		t.Errorf("body length = %d", rec.Body.Len())
	}
}

func TestBlocksTraversalOutsideDocFolder(t *testing.T) {
	h, dir := setup(t)
	// Sneak a real file outside the doc dir and try to reach it.
	outside := filepath.Join(filepath.Dir(dir), "secret.png")
	os.WriteFile(outside, tinyPNG, 0o644)
	t.Cleanup(func() { os.Remove(outside) })
	rec := get(h, "/ximg/tab1/../../../../"+filepath.Base(dir)+"../../../etc/passwd")
	if rec.Code != 404 {
		t.Fatalf("traversal attempt code = %d, want indistinguishable 404", rec.Code)
	}
}

func TestSymlinkEscapeBlocked(t *testing.T) {
	other := t.TempDir()
	secret := filepath.Join(other, "secret.png")
	os.WriteFile(secret, tinyPNG, 0o644)
	h, dir := setup(t)
	os.Symlink(secret, filepath.Join(dir, "assets", "escape.png"))
	rec := get(h, "/ximg/tab1/assets/escape.png")
	if rec.Code != 404 {
		t.Fatalf("symlink escape code = %d body=%q", rec.Code, rec.Body.String())
	}
	// The escape response must be indistinguishable from a plain not-found,
	// so the handler cannot be used as an existence oracle.
	rec2 := get(h, "/ximg/tab1/assets/definitely-missing.png")
	if rec.Code != rec2.Code || rec.Body.String() != rec2.Body.String() {
		t.Fatal("escape and not-found responses must be indistinguishable")
	}
}

func TestRejectsNonImageAndSVG(t *testing.T) {
	h, _ := setup(t)
	rec := get(h, "/ximg/tab1/plain.txt")
	if rec.Code != 415 {
		t.Fatalf("text file code = %d", rec.Code)
	}
	rec = get(h, "/ximg/tab1/vector.svg")
	if rec.Code != 415 {
		t.Fatalf("svg code = %d", rec.Code)
	}
}

func TestUnknownTabAndUntitled(t *testing.T) {
	h, _ := setup(t)
	if rec := get(h, "/ximg/nosuch/img.png"); rec.Code != 404 {
		t.Errorf("unknown tab code = %d", rec.Code)
	}
	if rec := get(h, "/ximg/tab-untitled/img.png"); rec.Code != 404 {
		t.Errorf("untitled tab code = %d", rec.Code)
	}
}

func TestMethodAndShape(t *testing.T) {
	h, _ := setup(t)
	req := httptest.NewRequest("POST", "/ximg/tab1/assets/pic.png", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 405 {
		t.Errorf("POST code = %d", rec.Code)
	}
	if rec := get(h, "/ximg/tab1"); rec.Code != 400 {
		t.Errorf("no rel path code = %d", rec.Code)
	}
	if rec := get(h, "/ximg/tab1/missing.png"); rec.Code != 404 {
		t.Errorf("missing code = %d", rec.Code)
	}
}
