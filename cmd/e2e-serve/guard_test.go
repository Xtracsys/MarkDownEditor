// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

package main

import (
	httptest "net/http/httptest"
	"testing"
)

func TestGuardRejectsCrossOrigin(t *testing.T) {
	cases := []struct {
		name   string
		origin string
		host   string
		ct     string
		want   int // 0 = allowed
	}{
		{"same-origin fetch", "", "127.0.0.1:34120", "application/json", 0},
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
