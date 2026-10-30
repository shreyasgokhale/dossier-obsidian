import { expect, test } from "@playwright/test";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { PASSWORD, resetData, sql, FAKE_AI_PORT } from "../e2e/support";
const root = () => process.env.MARKDOWN_E2E_ROOT!;
const notePath = () => path.join(root(), "notes/frontmatter/empty-energy.md");
const screenshots = process.env.DOSSIER_SCREENSHOT_DIR ?? "docs/screenshots";
test("complete synthetic Markdown, resume and AI workflow", async ({
  page,
  context,
  request,
}) => {
  await resetData();
  await page.goto("/login");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, "dashboard.png"),
    fullPage: true,
  });
  await page.goto("/settings?section=markdown");
  await expect(
    page.getByRole("heading", { name: "Markdown integration", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Note to adopt")
    .selectOption("frontmatter/empty-energy.md");
  await page
    .getByLabel("Fill applicationDate", { exact: true })
    .fill("2026-10-01");
  await page
    .getByLabel("Fill followUpDate", { exact: true })
    .fill("2026-11-01");
  const original = await readFile(notePath(), "utf8");
  await page
    .getByRole("button", { name: "Review adoption", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm adoption and section mappings" }),
  ).toBeVisible();
  expect(await readFile(notePath(), "utf8")).toBe(original);
  await page.screenshot({
    path: path.join(screenshots, "markdown-adoption.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirm adoption and section mappings" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Adopted application" }),
  ).toBeVisible();
  const [adopted] = await sql<{ id: string }>(
    `SELECT id FROM "Application" WHERE company='Example Energy'`,
  );
  expect(adopted).toBeTruthy();
  expect(await readFile(notePath(), "utf8")).toContain("[[Energy research]]");
  await page.goto(`/applications/${adopted.id}`);
  await page
    .getByText("Application details and follow-up", { exact: true })
    .click();
  await page.getByLabel("Follow Up Date", { exact: true }).fill("2026-11-05");
  await page.getByRole("button", { name: "Save application details" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Application details saved" }),
  ).toBeVisible();
  await expect
    .poll(async () => await readFile(notePath(), "utf8"), { timeout: 25_000 })
    .toContain("2026-11-05");
  const beforeEdit = await readFile(notePath(), "utf8");
  await writeFile(
    notePath(),
    beforeEdit.replace("status: interview", "status: offer"),
  );
  await expect
    .poll(
      async () =>
        (
          await sql<{ status: string }>(
            `SELECT status FROM "Application" WHERE id=$1`,
            [adopted.id],
          )
        )[0].status,
      { timeout: 25_000 },
    )
    .toBe("OFFER");
  // Conflicting body edits preserve both versions until the user chooses.
  await sql(
    `UPDATE "Note" SET body='App conflict notes', "updatedAt"=now() WHERE id=(SELECT "noteId" FROM "MarkdownLink" WHERE "applicationId"=$1)`,
    [adopted.id],
  );
  const conflicting = await readFile(notePath(), "utf8");
  await writeFile(
    notePath(),
    conflicting.replace(
      "My notes, tasks and impressions.",
      "File conflict notes",
    ),
  );
  await page.goto("/settings?section=markdown");
  await page.getByRole("button", { name: "Reconcile now" }).click();
  const resolver = page.getByLabel(`Resolve ${adopted.id} body`);
  await expect(resolver).toBeVisible();
  await resolver.selectOption("file");
  await page.screenshot({
    path: path.join(screenshots, "markdown-conflict.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Resolve reviewed conflicts" })
    .click();
  await expect(resolver).toHaveCount(0);
  // Profile edits are staged; no file rewrite until the reviewed confirmation.
  await page.getByLabel("company", { exact: true }).fill("employer_name");
  await page.getByRole("button", { name: "Save draft and pause sync" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile staged" }),
  ).toBeVisible();
  const beforeReview = await readFile(notePath(), "utf8");
  await page
    .getByRole("button", { name: "Generate dry run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm reviewed profile changes" }),
  ).toBeVisible();
  expect(await readFile(notePath(), "utf8")).toBe(beforeReview);
  await page
    .getByRole("button", { name: "Confirm reviewed profile changes" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Reviewed profile activated" }),
  ).toBeVisible();
  expect(await readFile(notePath(), "utf8")).toContain("employer_name:");
  // Labeled notes are configured and adopted from Settings as well.
  await page.getByLabel("Format profile").selectOption("default-labels");
  await page.getByLabel("Note to adopt").selectOption("labeled/application.md");
  await page
    .getByRole("button", { name: "Review adoption", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm adoption and section mappings" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Adopted application" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview resume import" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm reviewed resume import" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm reviewed resume import" })
    .click();
  await expect
    .poll(
      async () =>
        (
          await sql<{ value: string }>(
            `SELECT value FROM "ProfileField" WHERE key='name'`,
          )
        )[0].value,
    )
    .toBe("Alex Example");
  await page.screenshot({
    path: path.join(screenshots, "resume-import.png"),
    fullPage: true,
  });
  // A fake-provider failure keeps input, retries, and continues with no browser attached.
  await request.post(`http://localhost:${FAKE_AI_PORT}/test/control`, {
    data: { failures: 20, delayMs: 1500 },
  });
  await page.goto("/new?fresh=1");
  const posting =
    "Ledgerly: Senior Product Designer, Payments. Figma and design systems.";
  await page.getByLabel("Job posting").fill(posting);
  await page.getByRole("button", { name: "Read the posting →" }).click();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const [failed] = await sql<{ id: string; input: { posting: string } }>(
    `SELECT id,input FROM "Job" WHERE type='read-posting' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  expect(failed.input.posting).toBe(posting);
  await request.post(`http://localhost:${FAKE_AI_PORT}/test/control`, {
    data: { failures: 0, delayMs: 1500 },
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.close();
  await expect
    .poll(
      async () =>
        (
          await sql<{ status: string }>(
            `SELECT status FROM "Job" WHERE id=$1`,
            [failed.id],
          )
        )[0].status,
      { timeout: 30_000 },
    )
    .toBe("DONE");
  const resumed = await context.newPage();
  await resumed.goto(`/new?resume=${failed.id}`);
  await expect(
    resumed.getByRole("heading", { name: "How you match" }),
  ).toBeVisible();
  await resumed.getByRole("button", { name: "Create application →" }).click();
  await resumed.waitForURL(/\/applications\/c/, { timeout: 30_000 });
  const createdId = resumed.url().split("/").pop()!;
  await expect(resumed.getByRole("article", { name: "Resume" })).toContainText(
    "Alex Example",
  );
  await resumed
    .getByRole("textbox", { name: "Ask for a change" })
    .fill("Make the summary shorter");
  await resumed
    .getByRole("textbox", { name: "Ask for a change" })
    .press("Enter");
  await expect(
    resumed
      .getByRole("log", { name: "Conversation" })
      .getByText("Done. I made the summary shorter."),
  ).toBeVisible({ timeout: 30_000 });
  await resumed.screenshot({
    path: path.join(screenshots, "application-document.png"),
    fullPage: true,
  });
  const response = await context.request.get(
    `/api/pdf?doc=resume&application=${createdId}`,
  );
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  await expect
    .poll(
      async () =>
        (
          await sql(`SELECT * FROM "MarkdownLink" WHERE "applicationId"=$1`, [
            createdId,
          ])
        ).length,
      { timeout: 25_000 },
    )
    .toBe(1);
  const [job] = await sql<{
    provenance: {
      provider: string;
      model: string;
      sourceProfile: { basics: { name: string } };
    }[];
  }>(
    `SELECT provenance FROM "Job" WHERE type='write-documents' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  expect(job.provenance[0]).toMatchObject({
    provider: "OPENAI",
    model: "fake-model",
    sourceProfile: { basics: { name: "Alex Example" } },
  });
  // Ordinary task retention must not discard the accepted draft's provenance.
  await sql(`DELETE FROM "Job" WHERE "applicationId"=$1`, [createdId]);
  const [accepted] = await sql<{ aiProvenance: { type: string; model: string }[] }>(
    `SELECT "aiProvenance" FROM "Application" WHERE id=$1`, [createdId],
  );
  expect(accepted.aiProvenance).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "write-documents", model: "fake-model" }),
    expect.objectContaining({ type: "refine", model: "fake-model" }),
  ]));
  const historyBefore = (
    await sql<{ count: string }>(
      `SELECT count(*) FROM "StatusEvent" WHERE "applicationId"=$1`,
      [adopted.id],
    )
  )[0].count;
  await rename(notePath(), path.join(root(), "notes/renamed-energy.md"));
  await expect
    .poll(
      async () =>
        (
          await sql<{ path: string }>(
            `SELECT path FROM "MarkdownLink" WHERE "applicationId"=$1`,
            [adopted.id],
          )
        )[0].path,
      { timeout: 25_000 },
    )
    .toBe("renamed-energy.md");
  expect(
    (
      await sql<{ count: string }>(
        `SELECT count(*) FROM "StatusEvent" WHERE "applicationId"=$1`,
        [adopted.id],
      )
    )[0].count,
  ).toBe(historyBefore);
});
