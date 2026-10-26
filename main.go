// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package main

import (
	"context"
	"embed"
	"os"
	goruntime "runtime"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/xtracsys/xtracsys-editor/internal/app"
	"github.com/xtracsys/xtracsys-editor/internal/localimg"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	appSvc := app.NewApp()

	// Documents passed on the command line (Windows/Linux "Open With",
	// `xtracsys-editor file.txt`, and drag-onto-Dock-icon on some setups).
	// macOS Finder opens arrive separately as Apple Events (Mac.OnFileOpen
	// below); both flow through the same queued external-open pipeline.
	appSvc.QueueExternalOpen(fileArgs(os.Args[1:]))

	imageHandler := &localimg.Handler{ResolveTab: appSvc.ResolveTabPath}

	err := wails.Run(&options.App{
		Title:            "Xtracsys Editor",
		Width:            1200,
		Height:           800,
		MinWidth:         720,
		MinHeight:        480,
		BackgroundColour: &options.RGBA{R: 246, G: 245, B: 241, A: 1}, // warm white #F6F5F1
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: imageHandler,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:      true,
			DisableWebViewDrop:  true, // the webview must never navigate to dropped files
			CSSDropProperty:     "--wails-drop-target",
			CSSDropValue:        "drop",
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "editors.xtracsys.xtracsys-editor",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				// Windows/Linux: a second `open file.exe` launch hands its
				// arguments to this instance and exits.
				appSvc.QueueExternalOpen(fileArgs(data.Args))
			},
		},
		Menu:      buildMenu(appSvc),
		OnStartup: appSvc.Startup,
		OnBeforeClose: func(ctx context.Context) bool {
			return appSvc.BeforeClose(ctx)
		},
		OnShutdown: func(ctx context.Context) {
			appSvc.Shutdown(ctx)
		},
		Bind: []interface{}{appSvc},
		Mac: &mac.Options{
			OnFileOpen: appSvc.QueueExternalOpenOne,
			About: &mac.AboutInfo{
				Title:   "Xtracsys Editor",
				Message: "A local-first text and Markdown editor.\nVersion " + app.AppVersion + "\nCopyright 2026 Xtracsys — Apache License 2.0",
			},
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}

// fileArgs extracts document paths from launch arguments: skips flags and
// empties so `-psn_*`-style launch noise never becomes a document.
func fileArgs(args []string) []string {
	out := make([]string, 0, len(args))
	for _, a := range args {
		a = strings.TrimSpace(a)
		if a == "" || strings.HasPrefix(a, "-") {
			continue
		}
		out = append(out, a)
	}
	return out
}

// buildMenu creates the native menu. macOS gets the standard App and Edit
// role menus (the Edit role is what makes ⌘C/⌘V/⌘A work in WKWebView); every
// app-specific item emits an action the frontend handles exactly like its own
// keyboard shortcuts.
func buildMenu(appSvc *app.App) *menu.Menu {
	isDarwin := goruntime.GOOS == "darwin"
	m := menu.NewMenu()

	if isDarwin {
		m.Append(&menu.MenuItem{Role: menu.AppMenuRole})
	}

	cb := func(action string) menu.Callback {
		return func(*menu.CallbackData) { appSvc.EmitMenuAction(action) }
	}

	fileMenu := m.AddSubmenu("File")
	fileMenu.AddText("New Tab", keys.CmdOrCtrl("n"), cb("new-tab"))
	fileMenu.AddText("Open…", keys.CmdOrCtrl("o"), cb("open"))
	fileMenu.AddSeparator()
	fileMenu.AddText("Save", keys.CmdOrCtrl("s"), cb("save"))
	fileMenu.AddText("Save As…",
		&keys.Accelerator{Key: "s", Modifiers: []keys.Modifier{keys.CmdOrCtrlKey, keys.ShiftKey}},
		cb("save-as"))
	fileMenu.AddSeparator()
	fileMenu.AddText("Close Tab", keys.CmdOrCtrl("w"), cb("close-tab"))
	if !isDarwin {
		fileMenu.AddSeparator()
		fileMenu.AddText("Exit", keys.CmdOrCtrl("q"), cb("quit"))
	}

	if isDarwin {
		// The Edit role menu provides native clipboard accelerators to the
		// webview (Copy/Paste/SelectAll and friends).
		m.Append(&menu.MenuItem{Role: menu.EditMenuRole})
	}

	viewMenu := m.AddSubmenu("View")
	viewMenu.AddText("Source Mode", keys.OptionOrAlt("1"), cb("mode-source"))
	viewMenu.AddText("Split Mode", keys.OptionOrAlt("2"), cb("mode-split"))
	viewMenu.AddText("Preview Mode", keys.OptionOrAlt("3"), cb("mode-preview"))
	viewMenu.AddSeparator()
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
