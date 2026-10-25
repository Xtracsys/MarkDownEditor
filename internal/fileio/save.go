// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package fileio

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

// KnownState is the last on-disk state the editor wrote or observed. Saving
// compares against it to detect external modification.
type KnownState struct {
	Hash         string `json:"hash"`
	Size         int64  `json:"size"`
	ModTimeNanos int64  `json:"modTimeNanos"`
}

// SaveIssue describes why a save was refused. "external-change" is retryable
// with Overwrite=true after the user has decided; the others are terminal for
// this attempt.
type SaveIssue struct {
	Reason     string `json:"reason"` // external-change | validation | io | permission
	Message    string `json:"message"`
	Detail     string `json:"detail,omitempty"`
}

// SaveResult reports what actually happened on disk.
type SaveResult struct {
	Written      bool   `json:"written"` // false when the new bytes were identical and the write was skipped
	Hash         string `json:"hash"`    // SHA-256 of the bytes now on disk
	Size         int64  `json:"size"`
	ModTimeNanos int64  `json:"modTimeNanos"`
}

// BuildBytes turns an LF-normalized buffer plus per-line terminators and an
// encoding back into raw file bytes. This is the single encode path shared by
// Save and Save As; it validates rather than guessing.
func BuildBytes(content, encoding string, eols []string) ([]byte, error) {
	text, err := Rebuild(content, eols)
	if err != nil {
		return nil, err
	}
	switch encoding {
	case EncUTF8:
		return []byte(text), nil
	case EncUTF8BOM:
		out := make([]byte, 0, len(text)+3)
		out = append(out, 0xEF, 0xBB, 0xBF)
		return append(out, text...), nil
	case EncUTF16LE:
		return EncodeUTF16(text, false), nil
	case EncUTF16BE:
		return EncodeUTF16(text, true), nil
	default:
		return nil, fmt.Errorf("unsupported encoding %q", encoding)
	}
}

// SaveDocument writes data to path using the safe-save protocol:
//
//  1. If path is a symbolic link, resolve it and write the target so the link
//     itself is never replaced.
//  2. If the file already exists and known is provided, compare the on-disk
//     hash: a mismatch means someone else changed the file, which is surfaced
//     as an "external-change" issue unless overwrite is set.
//  3. If the bytes on disk already equal data, skip the write entirely so an
//     unchanged save never touches mtime or permissions.
//  4. Otherwise write a hidden temporary file in the same directory, fsync it,
//     copy the original permissions, and atomically rename it into place, then
//     fsync the directory. A crash mid-save leaves at worst the old file plus
//     one orphan temp file, never a truncated file.
func SaveDocument(path string, data []byte, known *KnownState, overwrite bool) (*SaveResult, *SaveIssue) {
	target := path
	symlink := false
	if fi, err := os.Lstat(path); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		resolved, rerr := filepath.EvalSymlinks(path)
		if rerr != nil {
			return nil, &SaveIssue{Reason: "io", Message: "This file is a symbolic link whose target could not be resolved, so it was not saved.", Detail: rerr.Error()}
		}
		target = resolved
		symlink = true
	}

	mode := os.FileMode(0644)
	existing := false
	var disk []byte
	if fi, err := os.Stat(target); err == nil {
		existing = true
		mode = fi.Mode().Perm()
		disk, err = os.ReadFile(target)
		if err != nil {
			return nil, &SaveIssue{Reason: "io", Message: "Could not read the current on-disk copy to verify it before saving.", Detail: err.Error()}
		}
	} else if !os.IsNotExist(err) {
		return nil, &SaveIssue{Reason: "io", Message: "Could not inspect the file before saving.", Detail: err.Error()}
	}

	if existing && known != nil && !overwrite && hashBytes(disk) != known.Hash {
		return nil, &SaveIssue{
			Reason:  "external-change",
			Message: "The file changed on disk after it was opened.",
			Detail:  fmt.Sprintf("On disk: %s (%s). Previously known: %s (%s). Choose how to proceed.", humanBytes(int64(len(disk))), hashBytes(disk)[:12], humanBytes(known.Size), known.Hash[:12]),
		}
	}

	newHash := hashBytes(data)
	if existing && bytes.Equal(disk, data) {
		fi, err := os.Stat(target)
		if err == nil {
			return &SaveResult{Written: false, Hash: newHash, Size: fi.Size(), ModTimeNanos: fi.ModTime().UnixNano()}, nil
		}
	}

	dir := filepath.Dir(target)
	base := filepath.Base(target)
	tmpName := filepath.Join(dir, tempName(base))
	if err := writeFileAtomicTemp(tmpName, data, mode); err != nil {
		return nil, &SaveIssue{Reason: tempIssueReason(err), Message: "Could not write a temporary file next to the document (needed for safe, crash-resistant saving).", Detail: err.Error()}
	}
	if err := os.Rename(tmpName, target); err != nil {
		os.Remove(tmpName)
		return nil, &SaveIssue{Reason: "io", Message: "Could not replace the original file with the saved data.", Detail: err.Error()}
	}
	syncDir(dir)

	fi, err := os.Stat(target)
	if err != nil {
		return nil, &SaveIssue{Reason: "io", Message: "The file was written but its new state could not be read back.", Detail: err.Error()}
	}
	_ = symlink
	return &SaveResult{Written: true, Hash: newHash, Size: fi.Size(), ModTimeNanos: fi.ModTime().UnixNano()}, nil
}

// writeTemp creates, fills, fsyncs and closes tmp with the given permissions.
func writeFileAtomicTemp(tmp string, data []byte, mode os.FileMode) error {
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Chmod(tmp, mode)
}

// tempName builds a hidden per-document temp name that is unique per save.
func tempName(base string) string {
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		for i := range suffix {
			suffix[i] = byte('a' + i)
		}
	}
	return fmt.Sprintf(".%s.xtracsys-save-%x.tmp", base, suffix)
}

func tempIssueReason(err error) string {
	if os.IsPermission(err) {
		return "permission"
	}
	return "io"
}

// syncDir best-effort fsyncs a directory so the rename is durable.
func syncDir(dir string) {
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	d.Sync()
	d.Close()
}

// HashOf is the shared SHA-256 helper used by the watcher and save paths.
func HashOf(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}
