// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package fileio

import (
	"reflect"
	"testing"
)

func TestParseEols(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		lines []string
		eols  []string
	}{
		{"empty", "", []string{""}, []string{""}},
		{"single no eol", "hello", []string{"hello"}, []string{""}},
		{"lf final", "a\nb\n", []string{"a", "b", ""}, []string{"\n", "\n", ""}},
		{"lf no final", "a\nb", []string{"a", "b"}, []string{"\n", ""}},
		{"crlf final", "a\r\nb\r\n", []string{"a", "b", ""}, []string{"\r\n", "\r\n", ""}},
		{"crlf no final", "a\r\nb", []string{"a", "b"}, []string{"\r\n", ""}},
		{"cr final", "a\rb\r", []string{"a", "b", ""}, []string{"\r", "\r", ""}},
		{"mixed", "a\r\nb\nc\rd", []string{"a", "b", "c", "d"}, []string{"\r\n", "\n", "\r", ""}},
		{"blank lines", "\n\n\n", []string{"", "", "", ""}, []string{"\n", "\n", "\n", ""}},
		{"trailing spaces kept", "a   \nb\t\t\n", []string{"a   ", "b\t\t", ""}, []string{"\n", "\n", ""}},
		{"lone cr between lf", "a\n\rb\n", []string{"a", "", "b", ""}, []string{"\n", "\r", "\n", ""}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lines, eols := ParseEols(tc.in)
			if !reflect.DeepEqual(lines, tc.lines) {
				t.Fatalf("lines = %q, want %q", lines, tc.lines)
			}
			if !reflect.DeepEqual(eols, tc.eols) {
				t.Fatalf("eols = %q, want %q", eols, tc.eols)
			}
			// Round-trip: joining lines+eols must reproduce input exactly.
			var rebuilt string
			for i := range lines {
				rebuilt += lines[i] + eols[i]
			}
			if rebuilt != tc.in {
				t.Fatalf("join = %q, want original %q", rebuilt, tc.in)
			}
		})
	}
}

func TestToLF(t *testing.T) {
	cases := map[string]string{
		"a\nb":        "a\nb",
		"a\r\nb\r\n":  "a\nb\n",
		"a\rb":        "a\nb",
		"a\r\nb\nc":   "a\nb\nc",
		"":            "",
		"\r\n\r\n":    "\n\n",
	}
	for in, want := range cases {
		if got := ToLF(in); got != want {
			t.Errorf("ToLF(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestEolInfo(t *testing.T) {
	cases := []struct {
		eols []string
		pred string
		summ EolSummary
	}{
		{[]string{""}, LF, SummaryNone},
		{[]string{"\n", ""}, LF, SummaryLF},
		{[]string{"\n", "\n", ""}, LF, SummaryLF},
		{[]string{"\r\n", ""}, CRLF, SummaryCRLF},
		{[]string{"\r", "\r", ""}, CR, SummaryCR},
		{[]string{"\r\n", "\n", ""}, CRLF, SummaryMixed},
		{[]string{"\n", "\n", "\r\n", ""}, LF, SummaryMixed},
	}
	for _, tc := range cases {
		pred, summ := EolInfo(tc.eols)
		if pred != tc.pred || summ != tc.summ {
			t.Errorf("EolInfo(%q) = (%q,%q), want (%q,%q)", tc.eols, pred, summ, tc.pred, tc.summ)
		}
	}
}

func TestRebuild(t *testing.T) {
	// Rebuild of unmodified content reproduces every original exactly.
	originals := []string{
		"", "a", "a\n", "a", "a\r\nb\r\n", "a\rb\r", "a\r\nb\nc\rd",
		"line with trailing spaces   \nnext\t\n", "\n\n", "x\r\n\r\ny\n\r\n",
	}
	for _, orig := range originals {
		_, eols := ParseEols(orig)
		lf := ToLF(orig)
		got, err := Rebuild(lf, eols)
		if err != nil {
			t.Fatalf("Rebuild(%q): %v", orig, err)
		}
		if got != orig {
			t.Errorf("Rebuild round-trip = %q, want %q", got, orig)
		}
	}
}

func TestRebuildRejectsBadInput(t *testing.T) {
	if _, err := Rebuild("a\rb", []string{"\n", ""}); err != ErrCarriageReturn {
		t.Errorf("bare CR: err = %v, want ErrCarriageReturn", err)
	}
	if _, err := Rebuild("a\nb", []string{"\n"}); err == nil {
		t.Error("length mismatch should error")
	}
	if _, err := Rebuild("a\nb", []string{"\n", "\n\n"}); err == nil {
		t.Error("invalid terminator should error")
	}
}

func TestCountLines(t *testing.T) {
	cases := map[string]int{"": 1, "a": 1, "a\n": 2, "a\nb": 2, "a\nb\n": 3}
	for in, want := range cases {
		if got := CountLines(in); got != want {
			t.Errorf("CountLines(%q) = %d, want %d", in, got, want)
		}
	}
}
