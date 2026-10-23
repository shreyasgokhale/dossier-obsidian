import { mkdtempSync, cpSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import upstream from "./playwright.config";
const fresh = !process.env.MARKDOWN_E2E_ROOT;
const root =
  process.env.MARKDOWN_E2E_ROOT ??
  mkdtempSync(path.join(os.tmpdir(), "dossier-markdown-e2e-"));
process.env.MARKDOWN_E2E_ROOT = root;
if (fresh) {
  cpSync("fixtures/notes", path.join(root, "notes"), { recursive: true });
  cpSync("fixtures/resume", path.join(root, "resume"), { recursive: true });
  mkdirSync(path.join(root, "data"));
}
const base = new URL(
  process.env.E2E_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/dossier",
);
base.pathname = "/dossier_markdown_e2e";
process.env.E2E_DATABASE_URL = base.toString();
const integrationEnv = {
  DATABASE_URL: base.toString(),
  DOSSIER_NOTES_ROOT: path.join(root, "notes"),
  DOSSIER_RESUME_ROOT: path.join(root, "resume"),
  DOSSIER_DATA_DIR: path.join(root, "data"),
  DOSSIER_OBSIDIAN_VAULT: "Dossier Demo",
  DOSSIER_PUBLIC_URL: "http://localhost:3100",
};
export default defineConfig({
  ...upstream,
  testDir: "e2e-markdown",
  timeout: 180_000,
  projects: [
    {
      name: "markdown",
      use: { browserName: "chromium", viewport: { width: 1400, height: 900 } },
    },
  ],
  webServer: (Array.isArray(upstream.webServer) ? upstream.webServer : []).map(
    (server) =>
      server.command.includes("standalone/server.js")
        ? {
            ...server,
            command: process.env.DOSSIER_TEST_IMAGE
              ? "yarn tsx scripts/run-image-e2e.mts"
              : server.command,
            env: { ...server.env, ...integrationEnv },
          }
        : server,
  ),
});
