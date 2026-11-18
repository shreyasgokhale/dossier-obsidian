import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { seedBuiltIns } from "../../../prisma/seed/built-ins";
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
import { approveCandidate } from "@/lib/agent/draft";
import { reconcile } from "@/lib/markdown/service";
import { exportObsidian, syncDocuments } from "@/lib/markdown/documents";
import { demoProfile } from "@/lib/demo-profile";
import type { FoundPosting } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { MockProvider } from "@/lib/ai/providers/mock";
const state = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestClient> | undefined,
  calls: [] as string[],
  fail: false,
  failPreparation: false,
  allowedDraftUrl: undefined as string | undefined,
  serviceNotesRoot: undefined as string | undefined,
}));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  state.db = createTestClient();
  return { prisma: state.db };
});
vi.mock("./search", () => ({ discover: vi.fn() }));
vi.mock("@/lib/env", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@/lib/env")>();
  return {
    env: new Proxy(env, {
      get: (target, key) => {
        if (key === "DOSSIER_DIGEST_DRAFT_AI_URL") return state.allowedDraftUrl;
        if (key === "DOSSIER_SERVICE_NOTES_ROOT") return state.serviceNotesRoot;
        return Reflect.get(target, key);
      },
    }),
  };
});
vi.mock("@/lib/ai/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/config")>()),
  isAiConfigured: async () => true,
}));
vi.mock("@/lib/profile-data", async () => ({
  loadProfile: async () => demoProfile(),
}));
vi.mock("@/lib/ai", () => ({
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        const text = call.messages[0].content;
        state.calls.push(text);
        switch (call.json?.name) {
          case "extracted_posting":
            return {
              title: "Product Designer · Demo a",
              company: "Demo a",
              role: "Product Designer",
              location: "Berlin",
              mode: "",
              salary: "",
              deadline: null,
              requirements: [{ text: "Figma experience", kind: "skill", skill: "Figma", years: null, language: null }],
              asksForReferences: false,
              language: "English",
            };
          case "requirement_matches":
            return { matches: [{ requirement: 1, skill: "Figma", language: null }] };
          case "tailored_resume":
            if (state.failPreparation) return "invalid json";
            return { summary: "Product designer.", roles: [], projects: [], skills: ["Figma"], education: [] };
          case "cover_letter":
            return { recipient: "Hiring team", greeting: "Dear hiring team,", paragraphs: [{ label: "Opening", text: "I design complex products." }], signOff: "Regards," };
        }
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
  state.failPreparation = false;
  state.allowedDraftUrl = undefined;
  state.serviceNotesRoot = undefined;
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
afterEach(() => vi.unstubAllEnvs());
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
async function enableLocalDrafts() {
  await seedBuiltIns(db());
  await saveSettings({
    provider: "LOCAL",
    baseUrl: "http://synthetic-ai.example",
    model: "synthetic",
    pageLimit: "none",
    agentMaxDrafts: 1,
  });
  vi.stubEnv("DOSSIER_PASSWORD", "argon2id:m=19456,t=2,p=1:CLZW5wQoCjh3Q9CHBp_JWw:Ak2xS7TYlYYrhemlgBkVxFmWXfcMq_rjd0mJGZcZFfA");
  vi.stubEnv("DOSSIER_SECRET", "s".repeat(40));
  state.allowedDraftUrl = "http://synthetic-ai.example";
}

it("makes a prepared strong match available for review without submitting it", async () => {
  await enableLocalDrafts();
  expect(await runDailyDigest(true, context(), now)).toMatchObject({
    scored: 3,
    drafted: 1,
  });
  const items = (await loadDigestView()).digest?.items;
  const strong = items?.find((item) => item.kind === "strong");
  expect(strong).toMatchObject({
    preparation: { status: "DRAFTED", error: null, applicationId: expect.any(String) },
    state: { applicationId: null },
  });
  expect(items?.filter((item) => item.preparation.applicationId)).toHaveLength(1);
  const prepared = await db().application.findUniqueOrThrow({
    where: { id: strong!.preparation.applicationId! },
    include: { documents: true },
  });
  expect(prepared).toMatchObject({ status: "DRAFT", awaitingReview: true, sentAt: null });
  expect(prepared.documents.map((document) => document.kind).sort()).toEqual(["COVER_LETTER", "RESUME"]);
  expect(await runDailyDigest(true, context(), new Date(now.getTime() + 3600001))).toMatchObject({ drafted: 0 });
  expect((await loadDigestView()).digest?.items).toContainEqual(expect.objectContaining({
    id: strong?.id,
    preparation: expect.objectContaining({ applicationId: prepared.id }),
  }));
});

it("retries a failed preparation on a later digest without scoring the same role again", async () => {
  await enableLocalDrafts();
  state.failPreparation = true;
  expect(await runDailyDigest(true, context(), now)).toMatchObject({ drafted: 0, scored: 3 });
  const failed = (await loadDigestView()).digest?.items.find((item) => item.kind === "strong");
  expect(failed?.preparation).toMatchObject({ status: "SCORED", error: expect.any(String), applicationId: null });

  state.failPreparation = false;
  const retry = new Date(now.getTime() + 3600001);
  expect(await runDailyDigest(true, context(), retry)).toMatchObject({ drafted: 1, scored: 0 });
  expect((await loadDigestView()).digest?.items[0]).toMatchObject({
    id: failed?.id,
    preparation: { status: "DRAFTED", error: null, applicationId: expect.any(String) },
  });
});

it("leaves queued roles alone when the owner has already pursued them through another source", async () => {
  await runDailyDigest(true, context(), now);
  await enableLocalDrafts();
  await db().application.create({
    data: { company: "Demo a", role: "Product Designer", postingUrl: "https://other.example/alternate-role" },
  });
  const retry = new Date(now.getTime() + 3600001);
  expect(await runDailyDigest(true, context(), retry)).toMatchObject({ drafted: 0, scored: 0 });
  expect(await db().application.count()).toBe(1);
});

it("does not sync a linked digest package after the writable notes root is retargeted", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "dossier-projection-"));
  try {
    const notes = join(runtime, "notes");
    const data = join(runtime, "data");
    const other = join(runtime, "retargeted");
    await Promise.all([mkdir(notes), mkdir(data)]);
    vi.stubEnv("DOSSIER_NOTES_ROOT", notes);
    vi.stubEnv("DOSSIER_DATA_DIR", data);
    vi.stubEnv("DOSSIER_SERVICE_NOTES_ROOT", notes);
    state.serviceNotesRoot = notes;
    await enableLocalDrafts();
    await runDailyDigest(true, context(), now);
    const prepared = (await loadDigestView()).digest?.items.find((item) => item.preparation.applicationId);
    const applicationId = await approveCandidate(prepared!.id);
    await reconcile();
    await syncDocuments();
    await exportObsidian();
    const file = join("Dossier", "Views", `${applicationId}.md`);
    const previous = await readFile(join(notes, file), "utf8");
    expect(previous).toContain("Demo a");
    await cp(notes, other, { recursive: true });

    vi.stubEnv("DOSSIER_NOTES_ROOT", other);
    await db().application.update({ where: { id: applicationId }, data: { company: "Do not export here" } });
    await reconcile();
    await syncDocuments();
    await exportObsidian();
    expect(await readFile(join(other, file), "utf8")).toBe(previous);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
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
