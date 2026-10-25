// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package fileio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTemp is the shared helper for byte-level round-trip tests.
func writeTemp(t *testing.T, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "doc.txt")
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// TestLoadRoundTripBytes proves the central file-integrity claim: for every
// supported encoding and line-ending shape, loading and saving without edits
// reproduces the original bytes exactly.
func TestLoadRoundTripBytes(t *testing.T) {
	bodies := map[string]string{
		"lf":            "alpha\nbeta gamma\n",
		"lf-no-final":   "alpha\nbeta",
		"crlf":          "alpha\r\nbeta\r\n",
		"crlf-no-final": "alpha\r\nbeta",
		"cr":            "alpha\rbeta\r",
		"mixed":         "alpha\r\nbeta\ngamma\rdelta",
		"single":        "single line no newline",
		"empty":         "",
		"trailing-ws":   "keep   \nmy\ttabs\t\nand spaces   ",
		"unicode":       "héllo wörld — 日本語テキスト 🎉\nemoji 👍 line\n",
	}
	encodings := map[string]func(string) []byte{
		EncUTF8:    func(s string) []byte { return []byte(s) },
		EncUTF8BOM: func(s string) []byte { return append([]byte{0xEF, 0xBB, 0xBF}, s...) },
		EncUTF16LE: func(s string) []byte { return EncodeUTF16(s, false) },
		EncUTF16BE: func(s string) []byte { return EncodeUTF16(s, true) },
	}
	for encName, encode := range encodings {
		for bodyName, body := range bodies {
			t.Run(encName+"/"+bodyName, func(t *testing.T) {
				original := encode(body)
				p := writeTemp(t, original)
				res, issue := Load(p)
				if issue != nil {
					t.Fatalf("Load issue: %+v", issue)
				}
				if res.Encoding != encName {
					t.Fatalf("encoding = %q, want %q", res.Encoding, encName)
				}
				// Encode back exactly as a save would.
				saved, err := BuildBytes(res.Content, res.Encoding, res.Eols)
				if err != nil {
					t.Fatalf("BuildBytes: %v", err)
				}
				if string(saved) != string(original) {
					t.Fatalf("round-trip mismatch:\n got %q\nwant %q", saved, original)
				}
			})
		}
	}
}

func TestLoadReportsEolFacts(t *testing.T) {
	cases := []struct {
		body    string
		summary string
		deflt   string
		content string
	}{
		{"a\nb\n", "lf", "\n", "a\nb\n"},
		{"a\r\nb\r\n", "crlf", "\r\n", "a\nb\n"},
		{"a\r\nb\nc", "mixed", "\r\n", "a\nb\nc"},
		{"solo", "none", "\n", "solo"},
	}
	for _, tc := range cases {
		res, issue := Load(writeTemp(t, []byte(tc.body)))
		if issue != nil {
			t.Fatalf("issue: %+v", issue)
		}
		if res.EolSummary != tc.summary {
			t.Errorf("summary = %q, want %q", res.EolSummary, tc.summary)
		}
		if res.DefaultEol != tc.deflt {
			t.Errorf("default = %q, want %q", res.DefaultEol, tc.deflt)
		}
		if res.Content != tc.content {
			t.Errorf("content = %q, want %q", res.Content, tc.content)
		}
	}
}

func TestLoadBinaryRefused(t *testing.T) {
	// A PNG header followed by content: NULs must trigger refusal.
	data := append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00}, []byte("more binary")...)
	_, issue := Load(writeTemp(t, data))
	if issue == nil || issue.Reason != "binary" {
		t.Fatalf("issue = %+v, want binary", issue)
	}
	if !strings.Contains(issue.Detail, "offset 8") {
		t.Errorf("detail should point at the NUL offset: %q", issue.Detail)
	}
	if issue.CanReadOnly {
		t.Error("binary files must not offer a read-only text view")
	}
}

func TestLoadUTF16NoBOMHintedAsBinary(t *testing.T) {
	// UTF-16LE text without a BOM: "Hi" as 48 00 69 00.
	data := []byte{'H', 0, 'i', 0, '!', 0}
	_, issue := Load(writeTemp(t, data))
	if issue == nil || issue.Reason != "binary" {
		t.Fatalf("issue = %+v, want binary", issue)
	}
	if !strings.Contains(issue.Detail, "UTF-16") {
		t.Errorf("detail should hint at BOM-less UTF-16: %q", issue.Detail)
	}
}

