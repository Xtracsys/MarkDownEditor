// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

package main

import (
	"context"
	"embed"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
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
				// arguments to this instance and exits. Relative paths belong
				// to the second instance's working directory.
				args := make([]string, 0, len(data.Args))
				for _, a := range data.Args {
					if a == "" || filepath.IsAbs(a) || strings.HasPrefix(a, "-") {
						args = append(args, a)
						continue
					}
					args = append(args, filepath.Join(data.WorkingDirectory, a))
				}
				appSvc.QueueExternalOpen(fileArgs(args))
			},
		},
		Menu:      appSvc.BuildMenu(),
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
				Message: "A local-first text and Markdown editor.\nVersion " + app.AppVersion + "\nCopyright 2026 Xtracsys LLC — Apache License 2.0",
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
