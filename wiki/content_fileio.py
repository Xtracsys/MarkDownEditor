# Wiki content: the file-integrity engine (internal/fileio).
# SPDX-License-Identifier: Apache-2.0

ARTICLES = [
    dict(
        slug="fileio-eol",
        title="internal/fileio/eol.go — per-line terminator engine",
        category="core", path="internal/fileio/eol.go", lines=178, lang="Go", status="CORE",
        pkg="fileio", phase="the heart", tested_by="fileio-tests", related=["fe-eol", "fileio-save"],
        lead=[
            "eol.go is why mixed line endings survive editing. ParseEols splits text into lines plus a parallel terminator array (\"\\n\", \"\\r\\n\", \"\\r\", or \"\" for the final line) — the canonical representation every other function works from. ToLF produces the LF-normalized editor buffer; Rebuild joins them back, rejecting bare carriage returns and terminator-count mismatches rather than guessing.",
        ],
        sections=[
            ("The phantom final line", [
                "ParseEols always appends a final line whose terminator is \"\" — a file 'a\\r\\nb\\r\\n' becomes lines [a, b, \"\"] with eols [CRLF, CRLF, \"\"]. This convention is the contract the frontend EOL tracker mirrors, and the source of one real bug: the first Normalize implementation filled the whole array with the target, giving the phantom line a terminator and appending a blank line on every save. The fix preserves the trailing \"\" — a file's own final-newline state is sacred.",
                "EolInfo returns the predominant terminator (used for newly typed lines) and a display summary (lf/crlf/cr/mixed/none). Ties break toward the terminator that appears earliest in the file, deterministically.",
            ]),
        ],
        key_items=[
            ("ParseEols(text) (lines, eols)", "splits into lines + per-line terminators; always len(eols) == len(lines)"),
            ("Rebuild(content, eols)", "joins back; errors on bare CR, count mismatch, or invalid terminator — never guesses"),
            ("EolInfo(eols)", "predominant terminator (earliest-on-tie) + display summary"),
        ],
    ),
    dict(
        slug="fileio-encoding",
        title="internal/fileio/encoding.go — UTF-8/UTF-16 codecs",
        category="core", path="internal/fileio/encoding.go", lines=141, lang="Go", status="CORE",
        pkg="fileio", tested_by="fileio-tests", related=["fileio-load"],
        lead=[
            "Hand-rolled UTF-16 codec (the stdlib utf16 package lacks surrogate predicates) with explicit lossy semantics: DecodeUTF16 replaces unpaired surrogates and trailing odd bytes with U+FFFD and reports lossy=true, which forces the document read-only so it can never be saved back incorrectly. EncodeUTF16 always emits a BOM and valid pairs.",
        ],
        sections=[
            ("Lossy discipline", [
                "The lossy flag is the security: a file that cannot round-trip is refused (Load returns an Issue) rather than silently transcoded. LossyUTF8 exists only for the explicit read-only fallback view. EncodingLabel maps the enum to status-bar labels.",
            ]),
        ],
        key_items=[
            ("DecodeUTF16(b, bigEndian)", "decodes without the BOM; lossy=true on unpaired surrogates/odd bytes"),
            ("EncodeUTF16(s, bigEndian)", "BOM + valid surrogate pairs; round-trips under 31.5M fuzz executions"),
            ("LossyUTF8(data)", "U+FFFD-substituting decode for the read-only view only"),
        ],
    ),
    dict(
        slug="fileio-load",
        title="internal/fileio/load.go — open anything textual, safely",
        category="core", path="internal/fileio/load.go", lines=296, lang="Go", status="CORE",
        pkg="fileio", tested_by="fileio-tests", related=["fileio-eol", "fe-app"],
        lead=[
            "Load is the front door. It stats first (regular files only — /dev/zero and FIFOs are refused), enforces the 32 MiB size cap and 2M-line guard (a newline bomb would otherwise allocate a gigabyte of per-line slices), then decodes: BOM detection for UTF-8/UTF-16 LE/BE, NUL-byte binary refusal with the offset and a hex preview, and a BOM-less UTF-16 heuristic that explains the re-save fix instead of misreading bytes.",
        ],
        sections=[
            ("Refusal semantics", [
                "Every refusal is an Issue struct with a machine-readable reason and a human explanation: binary (NUL at offset N), unsupported-encoding (first invalid byte + hex preview + read-only offer), too-large, too-many-lines, not-regular, directory, not-found, permission. The read-only fallback (LoadReadOnly) always marks ReadOnly so SaveTab refuses in-place saves; exports via Save As are allowed and clear the flag.",
            ]),
        ],
        key_items=[
            ("Load(path) (*LoadResult, *Issue)", "decode + EOL parse + hash; nil Issue means the file round-trips"),
            ("LoadReadOnly(path)", "explicit lossy view; always read-only"),
            ("Issue{Reason, Message, Detail, HexPreview}", "machine-readable refusals with human explanations"),
        ],
    ),
    dict(
        slug="fileio-save",
        title="internal/fileio/save.go — the safe-save protocol",
        category="core", path="internal/fileio/save.go", lines=207, lang="Go", status="CORE",
        pkg="fileio", phase="the heart", tested_by="fileio-tests", related=["fileio-eol", "app-go"],
        lead=[
            "SaveDocument is the protocol that makes 'byte-faithful' true: resolve symlinks (follow, never replace), stat (regular files only), read the on-disk copy, gate on the known hash (external change → decision, not overwrite), skip the write entirely if the bytes are identical, then hidden temp file → fsync → original permissions → atomic rename → directory fsync. A pre-rename re-read closes the check→rename TOCTOU window to a single read.",
        ],
        sections=[
            ("BuildBytes", [
                "The single encode path shared by Save and Save As: Rebuild(content, eols) then encode per the enum (UTF-8 ± BOM, UTF-16 LE/BE with BOM). It rejects bare CRs, count mismatches, and unknown encodings — the fuzzers verify that every successful encode loads back byte-identical.",
            ]),
        ],
        key_items=[
            ("BuildBytes(content, encoding, eols)", "content+terminators+encoding → exact file bytes; validates rather than guesses"),
            ("SaveDocument(path, data, known, overwrite)", "hash gate → skip-if-identical → temp+fsync+chmod+rename+dir-fsync → re-read gate"),
            ("KnownState{Hash, Size, ModTimeNanos}", "the last observed on-disk state; the external-change gate compares full SHA-256"),
        ],
    ),
    dict(
        slug="fileio-watch",
        title="internal/fileio/watch.go — external-change detection",
        category="core", path="internal/fileio/watch.go", lines=186, lang="Go", status="CORE",
        pkg="fileio", tested_by="fileio-tests", related=["app-go"],
        lead=[
            "A deliberately polling watcher (stat + SHA-256 on change): identical behavior on every OS and filesystem including network mounts, no inotify dependencies, and cheap for a handful of open tabs. State machine per tab: changed (hash differs), deleted (gone), restored (reappeared with different content) — plus absorption of touches with identical bytes and of the app's own saves via Update.",
        ],
        sections=[
            ("Why polling", [
                "inotify/kqueue/FSEvents differ per platform and miss network mounts; a 1.5 s poll of open documents costs nothing and behaves identically everywhere. The non-regular-file guard means a watched path replaced by a FIFO or device is never read.",
            ]),
        ],
        key_items=[
            ("Watcher.Register/Update/Rename/Remove", "per-tab lifecycle; own saves absorbed via known-state updates"),
            ("inspect(path, known, missing)", "stat → hash-confirm → event; devices skipped entirely"),
        ],
    ),
    dict(
        slug="fileio-fuzz",
        title="internal/fileio/fuzz_test.go — the corruption hunters",
        category="core", path="internal/fileio/fuzz_test.go", lines=120, lang="Go", status="TEST",
        pkg="fileio", tested_by="fileio-tests", related=["fileio-eol", "fileio-encoding"],
        lead=[
            "Three property-based fuzzers that have executed 60M+ times without finding a corruption path — after two property bugs in the harness itself were fixed (the fuzzer constructed editor states unreachable from real JS strings; the lesson: model the actual contract, then fuzz it).",
        ],
        sections=[
            ("The properties", [
                "FuzzParseEols: joining lines+terminators must reproduce the input exactly, and ToLF+Rebuild must too — any mismatch is silent corruption. FuzzUTF16RoundTrip: decode→encode→decode is idempotent for every byte sequence, including lone surrogates and truncated pairs. FuzzBuildBytes: every successful encode loads back to the identical content, for reachable editor states only (valid UTF-8, final terminator empty, intermediate terminators non-empty).",
            ]),
        ],
        key_items=[
            ("FuzzParseEols", "27.5M execs clean; join and rebuild invariants"),
            ("FuzzUTF16RoundTrip", "31.5M execs clean; idempotence incl. surrogates"),
            ("FuzzBuildBytes", "90s runs clean after modeling the reachable-state contract"),
        ],
    ),
]
