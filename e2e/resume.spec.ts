import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";

import { resetData } from "./support";

// The theme builder (E5) and the PDF download (E5-5).
test.beforeAll(resetData);

test("uses the website print layout by default in the resume preview and PDF", async ({ page }) => {
  await page.goto("/resume");
  await expect(page.getByRole("button", { name: "Portfolio theme, in use" })).toBeVisible();
  const resume = page.getByRole("article", { name: "Resume" });
  await expect(resume.getByRole("heading", { level: 2 }).first()).toHaveText("Skills");
  await expect(resume.getByRole("link", { name: "jane.doe@example.com" })).toHaveAttribute("href", "mailto:jane.doe@example.com");

  const response = await page.request.get("/api/pdf?doc=base");
  expect(response.ok()).toBe(true);
  const pdf = await getDocumentProxy(new Uint8Array(await response.body()));
  const { text } = await extractText(pdf, { mergePages: true });
  const headings = ["SKILLS", "WORK EXPERIENCE", "EDUCATION", "LANGUAGES"];
  const positions = headings.map((heading) => text.indexOf(heading));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual(positions.toSorted((a, b) => a - b));
  const firstPage = await pdf.getPage(1);
  const { width, height } = firstPage.getViewport({ scale: 1 });
  expect(Math.abs(width - 595.28)).toBeLessThan(1);
  expect(Math.abs(height - 841.89)).toBeLessThan(1);
});

test("builds a theme, makes it the base theme and downloads the resume as a PDF", async ({ page }) => {
  await page.goto("/resume");
  await page.getByRole("button", { name: /Make your own theme/ }).click();
  await page.getByRole("radiogroup", { name: "Accent" }).getByRole("radio", { name: "Green" }).click();
  await page.getByRole("radiogroup", { name: "Spacing" }).getByRole("radio", { name: "Compact" }).click();
  await page.getByLabel("Theme name").fill("Quiet green");
  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page.getByRole("button", { name: "Quiet green theme, in use" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Quiet green theme, in use" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download PDF" }).click()]);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  // Chromium's headless shell names every blob download "download", so the name is checked at the source.
  const response = await page.request.get("/api/pdf?doc=base");
  expect(response.headers()["content-disposition"]).toContain("filename*=UTF-8''Jane%20Doe%20%E2%80%93%20Resume.pdf");
});
