// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package fileio

import (
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Supported encodings. UTF-16 variants always carry a byte-order mark, both on
// load and on save; UTF-8 may carry one ("utf8bom") or not ("utf8").
const (
	EncUTF8     = "utf8"
	EncUTF8BOM  = "utf8bom"
	EncUTF16LE  = "utf16le"
	EncUTF16BE  = "utf16be"
)

// Surrogate range helpers (the stdlib utf16 package only exposes IsSurrogate).
func isHighSurrogate(r rune) bool { return r >= 0xD800 && r <= 0xDBFF }
func isLowSurrogate(r rune) bool  { return r >= 0xDC00 && r <= 0xDFFF }

// EncodingLabel returns a human-friendly encoding name for the status bar.
func EncodingLabel(enc string) string {
	switch enc {
	case EncUTF8:
		return "UTF-8"
	case EncUTF8BOM:
		return "UTF-8 (BOM)"
	case EncUTF16LE:
		return "UTF-16 LE (BOM)"
	case EncUTF16BE:
		return "UTF-16 BE (BOM)"
	}
	return enc
}

// DecodeUTF16 decodes UTF-16 code units (without the BOM) into a string.
// Unpaired surrogates or a trailing odd byte are replaced with U+FFFD and
// reported via lossy=true; the caller must block saving such documents.
func DecodeUTF16(b []byte, bigEndian bool) (text string, lossy bool) {
	var sb strings.Builder
	sb.Grow(len(b) / 2)
	i := 0
	for i+1 < len(b) {
		var u uint16
		if bigEndian {
			u = uint16(b[i])<<8 | uint16(b[i+1])
		} else {
			u = uint16(b[i+1])<<8 | uint16(b[i])
		}
		if utf16.IsSurrogate(rune(u)) {
			// Expect a low surrogate as the next unit to complete the pair.
			if isHighSurrogate(rune(u)) && i+3 < len(b) {
				var u2 uint16
				if bigEndian {
					u2 = uint16(b[i+2])<<8 | uint16(b[i+3])
				} else {
					u2 = uint16(b[i+3])<<8 | uint16(b[i+2])
				}
				if isLowSurrogate(rune(u2)) {
					sb.WriteRune(utf16.DecodeRune(rune(u), rune(u2)))
					i += 4
					continue
				}
			}
			lossy = true
			sb.WriteRune(utf8.RuneError)
			i += 2
			continue
		}
		sb.WriteRune(rune(u))
		i += 2
	}
	if i < len(b) { // trailing odd byte
		lossy = true
		sb.WriteRune(utf8.RuneError)
	}
	return sb.String(), lossy
}

// EncodeUTF16 encodes text as UTF-16 with a byte-order mark.
func EncodeUTF16(s string, bigEndian bool) []byte {
	out := make([]byte, 0, len(s)*2+2)
	unit := func(u uint16) {
		if bigEndian {
			out = append(out, byte(u>>8), byte(u))
		} else {
			out = append(out, byte(u), byte(u>>8))
		}
	}
	if bigEndian {
		out = append(out, 0xFE, 0xFF)
	} else {
		out = append(out, 0xFF, 0xFE)
	}
	for _, r := range s {
		if r <= 0xFFFF && !utf16.IsSurrogate(r) {
			unit(uint16(r))
		} else {
			r1, r2 := utf16.EncodeRune(r)
			unit(uint16(r1))
			unit(uint16(r2))
		}
	}
	return out
}

// firstInvalidUTF8 returns the byte offset of the first invalid UTF-8
// sequence, or -1 when the data is valid UTF-8.
func firstInvalidUTF8(data []byte) int {
	for i := 0; i < len(data); {
		r, size := utf8.DecodeRune(data[i:])
		if r == utf8.RuneError && size <= 1 {
			return i
		}
		i += size
	}
	return -1
}

// LossyUTF8 decodes bytes as UTF-8, substituting U+FFFD for invalid sequences.
// Used only for the explicitly-requested read-only view of files that could
// not be decoded cleanly; such documents can never be saved in place.
func LossyUTF8(data []byte) string {
	var sb strings.Builder
	sb.Grow(len(data))
	for i := 0; i < len(data); {
		r, size := utf8.DecodeRune(data[i:])
		if r == utf8.RuneError && size <= 1 {
			sb.WriteRune(utf8.RuneError)
			i++
			continue
		}
		sb.WriteRune(r)
		i += size
	}
	return sb.String()
}
