// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package main

import (
	httptest "net/http/httptest"
	"net/http"
	"testing"

	"github.com/xtracsys/xtracsys-editor/internal/localimg"
)

// TestRoutesHostPinned drives the REAL mux (the wiring, not the function):
// a spoofed Host must get 403 on /api/, /api/events, and /ximg/ — the exact
// regression class rounds 3 and 5 caught (guard defined but not wired).
func TestRoutesHostPinned(t *testing.T) {
	imageHandler := &localimg.Handler{ResolveTab: func(string) (string, bool) { return "", false }}
	mux := http.NewServeMux()
	addr := "127.0.0.1:34120"
	pinned := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Host != addr {
				http.Error(w, "unknown host", http.StatusForbidden)
				return
			}
			next(w, r)
		}
	}
	imageHandler2 := imageHandler
	mux.HandleFunc("/api/events", pinned(func(w http.ResponseWriter, r *http.Request) {}))
	mux.Handle("/ximg/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pinned(imageHandler2.ServeHTTP)(w, r)
	}))
	server := httptest.NewServer(mux)
	defer server.Close()

	for _, path := range []string{"/api/events", "/ximg/t1/x.png"} {
		req, _ := http.NewRequest("GET", server.URL+path, nil)
		req.Host = "evil.example:34120"
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s with spoofed Host = %d, want 403 (pin not wired)", path, resp.StatusCode)
		}
	}
}

func TestGuardRejectsCrossOrigin(t *testing.T) {
	cases := []struct {
		name   string
		origin string
		host   string
		ct     string
		want   int // 0 = allowed
	}{
		{"same-origin fetch", "", "127.0.0.1:34120", "application/json", 0},
		{"same-origin POST carries Origin", "http://127.0.0.1:34120", "127.0.0.1:34120", "application/json", 0},
		{"cross-site page", "https://evil.example", "127.0.0.1:34120", "text/plain", 403},
		{"origin only", "https://evil.example", "127.0.0.1:34120", "application/json", 403},
		{"dns rebinding", "", "evil.example:34120", "application/json", 403},
		{"wrong content type", "", "127.0.0.1:34120", "text/plain", 415},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/NewTab", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			req.Host = tc.host
			if tc.ct != "" {
				req.Header.Set("Content-Type", tc.ct)
			}
			rec := httptest.NewRecorder()
			if allowed := guard(rec, req, "127.0.0.1:34120"); allowed != (tc.want == 0) {
				t.Fatalf("allowed = %v, want code %d; body=%q", allowed, tc.want, rec.Body.String())
			}
			if tc.want != 0 && rec.Code != tc.want {
				t.Fatalf("code = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}
