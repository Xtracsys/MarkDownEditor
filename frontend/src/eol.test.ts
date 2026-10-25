// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

import { describe, expect, it } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { eolField, eolConfig, applyChanges, serialize, equalsSaved } from "./eol";
import type { Eol } from "./ipc";

/** Build a real EditorState the way the app does, then let CM transactions
 * exercise the EOL field exactly as edits would. */
function stateWith(content: string, eols: Eol[], defaultEol: Eol) {
  return EditorState.create({
    doc: content,
    extensions: [eolConfig.of({ eols, defaultEol }), eolField],
  });
}

function edit(state: EditorState, spec: TransactionSpec) {
  const tr = state.update(spec);
  return { state: tr.state, eols: tr.state.field(eolField) as readonly Eol[] };
}

describe("EOL field round-trips", () => {
  it("keeps CRLF terminators untouched while typing inside a line", () => {
    let s = stateWith("one\ntwo\nthree\n", ["\r\n", "\r\n", "\r\n", ""], "\r\n");
    // Type at end of line 1 (before the line break): CM change at pos 3.
    const r = edit(s, { changes: { from: 3, insert: "!!" } });
    expect(r.state.doc.toString()).toBe("one!!\ntwo\nthree\n");
    expect(r.eols).toEqual(["\r\n", "\r\n", "\r\n", ""]);
    expect(serialize(r.state.doc.toString(), r.eols)).toBe("one!!\r\ntwo\r\nthree\r\n");
  });

  it("assigns the predominant terminator to newly split lines", () => {
    const s = stateWith("hello", [""], "\r\n");
    // Press Enter after "hel".
    const r = edit(s, { changes: { from: 3, insert: "\n" } });
    expect(r.state.doc.toString()).toBe("hel\nlo");
    expect(r.eols).toEqual(["\r\n", ""]);
    expect(serialize(r.state.doc.toString(), r.eols)).toBe("hel\r\nlo");
  });

  it("preserves mixed terminators for untouched lines when another line is edited", () => {
    // a=CRLF b=LF c=CR d(no final)
    const s = stateWith("a\nb\nc\nd", ["\r\n", "\n", "\r", ""], "\r\n");
    const r = edit(s, { changes: { from: 7, insert: "X" } }); // append to line d (doc length 7)
    expect(serialize(r.state.doc.toString(), r.eols)).toBe("a\r\nb\nc\rdX");
  });

  it("joins lines and keeps the surviving terminator", () => {
    // "a\r\nb" — delete the break: "ab" keeps no terminator (last line).
    const s = stateWith("a\nb", ["\r\n", ""], "\r\n");
    const r = edit(s, { changes: { from: 1, to: 2 } });
    expect(r.state.doc.toString()).toBe("ab");
    expect(r.eols).toEqual([""]);
    expect(serialize(r.state.doc.toString(), r.eols)).toBe("ab");
  });

  it("handles multi-line paste at the start of a document", () => {
    const s = stateWith("world", [""], "\n");
    const r = edit(s, { changes: { from: 0, insert: "hello\nbig\n" } });
    expect(r.state.doc.toString()).toBe("hello\nbig\nworld");
    expect([...r.eols]).toEqual(["\n", "\n", ""]);
  });

  it("deleting a whole line removes exactly its terminator", () => {
    // a\r\nb\nc → delete "b\r\n" (line b plus its CRLF): a\r\nc
    const s = stateWith("a\nb\nc", ["\r\n", "\r\n", ""], "\r\n");
    const r = edit(s, { changes: { from: 2, to: 5 } }); // "b\n" in LF coords (pos2..5? "a\nb\nc": a=0,\n=1,b=2,\n=3,c=4)
    // Use precise positions: delete from start of line b (2) to start of line c (4).
    const r2 = edit(stateWith("a\nb\nc", ["\r\n", "\r\n", ""], "\r\n"), {
      changes: { from: 2, to: 4 },
    });
    expect(r2.state.doc.toString()).toBe("a\nc");
    expect([...r2.eols]).toEqual(["\r\n", ""]);
    expect(serialize(r2.state.doc.toString(), r2.eols)).toBe("a\r\nc");
    void r;
  });

  it("undo restores content through the same alignment math", () => {
    const s = stateWith("a\nb", ["\r\n", ""], "\r\n");
    const split = s.update({ changes: { from: 1, insert: "\n" } }).state;
    const undone = split.update({ changes: { from: 1, to: 2 } }).state;
    expect(undone.doc.toString()).toBe("a\nb");
    expect([...undone.field(eolField)]).toEqual(["\r\n", ""]);
  });
});

describe("applyChanges (transaction math)", () => {
  it("is a no-op for non-doc transactions", () => {
    const s = stateWith("a\nb", ["\r\n", ""], "\n");
    const tr = s.update({ selection: { anchor: 0 } }) as Transaction;
    expect(applyChanges(["\r\n", ""], tr, "\n")).toEqual(["\r\n", ""]);
  });
});

describe("serialize / equalsSaved", () => {
  it("serialize mirrors the Go Rebuild", () => {
    expect(serialize("a\nb", ["\r\n", ""])).toBe("a\r\nb");
    expect(serialize("a\nb\n", ["\n", "\n", ""])).toBe("a\nb\n");
    expect(serialize("x", [""])).toBe("x");
  });
  it("equalsSaved requires both text and terminators to match", () => {
    expect(equalsSaved("a\nb", ["\n", ""], "a\nb", ["\n", ""])).toBe(true);
    expect(equalsSaved("a\nb", ["\r\n", ""], "a\nb", ["\n", ""])).toBe(false);
    expect(equalsSaved("a\nb", ["\n", ""], "a\nc", ["\n", ""])).toBe(false);
  });
});
