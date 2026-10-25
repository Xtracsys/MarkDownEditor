// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys

import { defineConfig } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const port = 34120;
const home = resolve(__dirname, "tests/e2e/.home");

// Clean the hermetic settings home before a run.
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 0,
  workers: 1, // the bridge holds shared per-tab state; serialize tests
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 840 },
  },
  webServer: {
    command: `go run ./cmd/e2e-serve -addr 127.0.0.1:${port} -dist frontend/dist -home ${home}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
