import { beforeEach, afterAll, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { saveSettings } from "@/lib/settings-data";
import { DEFAULT_PREFERENCES } from "./preferences";
import {
  runDailyDigest,
  unseenDigestPostings,
  recoverInterruptedDigests,
} from "./run";
import { discover } from "./search";
import { loadDigestView } from "./view";
import { buildExport } from "@/lib/data-export";
import { importExport, parseExport } from "@/lib/data-import";
import { demoProfile } from "@/lib/demo-profile";
import type { FoundPosting } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { MockProvider } from "@/lib/ai/providers/mock";
const state = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestClient> | undefined,
  calls: [] as string[],
  fail: false,
}));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  state.db = createTestClient();
  return { prisma: state.db };
});
vi.mock("./search", () => ({ discover: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/profile-data", async () => ({
  loadProfile: async () => demoProfile(),
}));
vi.mock("@/lib/ai", () => ({
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        const text = call.messages[0].content;
        state.calls.push(text);
        if (state.fail && text.includes('"title": "Broken"'))
          return "invalid json";
        return {
          score: text.includes('"title": "Stretch"')
            ? 62
            : text.includes('"title": "Poor"')
              ? 20
              : 90,
          reasons: ["Figma and complex product design experience matches."],
          redFlags: [],
        };
      },
    }),
}));
const db = () => state.db!;
const now = new Date("2026-10-31T08:00:00Z");
const context = (): JobContext => ({
  id: "digest-test-job",
  signal: new AbortController().signal,
  step: vi.fn(async () => {}),
});
const job = (id: string, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "ARBEITNOW",
  externalId: id,
  title: "Product Designer",
  company: `Demo ${id}`,
  place: "Berlin",
  url: `https://jobs.example/${id}`,
  via: "",
  remote: null,
  salary: "",
  postedAt: null,
  description: "Figma",
  complete: true,
  ...extra,
});
beforeEach(async () => {
  await resetDatabase(db());
  state.calls = [];
  state.fail = false;
  await saveSettings({
    searchPreferences: { ...DEFAULT_PREFERENCES, roles: ["Product Designer"] },
    agentEnabled: true,
    agentAutoDraft: true,
  });
  vi.mocked(discover).mockResolvedValue({
    postings: [
      job("a"),
      job("b", { title: "Stretch" }),
      job("c", { title: "Poor" }),
    ],
    sources: [
      { source: "Arbeitnow", status: "ok", count: 3, message: "" },
      {
        source: "Unavailable board",
        status: "failed",
        count: 0,
        message: "Unavailable",
      },
    ],
  });
});
afterAll(async () => {
  await db().$disconnect();
});
it("persists strong/stretch/below results with unknowns despite source failure, without applications or drafts", async () => {
  const result = await runDailyDigest(true, context(), now);
  expect(result).toMatchObject({ found: 3, scored: 3, drafted: 0 });
  expect(await db().application.count()).toBe(0);
  expect(await db().job.count()).toBe(0);
  expect(await db().markdownLink.count()).toBe(0);
  const view = await loadDigestView();
  expect(view.digest?.items.map((i) => i.kind).sort()).toEqual([
    "below",
    "stretch",
    "strong",
  ]);
  expect(view.digest?.items[0].gaps).toContain(
    "Work arrangement is unknown; verify with the employer.",
  );
  expect(view.digest?.sources[1].status).toBe("failed");
  expect(state.calls[0]).toContain(
    "Search preferences (intent, never evidence of experience)",
  );
  expect(state.calls[0]).toContain('"roles":["Product Designer"]');
  const again = await runDailyDigest(
    true,
    context(),
    new Date(now.getTime() + 3600001),
  );
  expect(again.scored).toBe(0);
});
it("does not resurface saved, dismissed, pursued or cross-source duplicates", async () => {
  const saved = job("saved"),
    dismissed = job("dismissed"),
    applied = job("applied");
  await db().posting.create({
    data: { ...saved, postedAt: null, savedAt: now },
  });
  await db().posting.create({
    data: { ...dismissed, postedAt: null, dismissedAt: now },
  });
  await db().application.create({
    data: {
      company: applied.company,
      role: applied.title,
      postingUrl: applied.url,
    },
  });
  expect(
    await unseenDigestPostings([
      saved,
      {
        ...dismissed,
        source: "DAILY_BERLIN",
        externalId: "alias",
        url: "https://other.example/same-role",
      },
      { ...applied, url: `${applied.url}?utm_source=abc` },
      job("new"),
      {
        ...job("new"),
        source: "COMPANY_BOARDS",
        externalId: "another",
        url: "https://other.example/new",
      },
    ]),
  ).toEqual([job("new")]);
});
it("isolates scoring failures, respects the cap, and suppresses automatic document work", async () => {
  state.fail = true;
  await saveSettings({ agentMaxScores: 2 });
  vi.mocked(discover).mockResolvedValue({
    postings: [job("a", { title: "Broken" }), job("b"), job("c")],
    sources: [],
  });
  const result = await runDailyDigest(true, context(), now);
  expect(result.scored).toBe(1);
  expect(result.message).toContain("1 scoring failures");
  // The provider retries one invalid structured response; only two postings are attempted.
  expect(state.calls).toHaveLength(3);
  expect(await db().document.count()).toBe(0);
});
it("preserves digest history, identities and preferences through a versioned backup", async () => {
  await runDailyDigest(true, context(), now);
  const before = await loadDigestView();
  const file = await buildExport(db());
  const parsed = parseExport(JSON.stringify(file));
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.data.dailyDigests).toHaveLength(1);
  await importExport(db(), parsed.data);
  const after = await loadDigestView();
  const withoutScoreCache = (view: typeof before) => ({
    ...view,
    digest: view.digest
      ? {
          ...view.digest,
          items: view.digest.items.map((i) => ({
            ...i,
            state: { ...i.state, score: null },
          })),
        }
      : null,
  });
  expect(withoutScoreCache(after)).toEqual(withoutScoreCache(before));
  expect(
    await unseenDigestPostings([
      job("a", {
        source: "DAILY_BERLIN",
        externalId: "changed",
        url: "https://other.example/a",
      }),
    ]),
  ).toEqual([]);
});
it("records interrupted runs and keeps already scored candidates", async () => {
  vi.mocked(discover).mockRejectedValueOnce(new Error("interrupted"));
  await expect(runDailyDigest(true, context(), now)).rejects.toThrow(
    "interrupted",
  );
  expect((await db().dailyDigest.findFirst())?.message).toContain(
    "completed results are preserved",
  );
});
it("reflects save, dismissal and pursuit through alternate sources on existing digests", async () => {
  await runDailyDigest(true, context(), now);
  await db().posting.create({
    data: {
      ...job("a", {
        source: "DAILY_BERLIN",
        externalId: "alias",
        url: "https://other.example/alias",
      }),
      postedAt: null,
      savedAt: now,
    },
  });
  expect(
    (await loadDigestView()).digest?.items.find(
      (i) => i.posting.company === "Demo a",
    )?.state.saved,
  ).toBe(true);
  await db().posting.updateMany({ data: { dismissedAt: now } });
  expect(
    (await loadDigestView()).digest?.items.find(
      (i) => i.posting.company === "Demo a",
    )?.dismissed,
  ).toBe(true);
  await db().application.create({
    data: {
      company: "Demo b",
      role: "Stretch",
      postingUrl: "https://other.example/pursued",
    },
  });
  expect(
    (await loadDigestView()).digest?.items.find(
      (i) => i.posting.company === "Demo b",
    )?.state.applicationId,
  ).toBeTruthy();
});

it("recovers interrupted durable runs before scheduling without losing completed items", async () => {
  await runDailyDigest(true, context(), now);
  await db().dailyDigest.updateMany({ data: { finishedAt: null } });
  expect(await recoverInterruptedDigests()).toBe(1);
  expect((await db().dailyDigest.findFirst())?.message).toContain(
    "interrupted by a restart",
  );
  expect(await db().digestItem.count()).toBe(3);
  expect(await recoverInterruptedDigests()).toBe(0);
});
