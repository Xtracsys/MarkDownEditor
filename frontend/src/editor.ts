// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

// CodeMirror wiring: per-tab EditorState, language detection, brand themes,
// find/replace, indentation, word wrap. The editor owns no file logic.

import {
  EditorState,
  Compartment,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import {
  EditorView, keymap, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor,
  lineNumbers, highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching, foldGutter, foldKeymap, indentOnInput,
  indentUnit, syntaxHighlighting, HighlightStyle,
  LanguageDescription, type LanguageSupport,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";

import { eolField, eolConfig } from "./eol";
import type { TabInfo, AppSettings } from "./ipc";

const langComp = new Compartment();
const wrapComp = new Compartment();
const tabComp = new Compartment();
const gutterComp = new Compartment();
const activeLineComp = new Compartment();
const fontSizeComp = new Compartment();
const themeComp = new Compartment();

export interface CreateStateOptions {
  info: TabInfo;
  settings: AppSettings;
  theme: "light" | "dark";
  extraKeys?: Extension;
}

/** Guess a language from the filename, falling back to shebang sniffing. */
export async function detectLanguage(
  path: string,
  firstLines: string,
): Promise<LanguageSupport | null> {
  const name = path.split("/").pop() || path;
  const byName = LanguageDescription.matchFilename(languages, name);
  if (byName) {
    try {
      return (await byName.load()) as LanguageSupport;
    } catch {
      return null;
    }
  }
  // Extensionless or unknown: shebang sniffing so scripts still highlight.
  const m = firstLines.match(/^#!\s*\S*(?:\/|\s)(\w+)/);
  if (m) {
    const which: Record<string, string> = {
      bash: "Shell", sh: "Shell", zsh: "Shell", dash: "Shell", ksh: "Shell", fish: "Shell",
      python: "Python", python3: "Python", node: "JavaScript", deno: "JavaScript",
      ruby: "Ruby", perl: "Perl", awk: "AWK",
    };
    const langName = which[m[1]];
    if (langName) {
      const desc = languages.find((l) => l.name === langName || l.alias.includes(langName.toLowerCase()));
      if (desc) {
        try {
          return (await desc.load()) as LanguageSupport;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Markdown documents use the markdown language with embedded code languages. */
export function markdownLanguage(): LanguageSupport {
  return markdown({ codeLanguages: languages, addKeymap: true });
}

export function isMarkdownPath(path: string): boolean {
  const name = (path.split("/").pop() || "").toLowerCase();
  return name === "markdown" || /\.(md|markdown|mkd|mdown|mkdown|mdx)$/.test(name);
}

export async function makeState(opts: CreateStateOptions): Promise<EditorState> {
  const { info, settings, theme } = opts;
  const lang = isMarkdownPath(info.path)
    ? markdownLanguage()
    : await detectLanguage(info.path, info.content.split("\n", 5).join("\n"));

  return EditorState.create({
    doc: info.content,
    extensions: [
      eolConfig.of({ eols: info.eols, defaultEol: info.defaultEol }),
      eolField,
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      foldGutter(),
      keymap.of([
        ...searchKeymap,
        ...foldKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      opts.extraKeys ?? [],
      highlightSelectionMatches(),
      langComp.of(lang ? lang : []),
      wrapComp.of(settings.wordWrap ? EditorView.lineWrapping : []),
      tabComp.of([
        indentUnit.of(settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t"),
        EditorState.tabSize.of(settings.tabSize),
      ]),
      gutterComp.of(settings.showLineNumbers ? lineNumbers() : []),
      activeLineComp.of(settings.highlightActiveLine ? highlightActiveLine() : []),
      fontSizeComp.of(EditorView.theme({ "&": { fontSize: fontPx(settings) } })),
      themeComp.of(cmTheme(theme)),
      syntaxHighlighting(brandHighlightStyle(theme)),
    ],
  });
}

function fontPx(s: AppSettings): string {
  return s.editorFontSize && s.editorFontSize >= 10 ? `${s.editorFontSize}px` : "13.5px";
}

/** Effects that reconfigure an existing tab state after settings/theme changes. */
export function settingsEffects(settings: AppSettings, theme: "light" | "dark"): StateEffect<unknown>[] {
  return [
    wrapComp.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
    tabComp.reconfigure([
      indentUnit.of(settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t"),
      EditorState.tabSize.of(settings.tabSize),
    ]),
    gutterComp.reconfigure(settings.showLineNumbers ? lineNumbers() : []),
    activeLineComp.reconfigure(settings.highlightActiveLine ? highlightActiveLine() : []),
    fontSizeComp.reconfigure(EditorView.theme({ "&": { fontSize: fontPx(settings) } })),
    themeComp.reconfigure(cmTheme(theme)),
  ] as StateEffect<unknown>[];
}

/** Editor chrome theme built from CSS variables so theme switches are pure CSS. */
function cmTheme(theme: "light" | "dark"): Extension {
  return EditorView.theme(
    {
      "&": { color: "var(--text)", backgroundColor: "var(--bg)", height: "100%" },
      ".cm-content": { caretColor: "var(--cm-cursor)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "var(--cm-selection)" },
    },
    { dark: theme === "dark" },
  );
}

/** Syntax palette: rust-family keywords, muted comments/strings — the brand's
 * restrained accent scheme rather than a rainbow. */
function brandHighlightStyle(theme: "light" | "dark"): HighlightStyle {
  const v = theme === "dark"
    ? { kw: "#D0795F", str: "#A8B394", com: "#6E6B65", num: "#E0937B", typ: "#D8A78F", head: "#D0795F" }
    : { kw: "#9E3F2B", str: "#5E6B4E", com: "#8B877D", num: "#8A3A1F", typ: "#7A4736", head: "#B14831" };
  return HighlightStyle.define([
    { tag: t.keyword, color: v.kw, fontWeight: "500" },
    { tag: [t.controlKeyword, t.moduleKeyword], color: v.kw, fontWeight: "600" },
    { tag: [t.definition(t.variableName), t.function(t.variableName), t.labelName], color: "var(--text)", fontWeight: "500" },
    { tag: [t.constant(t.name), t.standard(t.name), t.number, t.bool], color: v.num },
    { tag: [t.definition(t.typeName), t.typeName, t.className], color: v.typ },
    { tag: t.operator, color: v.typ },
    { tag: [t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: v.num },
    { tag: [t.string, t.special(t.string)], color: v.str },
    { tag: [t.meta, t.comment], color: v.com, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: v.kw, textDecoration: "underline" },
    { tag: t.heading, color: v.head, fontWeight: "650" },
    { tag: t.invalid, color: "var(--accent)" },
  ]);
}

/** Re-point a state's language after a rename (Save As) without rebuilding
 * the state, so undo history, cursor, and scroll all survive. Only a change
 * in markdown-ness reconfigures; other renames keep the current language
 * (async re-detection would cost the state). */
export function reconfigureLanguage(state: EditorState, oldPath: string, newPath: string): EditorState {
  const wasMd = isMarkdownPath(oldPath);
  const isMd = isMarkdownPath(newPath);
  if (wasMd === isMd) return state;
  const lang = isMd ? markdownLanguage() : [];
  return state.update({ effects: langComp.reconfigure(lang) }).state;
}

export { EditorView };
