// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Package fileio implements byte-faithful loading and saving of text files.
//
// The package's core invariant: a file's bytes change only in response to user
// edits, and only when the user saves. Encoding, byte-order marks, line-ending
// style (including per-line mixed endings), trailing whitespace, and the
// presence or absence of a final newline are all preserved exactly.
package fileio

import (
	"errors"
	"fmt"
	"strings"
)

// Line terminator values recorded per line. The terminator of the final line
// is "" when the file does not end with a newline.
const (
	LF   = "\n"
	CRLF = "\r\n"
	CR   = "\r"
)

// ErrCarriageReturn is returned when save content contains a bare carriage
// return. The editor buffer is expected to be LF-normalized; a stray CR would
// silently change meaning on the next load, so it is surfaced as an error.
var ErrCarriageReturn = errors.New("content contains a bare carriage return; the editor buffer should be LF-normalized")

// ParseEols splits text into lines and their original line terminators.
// eols[i] is the terminator that followed lines[i] in the original text; the
// final entry is "" when the text does not end with a newline. Lines never
// contain CR or LF themselves.
func ParseEols(text string) (lines []string, eols []string) {
	n := strings.Count(text, "\n") + strings.Count(text, "\r") + 1
	lines = make([]string, 0, n)
	eols = make([]string, 0, n)
	start := 0
	i := 0
	for i < len(text) {
		switch text[i] {
		case '\r':
			lines = append(lines, text[start:i])
			if i+1 < len(text) && text[i+1] == '\n' {
				eols = append(eols, CRLF)
				i += 2
			} else {
				eols = append(eols, CR)
				i++
			}
			start = i
		case '\n':
			lines = append(lines, text[start:i])
			eols = append(eols, LF)
			i++
			start = i
		default:
			i++
		}
	}
	lines = append(lines, text[start:])
	eols = append(eols, "")
	return lines, eols
}

// ToLF returns text with every line terminator replaced by a bare LF.
func ToLF(text string) string {
	if !strings.ContainsRune(text, '\r') {
		return text
	}
	lines, eols := ParseEols(text)
	var b strings.Builder
	b.Grow(len(text))
	for i, ln := range lines {
		b.WriteString(ln)
		if eols[i] != "" {
			b.WriteByte('\n')
		}
	}
	return b.String()
}

// EolSummary classifies a file's line-ending style for display.
type EolSummary string

const (
	SummaryLF    EolSummary = "lf"
	SummaryCRLF  EolSummary = "crlf"
	SummaryCR    EolSummary = "cr"
	SummaryMixed EolSummary = "mixed"
	SummaryNone  EolSummary = "none" // single line, no terminator
)

// EolInfo returns the predominant terminator (used for newly added lines) and
// a display summary. Mixed files keep their exact per-line terminators; the
// predominant style only applies to lines the user creates. Ties break toward
// the terminator that appears earliest in the file, so behavior is
// deterministic regardless of map iteration order.
func EolInfo(eols []string) (predominant string, summary EolSummary) {
	counts := map[string]int{}
	firstIndex := map[string]int{}
	for i, e := range eols {
		if e != "" {
			if _, seen := firstIndex[e]; !seen {
				firstIndex[e] = i
			}
			counts[e]++
		}
	}
	switch len(counts) {
	case 0:
		return LF, SummaryNone
	case 1:
		for k := range counts {
			predominant = k
		}
	default:
		bestFirst := 1 << 30
		for k, n := range counts {
			f := firstIndex[k]
			if n > counts[predominant] || (n == counts[predominant] && f < bestFirst) {
				predominant = k
				bestFirst = f
			}
		}
	}
	switch {
	case len(counts) == 1 && predominant == LF:
		return predominant, SummaryLF
	case len(counts) == 1 && predominant == CRLF:
		return predominant, SummaryCRLF
	case len(counts) == 1 && predominant == CR:
		return predominant, SummaryCR
	}
	return predominant, SummaryMixed
}

// validEol reports whether s is one of the recorded terminator values.
func validEol(s string) bool {
	switch s {
	case LF, CRLF, CR, "":
		return true
	}
	return false
}

// Rebuild joins an LF-normalized buffer back with per-line terminators,
// reproducing the file's original line-ending structure. len(eols) must equal
// the number of lines in content.
func Rebuild(content string, eols []string) (string, error) {
	if strings.ContainsRune(content, '\r') {
		return "", ErrCarriageReturn
	}
	lines := strings.Split(content, LF)
	if len(lines) != len(eols) {
		return "", fmt.Errorf("line/terminator mismatch: %d lines but %d terminators", len(lines), len(eols))
	}
	size := len(content)
	for _, e := range eols {
		size += len(e)
	}
	var b strings.Builder
	b.Grow(size)
	for i, ln := range lines {
		if !validEol(eols[i]) {
			return "", fmt.Errorf("invalid line terminator %q at index %d", eols[i], i)
		}
		b.WriteString(ln)
		b.WriteString(eols[i])
	}
	return b.String(), nil
}

// CountLines returns the number of LF-separated lines in content.
func CountLines(content string) int {
	return strings.Count(content, LF) + 1
}
