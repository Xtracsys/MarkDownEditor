// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Xtracsys LLC

import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const port = 34120;
const here = __dirname;

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
    command: `XTRACSYS_EDITOR_DEBUG=1 go run ./cmd/e2e-serve -addr 127.0.0.1:${port} -dist frontend/dist -home ${resolve(here, "tests/e2e/.home")} -fresh-home`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
