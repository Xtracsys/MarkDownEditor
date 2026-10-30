// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// Markdown outline extraction: headings outside fenced code blocks.

export interface OutlineHeading {
  level: number; // 1-6
  text: string;
  line: number; // zero-based
}

export function parseOutline(markdown: string): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  let inFence = false;
  let fenceMarker = "";
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (line.trim().startsWith(fenceMarker[0])) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      out.push({ level: h[1].length, text: h[2].trim(), line: i });
    }
  }
  return out;
}
