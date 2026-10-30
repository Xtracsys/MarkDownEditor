// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package fileio

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"
)

// MaxFileSize caps what the editor will open. Package-level (not const) so
// tests can exercise the refusal path without allocating gigabytes.
var MaxFileSize int64 = 32 << 20 // 32 MiB

// MaxLines guards against memory amplification: a file of only newlines
// would otherwise allocate two string-slice entries per line.
const MaxLines = 2_000_000

// Binary sniff window: NUL bytes anywhere make a file binary; the window only
// shapes the error message.
const sniffWindow = 8192

// LoadResult describes a decoded document plus everything needed to save it
// back byte-faithfully.
type LoadResult struct {
	Path        string   `json:"path"`
	Content     string   `json:"content"` // LF-normalized text for the editor buffer
	Encoding    string   `json:"encoding"`
	Eols        []string `json:"eols"`       // per-line terminators, aligned with Content lines
	DefaultEol  string   `json:"defaultEol"` // terminator for newly added lines
	EolSummary  string   `json:"eolSummary"` // lf | crlf | cr | mixed | none
	ReadOnly    bool     `json:"readOnly"`   // true when decoded lossily; saving in place is blocked
	Warnings    []string `json:"warnings"`
	Hash        string   `json:"hash"`        // SHA-256 of the raw on-disk bytes
	Size        int64    `json:"size"`        // raw size in bytes
	ModTimeNanos int64   `json:"modTimeNanos"`
}

// Issue describes why a file could not be opened normally. Reasons are
// machine-readable for the frontend; Message is user-facing English.
type Issue struct {
	Reason      string `json:"reason"` // binary | unsupported-encoding | too-large | not-found | directory | permission | io
	Message     string `json:"message"`
	Detail      string `json:"detail,omitempty"`
	HexPreview  string `json:"hexPreview,omitempty"`
	CanReadOnly bool   `json:"canReadOnly"` // offer an explicit read-only fallback
}

// Load reads and decodes a text file. It returns an Issue (never a partial
// result) for binary data, unsupported encodings, oversized files, and OS
// errors. A nil Issue means the file round-trips safely.
func Load(path string) (*LoadResult, *Issue) {
	fi, err := os.Stat(path)
	if err != nil {
		return nil, statIssue("open", path, err)
	}
	if fi.IsDir() {
		return nil, &Issue{Reason: "directory", Message: "That path is a folder, not a file."}
	}
	if !fi.Mode().IsRegular() {
		return nil, &Issue{Reason: "not-regular", Message: "That path is not a regular file (device, socket, or pipe) and is not opened."}
	}
	if fi.Size() > MaxFileSize {
		return nil, &Issue{
			Reason:  "too-large",
			Message: fmt.Sprintf("The file is %s, larger than this editor's %s limit.", humanBytes(fi.Size()), humanBytes(MaxFileSize)),
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, statIssue("read", path, err)
	}

	var (
		text     string
		encoding string
		lossy    bool
	)
	switch {
	case bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}):
		rest := data[3:]
		if off := firstInvalidUTF8(rest); off >= 0 {
			return nil, unsupportedEncoding(path, rest, off, "The file starts with a UTF-8 byte-order mark but contains invalid UTF-8 after it.")
		}
		text, encoding = string(rest), EncUTF8BOM
	case bytes.HasPrefix(data, []byte{0xFF, 0xFE}):
		text, lossy = DecodeUTF16(data[2:], false)
		encoding = EncUTF16LE
	case bytes.HasPrefix(data, []byte{0xFE, 0xFF}):
		text, lossy = DecodeUTF16(data[2:], true)
		encoding = EncUTF16BE
	default:
		if idx := bytes.IndexByte(data, 0); idx >= 0 {
			detail := fmt.Sprintf("It contains a NUL byte at offset %d. Files with NUL bytes are treated as binary and are not opened for editing.", idx)
			if looksLikeUTF16NoBOM(data) {
				detail += " The layout suggests UTF-16 text without a byte-order mark; re-save the file as UTF-8 or UTF-16 with a BOM to edit it here."
			}
			return nil, &Issue{
				Reason:     "binary",
				Message:    "This file appears to be binary.",
				Detail:     detail,
				HexPreview: hexPreview(data, idx),
			}
		}
		if off := firstInvalidUTF8(data); off >= 0 {
			return nil, unsupportedEncoding(path, data, off, "The file is not valid UTF-8 and carries no byte-order mark.")
		}
		text, encoding = string(data), EncUTF8
	}

	if strings.Count(text, "\n")+strings.Count(text, "\r") > MaxLines {
		return nil, &Issue{
			Reason:  "too-many-lines",
			Message: fmt.Sprintf("The file has more than %s lines, above this editor's limit.", humanCount(MaxLines)),
		}
	}
	lines, eols := ParseEols(text)
	pred, summary := EolInfo(eols)
	res := &LoadResult{
		Path:        path,
		Content:     ToLF(text),
		Encoding:    encoding,
		Eols:        eols,
		DefaultEol:  pred,
		EolSummary:  string(summary),
		Warnings:    []string{},
		Hash:        hashBytes(data),
		Size:        fi.Size(),
		ModTimeNanos: fi.ModTime().UnixNano(),
	}
	if lossy {
		res.ReadOnly = true
		res.Warnings = append(res.Warnings,
			"The file is UTF-16 but contains unpaired surrogates (its bytes are not valid UTF-16 text). "+
				"It has been opened read-only with replacement characters so it cannot be saved back incorrectly. "+
				"Use Save As to export a clean UTF-8 copy if needed.")
	}
	_ = lines
	return res, nil
}

