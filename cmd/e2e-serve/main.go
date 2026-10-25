// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

// Command e2e-serve is a test harness, NOT part of the shipped application.
//
// It serves the built frontend and exposes the real App methods over JSON so
// end-to-end tests can drive the actual editor UI against the actual Go
// file-integrity core — headlessly, on any OS, without a webview or display.
// Bound listens on loopback only.
//
//		go run ./cmd/e2e-serve -dist frontend/dist -home /tmp/e2e-home
//		open "http://127.0.0.1:34115/?e2e=1"
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/xtracsys/xtracsys-editor/internal/app"
	"github.com/xtracsys/xtracsys-editor/internal/localimg"
	"github.com/xtracsys/xtracsys-editor/internal/settings"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:34115", "loopback listen address")
	dist := flag.String("dist", "frontend/dist", "built frontend directory")
	home := flag.String("home", "", "redirect the OS config dir (hermetic settings)")
	flag.Parse()

	if *home != "" {
		abs, _ := filepath.Abs(*home)
		os.MkdirAll(abs, 0o700)
		os.Setenv("HOME", abs) // unix: UserConfigDir
		os.Setenv("APPDATA", filepath.Join(abs, "AppData"))
		os.Setenv("XDG_CONFIG_HOME", filepath.Join(abs, ".config"))
	}

	appSvc := app.NewApp()
	broadcaster := newHub()
	appSvc.InitHeadless(context.Background(), broadcaster.broadcast)

	mux := http.NewServeMux()

	// Static frontend.
	static, err := fs.Sub(os.DirFS(*dist), ".")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(static)))

	// Sandboxed preview images — same handler as the desktop app.
	mux.Handle("/ximg/", &localimg.Handler{ResolveTab: appSvc.ResolveTabPath})

	// Events over SSE.
	mux.HandleFunc("/api/events", broadcaster.sse)

	// Method dispatch: POST /api/<Method> {"args": [...]}.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		method := r.URL.Path[len("/api/"):]
		var args []json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&struct {
			Args *[]json.RawMessage `json:"args"`
		}{Args: &args}); err != nil {
			http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
			return
		}
		result, apiErr := dispatch(appSvc, method, args)
		w.Header().Set("Content-Type", "application/json")
		if apiErr != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"error": apiErr.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"result": result})
	})

	log.Printf("e2e bridge listening on http://%s/?e2e=1", *addr)
	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

// dispatch mirrors the wails binding surface explicitly — no reflection.
func dispatch(a *app.App, method string, args []json.RawMessage) (interface{}, error) {
	dec := func(i int, v interface{}) error {
		if i >= len(args) {
			return fmt.Errorf("missing argument %d", i)
		}
		return json.Unmarshal(args[i], v)
	}
	ctx := context.Background()
	switch method {
	case "AppInfo":
		return a.AppInfo(), nil
	case "NewTab":
		return a.NewTab(), nil
	case "OpenPaths":
		var paths []string
		if err := dec(0, &paths); err != nil {
			return nil, err
		}
		return a.OpenPaths(paths), nil
	case "OpenPathReadOnly":
		var p string
		if err := dec(0, &p); err != nil {
			return nil, err
		}
		return a.OpenPathReadOnly(p), nil
	case "PickAndOpen":
		return a.PickAndOpen()
	case "PickSaveAsPath":
		var name string
		if err := dec(0, &name); err != nil {
			return nil, err
		}
		return a.PickSaveAsPath(name)
	case "SaveTab":
		var tabId, path, content string
		var eols []string
		var encoding string
		var overwrite bool
		if err := dec(0, &tabId); err != nil {
			return nil, err
		}
		if err := dec(1, &path); err != nil {
			return nil, err
		}
		if err := dec(2, &content); err != nil {
			return nil, err
		}
		if err := dec(3, &eols); err != nil {
			return nil, err
		}
		if err := dec(4, &encoding); err != nil {
			return nil, err
		}
		if err := dec(5, &overwrite); err != nil {
			return nil, err
		}
		return a.SaveTab(tabId, path, content, eols, encoding, overwrite), nil
	case "CloseTab":
		var id string
		if err := dec(0, &id); err != nil {
			return nil, err
		}
		a.CloseTab(id)
		return nil, nil
	case "SetDirty":
		var id string
		var dirty bool
		if err := dec(0, &id); err != nil {
			return nil, err
		}
		if err := dec(1, &dirty); err != nil {
			return nil, err
		}
		a.SetDirty(id, dirty)
		return nil, nil
	case "SetWindowTitle":
		var t string
		if err := dec(0, &t); err != nil {
			return nil, err
		}
		a.SetWindowTitle(t)
		return nil, nil
	case "GetSettings":
		s, err := a.GetSettings()
		return s, err
	case "PutSettings":
		var s settings.Settings
		if err := dec(0, &s); err != nil {
			return nil, err
		}
		return nil, a.PutSettings(s)
	case "OpenExternalURL":
		var u string
		if err := dec(0, &u); err != nil {
			return nil, err
		}
		return a.OpenExternalURL(u), nil
	case "QuitApp":
		a.QuitApp()
		return nil, nil
	case "_EmitMenuAction": // test hook: simulate a native menu click
		var action string
		if err := dec(0, &action); err != nil {
			return nil, err
		}
		a.EmitMenuAction(action)
		return nil, nil
	case "_EmitQuitRequest": // test hook: simulate the window close guard
		a.EmitQuitRequest()
		return nil, nil
	}
	_ = ctx
	return nil, fmt.Errorf("unknown method %q", method)
}

// hub broadcasts Go events to SSE subscribers.
type hub struct {
	mu   sync.Mutex
	subs []chan event
}

type event struct {
	Name string      `json:"name"`
	Data interface{} `json:"data"`
}

func newHub() *hub { return &hub{} }

func (h *hub) broadcast(name string, data interface{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, ch := range h.subs {
		select {
		case ch <- event{Name: name, Data: data}:
		default: // slow consumer drops rather than blocks
		}
	}
}

func (h *hub) sse(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	ch := make(chan event, 64)
	h.mu.Lock()
	h.subs = append(h.subs, ch)
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		for i, s := range h.subs {
			if s == ch {
				h.subs = append(h.subs[:i], h.subs[i+1:]...)
				break
			}
		}
		h.mu.Unlock()
	}()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, "event: hello\ndata: {}\n\n")
	fl.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-ch:
			payload, _ := json.Marshal(ev)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, payload)
			fl.Flush()
		}
	}
}
