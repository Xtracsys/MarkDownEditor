// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package app

import (
	"os"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const recentActionPrefix = "open-recent\x1f"

// BuildMenu constructs the native application menu, including the current
// recent-files list. Rebuilt and reinstalled via rebuildMenu whenever the
// recent list changes.
func (a *App) BuildMenu() *menu.Menu {
	isDarwin := goruntime.GOOS == "darwin"
	m := menu.NewMenu()

	if isDarwin {
		m.Append(&menu.MenuItem{Role: menu.AppMenuRole})
	}

	cb := func(action string) menu.Callback {
		return func(*menu.CallbackData) { a.EmitMenuAction(action) }
	}

	fileMenu := m.AddSubmenu("File")
	fileMenu.AddText("New Tab", keys.CmdOrCtrl("n"), cb("new-tab"))
	fileMenu.AddText("Open…", keys.CmdOrCtrl("o"), cb("open"))

	recentMenu := fileMenu.AddSubmenu("Open Recent")
	recents := a.GetRecentFiles()
	if len(recents) == 0 {
		noRecent := recentMenu.AddText("No Recent Files", nil, cb(""))
		noRecent.Disabled = true
	} else {
		for _, p := range recents {
			item := recentMenu.AddText(p, nil, cb(recentActionPrefix+p))
			if _, err := os.Stat(p); err != nil {
				item.Disabled = true
			}
		}
		recentMenu.AddSeparator()
		recentMenu.AddText("Clear Menu", nil, cb("clear-recent"))
	}

	fileMenu.AddSeparator()
	fileMenu.AddText("Save", keys.CmdOrCtrl("s"), cb("save"))
	fileMenu.AddText("Save As…",
		&keys.Accelerator{Key: "s", Modifiers: []keys.Modifier{keys.CmdOrCtrlKey, keys.ShiftKey}},
		cb("save-as"))
	fileMenu.AddSeparator()
	fileMenu.AddText("Print…", keys.CmdOrCtrl("p"), cb("print"))
	fileMenu.AddSeparator()

	convertMenu := fileMenu.AddSubmenu("Convert")
	convertMenu.AddText("Convert to UTF-8", nil, cb("convert-utf8"))
	convertMenu.AddText("Normalize Line Endings", nil, cb("normalize-eol"))

	fileMenu.AddSeparator()
	fileMenu.AddText("Close Tab", keys.CmdOrCtrl("w"), cb("close-tab"))
	if !isDarwin {
		fileMenu.AddSeparator()
		fileMenu.AddText("Exit", keys.CmdOrCtrl("q"), cb("quit"))
	}

	if isDarwin {
		// The Edit role menu provides native clipboard accelerators.
		m.Append(&menu.MenuItem{Role: menu.EditMenuRole})
	}

	viewMenu := m.AddSubmenu("View")
	viewMenu.AddText("Source Mode", keys.OptionOrAlt("1"), cb("mode-source"))
	viewMenu.AddText("Split Mode", keys.OptionOrAlt("2"), cb("mode-split"))
	viewMenu.AddText("Preview Mode", keys.OptionOrAlt("3"), cb("mode-preview"))
	viewMenu.AddSeparator()
	viewMenu.AddText("Toggle Outline", keys.OptionOrAlt("o"), cb("toggle-outline"))
	viewMenu.AddText("Toggle Word Wrap", keys.OptionOrAlt("z"), cb("toggle-wrap"))
	viewMenu.AddSeparator()
	viewMenu.AddText("Light Theme", nil, cb("theme-light"))
	viewMenu.AddText("Dark Theme", nil, cb("theme-dark"))
	viewMenu.AddText("Follow System Theme", nil, cb("theme-system"))

	helpMenu := m.AddSubmenu("Help")
	helpMenu.AddText("Keyboard Shortcuts", nil, cb("help-shortcuts"))
	helpMenu.AddText("Settings", keys.CmdOrCtrl(","), cb("settings"))
	helpMenu.AddText("About Xtracsys Editor", nil, cb("about"))

	if isDarwin {
		m.Append(&menu.MenuItem{Role: menu.WindowMenuRole})
	}
	return m
}

// rebuildMenu reinstalls the application menu (recent files changed). Safe
// to call before Startup (no-op without a webview context).
func (a *App) rebuildMenu() {
	if a.ctx == nil {
		return
	}
	wailsruntime.MenuSetApplicationMenu(a.ctx, a.BuildMenu())
}