// LoadReadOnly opens any text-ish file for viewing only: invalid UTF-8 is
// replaced with U+FFFD. Binary files (NUL bytes) are still refused, since a
// lossy view of binary data is noise, not information. The result is always
// marked ReadOnly; it can never be saved in place.
func LoadReadOnly(path string) (*LoadResult, *Issue) {
	fi, err := os.Stat(path)
	if err != nil {
		return nil, statIssue("open", path, err)
	}
	if fi.IsDir() {
		return nil, &Issue{Reason: "directory", Message: "That path is a folder, not a file."}
	}
	if !fi.Mode().IsRegular() {
		return nil, &Issue{Reason: "not-regular", Message: "That path is not a regular file (device, socket, or pipe) and is not opened."}
	}
	if fi.Size() > MaxFileSize {
		return nil, &Issue{Reason: "too-large", Message: fmt.Sprintf("The file is %s, larger than this editor's %s limit.", humanBytes(fi.Size()), humanBytes(MaxFileSize))}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, statIssue("read", path, err)
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return nil, &Issue{Reason: "binary", Message: "This file is binary and cannot be displayed as text."}
	}
	text := LossyUTF8(data)
	if strings.Count(text, "\n")+strings.Count(text, "\r") > MaxLines {
		return nil, &Issue{Reason: "too-many-lines", Message: "This file has too many lines to open safely."}
	}
	_, eols := ParseEols(text)
	pred, summary := EolInfo(eols)
	return &LoadResult{
		Path:        path,
		Content:     ToLF(text),
		Encoding:    EncUTF8,
		Eols:        eols,
		DefaultEol:  pred,
		EolSummary:  string(summary),
		ReadOnly:    true,
		Warnings: []string{
			"Opened read-only: the file is not valid UTF-8, so bytes that could not be decoded are shown as replacement characters (�). " +
				"Saving in place is disabled to protect the original bytes. Use Save As to export a UTF-8 copy.",
		},
		Hash:         hashBytes(data),
		Size:         fi.Size(),
		ModTimeNanos: fi.ModTime().UnixNano(),
	}, nil
}

// looksLikeUTF16NoBOM reports whether NUL bytes alternate at a fixed parity,
// which is the classic signature of BOM-less UTF-16 misread as 8-bit text.
func looksLikeUTF16NoBOM(data []byte) bool {
	window := data
	if len(window) > sniffWindow {
		window = window[:sniffWindow]
	}
	if len(window) < 4 {
		return false
	}
	even, odd := 0, 0
	for i, b := range window {
		if b == 0 {
			if i%2 == 0 {
				even++
			} else {
				odd++
			}
		}
	}
	zeros := even + odd
	parityAligned := even == 0 || odd == 0
	return zeros >= 2 && zeros > len(window)/8 && parityAligned
}

func unsupportedEncoding(path string, data []byte, offset int, why string) *Issue {
	return &Issue{
		Reason:      "unsupported-encoding",
		Message:     why,
		Detail:      fmt.Sprintf("First invalid byte at offset %d. Supported encodings: UTF-8 (with or without BOM) and UTF-16 LE/BE with BOM.", offset),
		HexPreview:  hexPreview(data, offset),
		CanReadOnly: true,
	}
}

func statIssue(verb, path string, err error) *Issue {
	switch {
	case os.IsNotExist(err):
		return &Issue{Reason: "not-found", Message: "The file does not exist: " + path}
	case os.IsPermission(err):
		return &Issue{Reason: "permission", Message: "Permission denied when trying to " + verb + " the file: " + path}
	default:
		return &Issue{Reason: "io", Message: "Could not " + verb + " " + path + ": " + err.Error()}
	}
}

// hexPreview renders up to 32 bytes around the offending offset.
func hexPreview(data []byte, offset int) string {
	start := offset - 8
	if start < 0 {
		start = 0
	}
	end := start + 32
	if end > len(data) {
		end = len(data)
	}
	const hexDigits = "0123456789abcdef"
	var sb bytes.Buffer
	for i, b := range data[start:end] {
		if i > 0 {
			sb.WriteByte(' ')
		}
		sb.WriteByte(hexDigits[b>>4])
		sb.WriteByte(hexDigits[b&0xF])
	}
	return sb.String()
}

func hashBytes(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func humanCount(n int64) string {
	if n >= 1_000_000 {
		return fmt.Sprintf("%d million", n/1_000_000)
	}
	return fmt.Sprintf("%d", n)
}

func humanBytes(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%d bytes", n)
	}
}

// ValidEncoding reports whether enc is a saveable encoding name.
func ValidEncoding(enc string) bool {
	switch enc {
	case EncUTF8, EncUTF8BOM, EncUTF16LE, EncUTF16BE:
		return true
	}
	return false
}

var _ = utf8.Valid // keep import if unused paths change
