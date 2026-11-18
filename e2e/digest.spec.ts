import { expect, test } from "@playwright/test";
import { FAKE_AI_PORT, resetData, sql } from "./support";

test("configures, runs, reviews, saves, dismisses and starts an application from a synthetic daily digest", async ({
  page,
}) => {
  await resetData();
  await page.goto("/search-preferences");
  await page.getByLabel(/^Target roles/).fill("Product Designer");
  await page
    .getByLabel(/^Company boards/)
    .fill(
      "Demo Greenhouse Studio | greenhouse | demo\nDemo Ashby Tools | ashby | demo\nDemo unavailable board | lever | unavailable",
    );
  await page.getByLabel("Company career boards", { exact: false }).check();
  await page.getByLabel("Enable daily digest").check();
  await page.getByLabel("Hour in your Dossier time zone").fill("23");
  await page.getByRole("button", { name: "Save Search Preferences" }).click();
  await expect(
    page.getByText("Search Preferences saved.", { exact: true }),
  ).toBeVisible();
  // This case uses the OpenAI-compatible configuration, so automatic drafting stays paused.
  await sql(
    `INSERT INTO "Setting" (key,value,"updatedAt") VALUES ('agentAutoDraft','true',now()) ON CONFLICT (key) DO UPDATE SET value='true'`,
  );
  const [before] = await sql<{ count: string }>(
    'SELECT count(*) FROM "Application"',
  );
  await page.goto("/digest");
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "DEMO — synthetic results" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(/4 strong matches, 1 stretch role/).first(),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByText("Source status", { exact: true }).click();
  await expect(
    page.getByText(/Demo unavailable board \(lever\)/),
  ).toBeVisible();
  const strong = page.getByRole("region", {
    name: "Strong matches",
    exact: true,
  });
  await expect(
    strong.getByRole("heading", {
      name: "Senior Product Designer",
      exact: true,
    }),
  ).toHaveCount(2);
  // Scope through the card's employer and nearest card container.
  const card = page
    .getByText("Demo Spree Tools", { exact: true })
    .locator("xpath=../..")
    .locator("xpath=..");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Saved", exact: true }),
  ).toBeDisabled();
  await card.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByText("Demo Spree Tools", { exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByText("Demo Spree Tools", { exact: true })).toHaveCount(
    0,
  );
  const [after] = await sql<{ count: string }>(
    'SELECT count(*) FROM "Application"',
  );
  expect(after.count).toBe(before.count);
  expect(
    await sql(`SELECT id FROM "Job" WHERE type='agent-draft'`),
  ).toHaveLength(0);
  expect(
    await sql(
      `SELECT id FROM "AgentCandidate" WHERE company='Demo Spree Tools'`,
    ),
  ).toHaveLength(1);
  await strong
    .getByRole("button", { name: "Start application", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/new/);
  await expect(page.getByLabel("Job posting")).not.toHaveValue("");
  expect(
    (await sql<{ count: string }>('SELECT count(*) FROM "Application"'))[0]
      .count,
  ).toBe(before.count);
  await page.getByRole("button", { name: "Read the posting →" }).click();
  await expect(
    page.getByRole("heading", { name: "How you match" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create application →" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });
  await page.goto("/digest");
  expect(
    (await sql<{ count: string }>('SELECT count(*) FROM "Application"'))[0]
      .count,
  ).toBe(String(Number(before.count) + 1));
  // A later run must not resurface dismissed, seen or pursued roles.
  await sql(`DELETE FROM "Setting" WHERE key='agentRuns'`);
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await sql<{ count: string }>('SELECT count(*) FROM "DailyDigest"'))[0]
          .count,
    )
    .toBe("2");
  await expect(
    page.getByText(/0 strong matches, 0 stretch roles/).first(),
  ).toBeVisible({ timeout: 30_000 });
  expect(await sql(`SELECT id FROM "AgentCandidate"`)).toHaveLength(5);
  // Avoid leaking new preference mode to the older agent specs.
  await resetData();
});

test("reviews a prepared CV and cover letter from the digest and keeps them as a draft", async ({ page }) => {
  await resetData();
  try {
    await sql(
      `INSERT INTO "Setting" (key,value,"updatedAt")
       VALUES ('agentAutoDraft','true',now()), ('agentMaxDrafts','1',now()),
              ('provider','LOCAL',now()), ('baseUrl',$1,now()), ('model','fake-model',now()),
              ('pageLimit','none',now())
       ON CONFLICT (key) DO UPDATE SET value=excluded.value`,
      [`http://localhost:${FAKE_AI_PORT}`],
    );
    await page.goto("/search-preferences");
    const health = await page.request.get("/api/health");
    expect(health.ok()).toBe(true);
    expect(await health.json()).toMatchObject({ status: "ok", db: "ok" });
    await page.getByLabel(/^Target roles/).fill("Product Designer");
    await page.getByLabel("Enable daily digest").check();
    await page.getByLabel("Hour in your Dossier time zone").fill("23");
    await page.getByRole("button", { name: "Save Search Preferences" }).click();
    await expect(page.getByText("Search Preferences saved.", { exact: true })).toBeVisible();

    await page.goto("/digest");
    await page.getByRole("button", { name: "Run now", exact: true }).click();
    const review = page.getByRole("link", { name: "Review CV and cover letter" });
    await expect(review).toHaveCount(1, { timeout: 30_000 });
    await review.click();
    await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
    await page.getByRole("tab", { name: "Cover letter" }).click();
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const pdf = await page.request.get(`/api/pdf?doc=letter&application=${id}`);
    expect(pdf.ok()).toBe(true);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    await page.goto("/digest");
    await page.getByRole("button", { name: "Keep as application draft" }).click();
    await expect(page).toHaveURL(`/applications/${id}`);
    expect(await sql('SELECT status, "awaitingReview", "sentAt" FROM "Application" WHERE id=$1', [id]))
      .toEqual([{ status: "DRAFT", awaitingReview: false, sentAt: null }]);
    await page.goto("/digest");
    await expect(review).toHaveCount(0);
  } finally {
    await resetData();
  }
});
