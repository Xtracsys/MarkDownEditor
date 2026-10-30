// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

import { describe, expect, it } from "vitest";
import { parseOutline } from "./outline";

describe("parseOutline", () => {
  it("extracts headings with levels and lines", () => {
    const md = "# Title\n\ntext\n## Section\n### Deep\n";
    expect(parseOutline(md)).toEqual([
      { level: 1, text: "Title", line: 0 },
      { level: 2, text: "Section", line: 3 },
      { level: 3, text: "Deep", line: 4 },
    ]);
  });

  it("ignores headings inside fenced code", () => {
    const md = "# Real\n\n```md\n# Not a heading\n```\n\n~~~\n## Also not\n~~~\n\n## After\n";
    expect(parseOutline(md)).toEqual([
      { level: 1, text: "Real", line: 0 },
      { level: 2, text: "After", line: 10 },
    ]);
  });

  it("handles closing fences only when markers match", () => {
    const md = "# A\n\n````\n## fenced\n````\n# B\n";
    expect(parseOutline(md)).toEqual([
      { level: 1, text: "A", line: 0 },
      { level: 1, text: "B", line: 5 },
    ]);
  });

  it("strips trailing hashes and requires space after hashes", () => {
    const md = "#Title\n# Real One #\n#### Four\n";
    expect(parseOutline(md)).toEqual([
      { level: 1, text: "Real One", line: 1 },
      { level: 4, text: "Four", line: 2 },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseOutline("")).toEqual([]);
  });
});
