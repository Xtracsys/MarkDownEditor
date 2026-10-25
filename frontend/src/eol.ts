// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Per-line line-terminator tracking for CodeMirror documents.
//
// The backend decodes a file into lines plus per-line terminators (LF, CRLF,
// CR, or "" for an unterminated final line). The editor buffer is
// LF-normalized; this module keeps the terminator array aligned across edits
// so a save reproduces the file's original line-ending structure — including
// mixed files — instead of normalizing it.
//
// Alignment rules for a change replacing old lines [firstOld..lastOld] with
// new content containing K line breaks:
//   - terminators of lines before firstOld are untouched;
//   - the K new lines created inside the inserted text take the document's
//     default terminator (its predominant original style);
//   - the last line of the replaced region inherits oldEols[lastOld], the
//     terminator that sat after the change and survived it;
//   - everything after lastOld shifts by the line delta.
//
// Consequence (documented in the README): typing inside a line never changes
// that line's terminator; splitting/joining lines assigns the default
// terminator to the new boundaries. Pure LF / pure CRLF / pure CR files are
// always byte-exact; mixed files keep their endings except at freshly created
// line boundaries. Undo/redo runs through the same math.

import { Facet, StateField, Transaction } from "@codemirror/state";
import type { Eol } from "./ipc";

export const DEFAULT_EOL = "\n";

/** Per-tab initial terminators + the default used for newly created lines. */
export interface EolDocState {
  eols: Eol[];
  defaultEol: Eol;
}

export const eolConfig = Facet.define<EolDocState, EolDocState>({
  combine: (vals) => (vals.length ? vals[vals.length - 1] : { eols: [""], defaultEol: DEFAULT_EOL }),
});

/** The aligned terminator array; eols[i] follows line i. */
export const eolField = StateField.define<readonly Eol[]>({
  create: (state) => state.facet(eolConfig).eols,
  update: (value, tr) => {
    if (!tr.docChanged) return value;
    const cfg = tr.state.facet(eolConfig);
    return applyChanges(value, tr, cfg.defaultEol);
  },
});

export function applyChanges(
  oldEols: readonly Eol[],
  tr: Transaction,
  defaultEol: Eol,
): Eol[] {
  const eols = oldEols.slice();
  const oldDoc = tr.startState.doc;
  const result: Eol[] = [];
  let consumed = 0; // next old index not yet copied into result

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const firstOld = oldDoc.lineAt(fromA).number - 1;
    const lastOld = oldDoc.lineAt(toA).number - 1;

    while (consumed < firstOld) {
      result.push(eols[consumed]);
      consumed++;
    }
    // The change consumed terminators firstOld..lastOld-1 (deleted) and
    // lastOld's terminator survives as the region's trailing terminator.
    const insText = inserted.sliceString(0, inserted.length, "\n");
    let k = 0;
    for (let i = 0; i < insText.length; i++) {
      if (insText.charCodeAt(i) === 10 /* \n */) k++;
    }
    for (let i = 0; i < k; i++) result.push(defaultEol);
    result.push(eols[lastOld] ?? "");
    consumed = lastOld + 1;
  });

  while (consumed < eols.length) {
    result.push(eols[consumed]);
    consumed++;
  }
  return result;
}

/** Serialize a buffer + terminators back to file text (mirrors Go Rebuild). */
export function serialize(content: string, eols: readonly Eol[]): string {
  const lines = content.split("\n");
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    out += lines[i];
    out += eols[i] ?? "\n";
  }
  return out;
}

/** True when terminators and text together reproduce `saved`. */
export function equalsSaved(
  content: string,
  eols: readonly Eol[],
  savedContent: string,
  savedEols: readonly Eol[],
): boolean {
  if (content !== savedContent || eols.length !== savedEols.length) return false;
  for (let i = 0; i < eols.length; i++) {
    if (eols[i] !== savedEols[i]) return false;
  }
  return true;
}
