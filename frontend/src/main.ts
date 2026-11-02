// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

import "./styles/base.css";
import { createBackend } from "./ipc";
import { Application } from "./app";

const app = new Application(createBackend());
const ready = app.start();

// E2E hook: in bridge mode (?e2e=1) expose the controller and its startup
// promise so Playwright waits for session restore and startup work to finish.
// Never present in the desktop app.
if (new URLSearchParams(window.location.search).has("e2e")) {
  (window as unknown as Record<string, unknown>).__xe = { app, ready };
}
