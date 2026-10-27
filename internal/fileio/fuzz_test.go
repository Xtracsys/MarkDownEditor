// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package fileio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// FuzzParseEols hammers the line-splitting engine with arbitrary bytes.
// Invariant 1: joining lines+terminators reproduces the input exactly.
// Invariant 2: ToLF + Rebuild also reproduces the input exactly.
// Any mismatch means a silent line-ending corruption path exists.
func FuzzParseEols(f *testing.F) {
	f.Add("")
	f.Add("a\nb\r\nc\rd")
	f.Add("\n\n\n")
	f.Add("trailing \t spaces \r\nmore")
	f.Add("\r\r\r")
	f.Add("mixed \r\n \n \r end")
	f.Add("no newline")
	f.Add("emoji 🎉 \n unicode ✓\r\n")
	f.Fuzz(func(t *testing.T, data string) {
		lines, eols := ParseEols(data)
		if len(lines) != len(eols) {
			t.Fatalf("lines/eols mismatch: %d vs %d", len(lines), len(eols))
		}
		var joined strings.Builder
		for i := range lines {
			joined.WriteString(lines[i])
			joined.WriteString(eols[i])
		}
		if joined.String() != data {
			t.Fatalf("join round-trip mismatch for %q", data)
		}
		rebuilt, err := Rebuild(ToLF(data), eols)
		if err != nil {
			t.Fatalf("Rebuild rejected its own parse: %v", err)
		}
		if rebuilt != data {
			t.Fatalf("rebuild round-trip mismatch for %q", data)
		}
	})
}

// FuzzUTF16RoundTrip: any byte sequence decodes (possibly lossily), and
// re-encoding the result must decode back to the identical text — the UTF-16
// path must never be a corruption amplifier.
func FuzzUTF16RoundTrip(f *testing.F) {
	f.Add([]byte{0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00})
	f.Add([]byte{0x00, 0xD8, 0x00, 0xDC}) // valid surrogate pair (BE-ish)
	f.Add([]byte{0x00, 0xD8})             // lone high surrogate
	f.Add([]byte{0x41})                   // odd trailing byte
	f.Add([]byte{0x00, 0x00, 0xFF, 0xFF})
	f.Fuzz(func(t *testing.T, data []byte) {
		text, _ := DecodeUTF16(data, false)
		enc := EncodeUTF16(text, false)
		back, _ := DecodeUTF16(enc[2:], false) // strip BOM
		if back != text {
			t.Fatalf("utf16 round-trip mismatch: %q -> %q", text, back)
		}
	})
}

// FuzzBuildBytes: whenever encoding succeeds, the produced file must load
// back to the identical LF content. This is the save-path safety net — a
// mismatch would mean saves silently change documents.
func FuzzBuildBytes(f *testing.F) {
	f.Add("a\nb\nc", uint8(0), "\n\x00\n\x00")
	f.Add("a\r\nb", uint8(1), "\r\n\x00")
	f.Add("x", uint8(2), "")
	f.Add("caf\u00e9\n", uint8(3), "\n\x00")
	f.Add("", uint8(0), "")
	f.Fuzz(func(t *testing.T, content string, encSel uint8, eolSpec string) {
		eols := strings.Split(eolSpec, "\x00")
		if strings.ContainsRune(content, '\r') {
			return // invalid editor buffer by contract; BuildBytes rejects it
		}
		if !utf8.ValidString(content) {
			return // editor content always comes from JS strings: valid UTF-8
		}
		encodings := []string{EncUTF8, EncUTF8BOM, EncUTF16LE, EncUTF16BE}
		enc := encodings[int(encSel)%len(encodings)]
		// The terminator array must match the content's line count for a
		// well-formed save; other shapes are rejected by design.
		lines := strings.Count(content, "\n") + 1
		if len(eols) != lines {
			return
		}
		// Only reachable editor states: the final line never carries a
		// terminator, and every earlier line must have one.
		if eols[len(eols)-1] != "" {
			return
		}
		for i := 0; i < len(eols)-1; i++ {
			if eols[i] == "" {
				return
			}
		}
		data, err := BuildBytes(content, enc, eols)
		if err != nil {
			return // rejection is fine; silent corruption is not
		}
		p := filepath.Join(t.TempDir(), "fuzz")
		if err := os.WriteFile(p, data, 0o600); err != nil {
			t.Skip()
		}
		res, issue := Load(p)
		if issue != nil {
			return // e.g. NUL-containing content is refused on load by design
		}
		if res.Content != content {
			t.Fatalf("save/load altered content: %q -> %q", content, res.Content)
		}
	})
}
