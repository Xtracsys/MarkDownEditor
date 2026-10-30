// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Package localimg serves images to the Markdown preview from the open
// document's directory tree — and only from there. It is the preview's only
// channel for local file content: no arbitrary filesystem browsing, no SVG
// (scripts), no huge files, no directory listings.
package localimg

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// MaxImageBytes caps a single preview image.
const MaxImageBytes = 20 << 20 // 20 MiB

// allowedTypes is the content-sniffed allowlist. SVG is intentionally absent:
// SVG can carry scripts and remote references, and belongs out of a sandboxed
// preview by default.
var allowedTypes = map[string]string{
	"image/png":      ".png",
	"image/jpeg":     ".jpg",
	"image/gif":      ".gif",
	"image/webp":     ".webp",
	"image/bmp":      ".bmp",
	"image/x-icon":   ".ico",
}

// Handler resolves /ximg/<tabId>/<relative-path> against the directory of the
// document that tab holds.
type Handler struct {
	// ResolveTab maps an open tab id to its document path ("" means the tab
	// is untitled and may not load local images).
	ResolveTab func(tabID string) (docPath string, ok bool)
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// URL paths always use forward slashes regardless of platform.
	rest := strings.TrimPrefix(r.URL.Path, "/ximg/")
	if rest == "" || rest == r.URL.Path {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	tabID, rel, found := strings.Cut(rest, "/")
	if !found || rel == "" || strings.Contains(rel, "\x00") {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	docPath, ok := h.ResolveTab(tabID)
	if !ok || docPath == "" {
		http.Error(w, "unknown document (open the file to preview its images)", http.StatusNotFound)
		return
	}

	docDir := filepath.Dir(docPath)
	// Resolve symlinks FIRST on both sides so a link inside the doc tree
	// cannot escape it, and a symlinked document directory still works.
	rootReal, err := filepath.EvalSymlinks(docDir)
	if err != nil {
		http.Error(w, "document folder unavailable", http.StatusNotFound)
		return
	}
	joined := filepath.Join(docDir, filepath.FromSlash(rel))
	real, err := filepath.EvalSymlinks(joined)
	if err != nil {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}
	if real != rootReal && !strings.HasPrefix(real, rootReal+string(filepath.Separator)) {
		// Same status and body as not-found: escape attempts must not learn
		// whether the escaped path exists.
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}
	fi, err := os.Stat(real)
	if err != nil || fi.IsDir() || !fi.Mode().IsRegular() {
		http.Error(w, "not an image", http.StatusNotFound)
		return
	}
	if fi.Size() > MaxImageBytes {
		http.Error(w, fmt.Sprintf("image exceeds the %d MB preview limit", MaxImageBytes>>20), http.StatusRequestEntityTooLarge)
		return
	}
	data, err := os.ReadFile(real)
	if err != nil {
		http.Error(w, "image unreadable", http.StatusInternalServerError)
		return
	}
	// Trust content, not extensions.
	ct := http.DetectContentType(data)
	if _, allowed := allowedTypes[ct]; !allowed {
		if strings.HasPrefix(ct, "image/svg") || strings.HasSuffix(strings.ToLower(real), ".svg") {
			http.Error(w, "SVG images are not loaded in previews (they can embed scripts)", http.StatusUnsupportedMediaType)
			return
		}
		http.Error(w, "not a supported image type", http.StatusUnsupportedMediaType)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}