func TestLoadUnsupportedEncoding(t *testing.T) {
	// Latin-1: 0xE9 (é in Windows-1252/Latin-1) is invalid UTF-8.
	data := []byte("caf\xe9 menu")
	_, issue := Load(writeTemp(t, data))
	if issue == nil || issue.Reason != "unsupported-encoding" {
		t.Fatalf("issue = %+v, want unsupported-encoding", issue)
	}
	if !issue.CanReadOnly {
		t.Error("non-UTF8 text should offer a read-only fallback")
	}
	if issue.HexPreview == "" {
		t.Error("hex preview should be attached")
	}
}

func TestLoadReadOnlyFallback(t *testing.T) {
	data := []byte("caf\xe9 menu\nsecond line\n")
	res, issue := LoadReadOnly(writeTemp(t, data))
	if issue != nil {
		t.Fatalf("issue: %+v", issue)
	}
	if !res.ReadOnly {
		t.Error("result must be read-only")
	}
	if !strings.Contains(res.Content, "\uFFFD menu") {
		t.Errorf("replacement char expected, got %q", res.Content)
	}
	if len(res.Warnings) == 0 {
		t.Error("a read-only open must carry an explanation")
	}
}

func TestLoadUTF16UnpairedSurrogateIsReadOnly(t *testing.T) {
	// BOM + high surrogate with no low surrogate.
	data := []byte{0xFF, 0xFE, 0x00, 0xD8, 0x41, 0x00} // U+D800 alone, then 'A'
	res, issue := Load(writeTemp(t, data))
	if issue != nil {
		t.Fatalf("issue: %+v", issue)
	}
	if !res.ReadOnly {
		t.Error("lossy UTF-16 must be read-only so it can never be saved back")
	}
	if res.Content != "\uFFFDA" {
		t.Errorf("content = %q, want replacement+A", res.Content)
	}
}

func TestLoadTooLarge(t *testing.T) {
	old := MaxFileSize
	MaxFileSize = 16
	t.Cleanup(func() { MaxFileSize = old })
	_, issue := Load(writeTemp(t, []byte("0123456789ABCDEF more")))
	if issue == nil || issue.Reason != "too-large" {
		t.Fatalf("issue = %+v, want too-large", issue)
	}
}

func TestLoadMissingAndDirectory(t *testing.T) {
	_, issue := Load(filepath.Join(t.TempDir(), "nope.txt"))
	if issue == nil || issue.Reason != "not-found" {
		t.Fatalf("issue = %+v, want not-found", issue)
	}
	_, issue = Load(t.TempDir())
	if issue == nil || issue.Reason != "directory" {
		t.Fatalf("issue = %+v, want directory", issue)
	}
}

func TestLoadUTF8BOMInvalidAfterBOM(t *testing.T) {
	data := append([]byte{0xEF, 0xBB, 0xBF}, []byte("ok text \xe9 boom")...)
	_, issue := Load(writeTemp(t, data))
	if issue == nil || issue.Reason != "unsupported-encoding" {
		t.Fatalf("issue = %+v, want unsupported-encoding", issue)
	}
}

func TestNoMetadataEver(t *testing.T) {
	// Saving must never add BOMs, headers, trailers, or any branding to files
	// that had none — regardless of encoding or content shape.
	originals := [][]byte{
		[]byte("#!/bin/sh\necho hi\n"),
		[]byte("---\ntitle: user front matter\n---\n\nbody\n"),
		[]byte("<!-- user comment -->\ntext\n"),
		[]byte("no final newline"),
		[]byte("   \n\t\n"),
	}
	for _, original := range originals {
		p := writeTemp(t, original)
		res, issue := Load(p)
		if issue != nil {
			t.Fatalf("load: %+v", issue)
		}
		built, err := BuildBytes(res.Content, res.Encoding, res.Eols)
		if err != nil {
			t.Fatal(err)
		}
		if string(built) != string(original) {
			t.Fatalf("bytes altered:\n got %q\nwant %q", built, original)
		}
	}
}
