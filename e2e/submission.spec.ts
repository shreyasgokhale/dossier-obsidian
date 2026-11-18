import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

test("records a manual submission, then downloads the exact files sent", async ({ page, browser }) => {
  await resetData();
  await sql(`INSERT INTO "Application" (id, title, company, role, "updatedAt")
    VALUES ('manual-submission', 'Example application', 'Northwind', 'Engineer', now())`);
  await page.goto("/applications/manual-submission");
  await page.getByRole("link", { name: "Record submission" }).click();

  await page.getByLabel("Submitted at (local time)").fill("2026-10-01T13:42");
  const data = Buffer.from([0, 1, 2, 3, 250, 255]);
  await page.getByLabel("Submitted files").setInputFiles({ name: "sent.pdf", mimeType: "application/pdf", buffer: data });
  await page.getByLabel("Confirmation or receipt").fill("Portal receipt 42");
  await page.getByRole("button", { name: "Confirm submission" }).click();

  await expect(page.getByText("Portal receipt 42")).toBeVisible();
  const path = await page.getByRole("link", { name: "sent.pdf" }).getAttribute("href");
  if (!path) throw new Error("Missing private artifact download");
  expect(await (await page.request.get(path)).body()).toEqual(data);
  const signedOut = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: new URL(page.url()).origin });
  try {
    expect((await signedOut.request.get(path, { maxRedirects: 0 })).ok()).toBe(false);
  } finally {
    await signedOut.close();
  }

  await page.getByRole("link", { name: "Back to application" }).click();
  await expect(page.getByRole("button", { name: "Status: Sent" })).toBeVisible();
});
