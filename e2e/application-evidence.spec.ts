import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

test("keeps employer evidence and its correction, and restores exact recording bytes", async ({ page }) => {
  await resetData();
  await sql(`INSERT INTO "Application" (id, title, "updatedAt") VALUES ('role', 'Example role', now())`);
  await page.goto("/applications/role");
  await page.getByRole("link", { name: "Follow-up evidence" }).click();

  await page.getByLabel("When it happened").fill("2026-10-01T13:42");
  await page.getByLabel("Evidence text").fill("The meeting is Friday.");
  await page.getByRole("button", { name: "Save evidence" }).click();
  await page.getByRole("link", { name: "Add correction" }).click();
  await page.getByLabel("Corrected evidence text").fill("The meeting is Thursday.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("link", { name: "Correction of earlier entry" })).toBeVisible();
  await expect(page.getByText("The meeting is Friday.")).toBeVisible();

  await page.getByLabel("Evidence type").selectOption("RECORDING");
  const data = Buffer.from([4, 3, 2, 1]);
  await page.getByLabel("Recording file").setInputFiles({ name: "interview.webm", mimeType: "audio/webm", buffer: data });
  await page.getByLabel("Transcript or context").fill("Synthetic transcript.");
  await page.getByRole("button", { name: "Save evidence" }).click();
  await expect(page.getByText("Synthetic transcript.")).toBeVisible();
  const path = await page.getByRole("link", { name: "interview.webm" }).getAttribute("href");
  if (!path) throw new Error("Missing private recording download");
  expect(await (await page.request.get(path)).body()).toEqual(data);
});
