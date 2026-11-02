// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package fileio

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// loadSaveCycle loads, rebuilds, and saves through the real SaveDocument path.
func loadSaveCycle(t *testing.T, original []byte, mutate func(content string, eols []string) (string, []string)) ([]byte, *SaveResult) {
	t.Helper()
	p := writeTemp(t, original)
	res, issue := Load(p)
	if issue != nil {
		t.Fatalf("load issue: %+v", issue)
	}
	known := KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos}
	content, eols := res.Content, res.Eols
	if mutate != nil {
		content, eols = mutate(content, eols)
	}
	data, err := BuildBytes(content, res.Encoding, eols)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	sr, si := SaveDocument(p, data, &known, false)
	if si != nil {
		t.Fatalf("save issue: %+v", si)
	}
	got, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return got, sr
}

func TestSaveUnchangedPreservesBytesAndSkipsWrite(t *testing.T) {
	original := []byte("alpha\r\nbeta\r\ngamma\r\n")
	p := writeTemp(t, original)
	before, issue := Load(p)
	if issue != nil {
		t.Fatal(issue)
	}
	known := KnownState{Hash: before.Hash, Size: before.Size, ModTimeNanos: before.ModTimeNanos}
	st, _ := os.Stat(p)

	data, _ := BuildBytes(before.Content, before.Encoding, before.Eols)
	sr, si := SaveDocument(p, data, &known, false)
	if si != nil {
		t.Fatalf("save issue: %+v", si)
	}
	if sr.Written {
		t.Error("unchanged save should skip the write entirely")
	}
	after, _ := os.Stat(p)
	if !after.ModTime().Equal(st.ModTime()) {
		t.Error("unchanged save must not touch mtime")
	}
	got, _ := os.ReadFile(p)
	if string(got) != string(original) {
		t.Fatal("bytes changed on unchanged save")
	}
}

func TestSaveEditsPreserveEolStyleAndBom(t *testing.T) {
	// CRLF file with BOM; user appends a line. Existing CRLFs stay CRLF, the
	// new line takes the predominant terminator, BOM survives.
	original := append([]byte{0xEF, 0xBB, 0xBF}, []byte("one\r\ntwo\r\n")...)
	got, _ := loadSaveCycle(t, original, func(content string, eols []string) (string, []string) {
		if content != "one\ntwo\n" {
			t.Fatalf("unexpected buffer %q", content)
		}
		newContent := "one\ntwo\nthree\n"
		// EOL tracker: existing lines keep CRLF, the new line takes the default.
		return newContent, []string{"\r\n", "\r\n", "\r\n", ""}
	})
	want := append([]byte{0xEF, 0xBB, 0xBF}, []byte("one\r\ntwo\r\nthree\r\n")...)
	if string(got) != string(want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestSavePreservesMixedLineEndings(t *testing.T) {
	original := []byte("a\r\nb\nc\rd")
	got, _ := loadSaveCycle(t, original, func(content string, eols []string) (string, []string) {
		// No edits at all: mixed endings must survive untouched.
		return content, eols
	})
	if string(got) != string(original) {
		t.Fatalf("mixed endings normalized:\n got %q\nwant %q", got, original)
	}

	// Edit on line 1 only (typing text, no line splits): every original
	// terminator stays exactly where it was.
	got2, _ := loadSaveCycle(t, original, func(content string, eols []string) (string, []string) {
		return "aa\nb\nc\nd", eols
	})
	if string(got2) != "aa\r\nb\nc\rd" {
		t.Fatalf("edited line changed foreign endings: %q", got2)
	}
}

func TestSavePreservesNoFinalNewline(t *testing.T) {
	original := []byte("no newline at end")
	got, _ := loadSaveCycle(t, original, nil)
	if string(got) != string(original) {
		t.Fatalf("final newline injected: %q", got)
	}
}

func TestSaveDetectsExternalChange(t *testing.T) {
	p := writeTemp(t, []byte("original\n"))
	res, _ := Load(p)
	known := KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos}

	// Someone else writes the file behind our back.
	os.WriteFile(p, []byte("external edit\n"), 0o644)
	data, _ := BuildBytes("mine\n", EncUTF8, []string{"\n", ""})
	_, si := SaveDocument(p, data, &known, false)
	if si == nil || si.Reason != "external-change" {
		t.Fatalf("issue = %+v, want external-change", si)
	}
	// The external content must still be intact — no silent overwrite.
	disk, _ := os.ReadFile(p)
	if string(disk) != "external edit\n" {
		t.Fatal("external change was clobbered")
	}

	// Explicit overwrite succeeds.
	sr, si := SaveDocument(p, data, &known, true)
	if si != nil {
		t.Fatalf("overwrite issue: %+v", si)
	}
	if !sr.Written {
		t.Error("overwrite should write")
	}
	disk, _ = os.ReadFile(p)
	if string(disk) != "mine\n" {
		t.Fatalf("overwrite content: %q", disk)
	}
}

func TestSavePreservesPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix permission bits")
	}
	p := writeTemp(t, []byte("x\n"))
	os.Chmod(p, 0o604)
	res, _ := Load(p)
	known := KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos}
	data, _ := BuildBytes("xy\n", EncUTF8, []string{"\n", ""})
	if _, si := SaveDocument(p, data, &known, false); si != nil {
		t.Fatalf("issue: %+v", si)
	}
	fi, _ := os.Stat(p)
	if fi.Mode().Perm() != 0o604 {
		t.Fatalf("permissions changed: %o", fi.Mode().Perm())
	}
}

