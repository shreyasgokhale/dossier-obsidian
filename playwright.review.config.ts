import { defineConfig } from "@playwright/test";
import markdown from "./playwright.markdown.config";
// Compose already runs the production image and all fake services in the same
// isolated network namespace. Never launch Docker or mount a socket in tests.
export default defineConfig({
  ...markdown,
  webServer: [],
  use: { ...markdown.use, baseURL: "http://127.0.0.1:3000" },
  reporter: [["list"]],
  outputDir: "/review/reports/production/results",
});
