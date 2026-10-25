// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

import "./styles/base.css";
import { createBackend } from "./ipc";
import { Application } from "./app";

const app = new Application(createBackend());
void app.start();

// E2E hook: in bridge mode (?e2e=1) expose the controller so Playwright can
// drive the same flows the UI drives. Never present in the desktop app.
if (new URLSearchParams(window.location.search).has("e2e")) {
  (window as unknown as Record<string, unknown>).__xe = { app };
}