func TestSaveFollowsSymlinkWithoutReplacingIt(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "real.txt")
	os.WriteFile(target, []byte("real\n"), 0o644)
	link := filepath.Join(dir, "link.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Skip("symlinks unavailable")
	}
	res, issue := Load(link)
	if issue != nil {
		t.Fatal(issue)
	}
	if res.Path != link {
		t.Fatalf("path should stay the link: %q", res.Path)
	}
	known := KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos}
	data, _ := BuildBytes("edited\n", res.Encoding, res.Eols)
	if _, si := SaveDocument(link, data, &known, false); si != nil {
		t.Fatalf("issue: %+v", si)
	}
	fi, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("symlink was replaced by a regular file")
	}
	got, _ := os.ReadFile(target)
	if string(got) != "edited\n" {
		t.Fatalf("target not written: %q", got)
	}
}

func TestSaveNewFileViaSaveAs(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "brand new.md")
	data, _ := BuildBytes("# fresh\n", EncUTF8, []string{"\n", ""})
	sr, si := SaveDocument(p, data, nil, false)
	if si != nil {
		t.Fatalf("issue: %+v", si)
	}
	if !sr.Written {
		t.Error("new file must be written")
	}
	got, _ := os.ReadFile(p)
	if string(got) != "# fresh\n" {
		t.Fatalf("content: %q", got)
	}
	// Windows uses ACLs rather than POSIX permission bits.
	if runtime.GOOS != "windows" {
		fi, _ := os.Stat(p)
		if fi.Mode().Perm() != 0o644 {
			t.Errorf("new file mode = %o, want 644", fi.Mode().Perm())
		}
	}
}

func TestSaveLeavesNoTempClutter(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "doc.txt")
	os.WriteFile(p, []byte("one\n"), 0o644)
	res, _ := Load(p)
	known := KnownState{Hash: res.Hash, Size: res.Size, ModTimeNanos: res.ModTimeNanos}
	data, _ := BuildBytes("two\n", EncUTF8, []string{"\n", ""})
	if _, si := SaveDocument(p, data, &known, false); si != nil {
		t.Fatalf("issue: %+v", si)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		names := []string{}
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("clutter left behind: %v", names)
	}
}

func TestBuildBytesRejectsBadInput(t *testing.T) {
	if _, err := BuildBytes("a\rb", EncUTF8, []string{"\n", ""}); err == nil {
		t.Error("bare CR must be rejected")
	}
	if _, err := BuildBytes("a\nb", EncUTF8, []string{"\n"}); err == nil {
		t.Error("terminator count mismatch must be rejected")
	}
	if _, err := BuildBytes("a", "latin1", []string{""}); err == nil {
		t.Error("unknown encoding must be rejected")
	}
}
