import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { AiError } from "@/lib/ai/errors";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured, loadAiConfig } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import { candidateData } from "@/lib/agent/candidates";
import { draftCandidate } from "@/lib/agent/draft";
import { providerOption } from "@/lib/ai/provider-options";
import { jobSourceContext } from "@/lib/jobs/source-context";
import {
  recordRunStart,
  recordRunEnd,
  runLimitProblem,
} from "@/lib/agent/runs";
import type { AgentScanResult } from "@/lib/agent/run";
import {
  postingText,
  linkKey,
  type FoundPosting,
} from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { saveScore } from "@/lib/posting-scores";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { identityKeys } from "./identity";
import { discover } from "./search";
import type { SearchPreferences } from "./preferences";
export async function digestSetupProblem(
  p: SearchPreferences,
): Promise<string | null> {
  if (
    (
      await prisma.searchPreferenceSync.findUnique({
        where: { id: "preferences" },
      })
    )?.conflict
  )
    return "Resolve the conflict in Search Preferences before discovery runs.";
  if (!p.roles.length || !p.locations.length)
    return "Complete Search Preferences first.";
  if (!(await isAiConfigured()))
    return "Choose an AI provider in Settings → AI provider first.";
  return null;
}
export async function unseenDigestPostings<T extends Parameters<typeof identityKeys>[0]>(
  postings: T[],
  queuedCandidateIds: string[] = [],
): Promise<T[]> {
  const [candidates, stored, applications] = await Promise.all([
    prisma.agentCandidate.findMany({
      where: { id: { notIn: queuedCandidateIds } },
      select: { source: true, externalId: true, url: true, company: true, title: true, place: true, identityKeys: true },
    }),
    prisma.posting.findMany({
      where: {
        OR: [
          { savedAt: { not: null } },
          { dismissedAt: { not: null } },
          { applicationId: { not: null } },
        ],
      },
    }),
    prisma.application.findMany({
      select: { postingUrl: true, company: true, role: true },
    }),
  ]);
  const seen = new Set([
    ...candidates.flatMap((c) => [...c.identityKeys, ...identityKeys(c)]),
    ...stored.flatMap(identityKeys),
  ]);
  const appLinks = new Set(
    applications.map((a) => linkKey(a.postingUrl)).filter(Boolean),
  );
  for (const a of applications)
    if (a.company && a.role)
      identityKeys({
        source: "JSEARCH",
        externalId: "",
        url: a.postingUrl,
        company: a.company,
        title: a.role,
        place: "",
      })
        .slice(1)
        .forEach((key) => seen.add(key));
  return postings.filter((p) => {
    const keys = identityKeys(p),
      known =
        keys.some((key) => seen.has(key)) ||
        (p.url && appLinks.has(linkKey(p.url)));
    keys.forEach((key) => seen.add(key));
    return !known;
  });
}
async function prepareStrongMatches(
  digest: { id: string; demo: boolean },
  settings: SettingsData,
  context: JobContext,
  profile: Awaited<ReturnType<typeof loadProfile>>,
): Promise<{ drafted: number; summary: string }> {
  const idle = { drafted: 0, summary: "" };
  if (!settings.agentAutoDraft || settings.agentMaxDrafts === 0 || context.signal.aborted)
    return idle;
  const paused = {
    drafted: 0,
    summary: " Automatic preparation is paused until the configured local AI endpoint is approved for preparation.",
  };
  const allowedUrl = env.DOSSIER_DIGEST_DRAFT_AI_URL;
  if (!allowedUrl) return paused;
  const source = jobSourceContext.getStore();
  const config = source?.config ?? await loadAiConfig();
  if (!providerOption(config.provider).local || !config.model ||
      config.baseUrl.replace(/\/+$/, "") !== allowedUrl) return paused;

  const eligible = { status: "SCORED", complete: true, score: { gte: settings.agentMinScore } } as const;
  const identityFields = { id: true, source: true, externalId: true, url: true, company: true, title: true, place: true } as const;
  const [newMatches, backlog] = await Promise.all([
    prisma.agentCandidate.findMany({
      where: { ...eligible, digestItems: { some: { digestId: digest.id, kind: "strong" } } },
      orderBy: [{ score: "desc" }, { id: "asc" }],
      select: identityFields,
    }),
    prisma.agentCandidate.findMany({
      where: {
        ...eligible,
        AND: [
          { digestItems: { none: { digestId: digest.id } } },
          { digestItems: { some: {
            kind: "strong",
            digest: { demo: digest.demo, finishedAt: { not: null }, preferences: { equals: settings.searchPreferences! } },
          } } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: identityFields,
    }),
  ]);
  const queue = [...newMatches, ...backlog];
  if (!queue.length) return idle;
  const best = (await unseenDigestPostings(queue, queue.map(({ id }) => id))).slice(0, settings.agentMaxDrafts);
  if (!best.length) return idle;
  let drafted = 0;
  let failed = 0;
  for (const { id: candidateId } of best) {
    if (context.signal.aborted) break;
    await prisma.digestItem.upsert({
      where: { digestId_candidateId: { digestId: digest.id, candidateId } },
      create: { digestId: digest.id, candidateId, kind: "strong" },
      update: {},
    });
    try {
      // Pin the endpoint and profile for all calls in this package.
      await jobSourceContext.run(
        { ...source, config, profile, rejectAiRedirects: true },
        () => draftCandidate(candidateId, context, { partOfDigest: true }),
      );
      drafted++;
    } catch {
      if (!context.signal.aborted) failed++;
    }
  }
  return {
    drafted,
    summary: ` Prepared ${drafted} ${drafted === 1 ? "application draft" : "application drafts"}; ${failed} preparation failures. Automatic preparation uses complete postings only.`,
  };
}

export async function runDailyDigest(
  manual: boolean,
  context: JobContext,
  now = new Date(),
): Promise<AgentScanResult> {
  const settings = await loadSettings();
  const p = settings.searchPreferences!;
  const empty = (message: string): AgentScanResult => ({
    found: 0,
    fresh: 0,
    scored: 0,
    drafted: 0,
    skipped: 0,
    message,
  });
  if (!settings.agentEnabled && !manual)
    return empty("The daily digest is off.");
  const problem =
    (await digestSetupProblem(p)) ??
    runLimitProblem(settings.agentRuns, now, { manual });
  if (problem) return empty(problem);
  const run = await recordRunStart(now, manual);
  const digest = await prisma.dailyDigest.create({
    data: {
      startedAt: now,
      preferences: p,
      sources: [],
      demo: Boolean(process.env.DOSSIER_JOBS_TEST_BASE_URL),
    },
  });
  try {
    await context.step("Searching enabled sources");
    const found = await discover(p, context.signal);
    await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { sources: found.sources },
    });
    const fresh = await unseenDigestPostings(found.postings);
    await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { discovered: fresh },
    });
    const [provider, options, profile] = await Promise.all([
      getAiProvider(),
      loadTaskOptions(),
      loadProfile(),
    ]);
    // Round-robin across sources avoids a large board exhausting the scoring cap.
    const groups = new Map<string, FoundPosting[]>();
    fresh
      .toSorted(
        (a, b) =>
          (b.postedAt ? Date.parse(b.postedAt) : 0) -
          (a.postedAt ? Date.parse(a.postedAt) : 0),
      )
      .forEach((job) =>
        groups.set(job.source, [...(groups.get(job.source) ?? []), job]),
      );
    const toScore: FoundPosting[] = [];
    while (
      toScore.length < settings.agentMaxScores &&
      [...groups.values()].some((g) => g.length)
    )
      for (const group of groups.values()) {
        if (toScore.length >= settings.agentMaxScores) break;
        const job = group.shift();
        if (job) toScore.push(job);
      }
    let scored = 0,
      stretch = 0,
      strong = 0,
      failures = 0;
    for (const job of toScore) {
      if (context.signal.aborted) break;
      await context.step(
        `Matching posting ${scored + failures + 1} of ${toScore.length}`,
      );
      try {
        const result = await scorePosting(
          provider,
          {
            posting: postingText(job),
            title: job.title,
            company: job.company,
            place: job.place,
            remote: job.remote,
            salary: job.salary,
            profile,
            preferences: p,
          },
          { ...options, signal: context.signal },
        );
        const flags = [...result.data.redFlags];
        if (job.remote === null)
          flags.push("Work arrangement is unknown; verify with the employer.");
        if (!job.salary) flags.push("Salary is not stated.");
        if (!job.complete)
          flags.push(
            "Only a partial posting is available; fit is provisional.",
          );
        const kind =
          result.data.score >= settings.agentMinScore ? "strong" : "below";
        const score = { ...result.data, redFlags: flags };
        await prisma.$transaction(async (tx) => {
          const candidate = await tx.agentCandidate.create({
            data: {
              ...candidateData(job, score),
              identityKeys: identityKeys(job),
            },
          });
          await tx.digestItem.create({
            data: { digestId: digest.id, candidateId: candidate.id, kind },
          });
        });
        await saveScore(job, score, result.promptVersion);
        scored++;
        if (kind === "strong") strong++;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        )
          continue;
        if (!(e instanceof AiError) && !context.signal.aborted)
          logServerError("daily digest scoring", e);
        failures++;
      }
    }
    // Pick the best stretches after every score is known, independent of source order.
    const stretches = await prisma.digestItem.findMany({
      where: {
        digestId: digest.id,
        kind: "below",
        candidate: {
          score: { gte: Math.max(50, settings.agentMinScore - 20) },
        },
      },
      orderBy: { candidate: { score: "desc" } },
      take: 3,
    });
    await prisma.digestItem.updateMany({
      where: {
        digestId: digest.id,
        candidateId: { in: stretches.map((i) => i.candidateId) },
      },
      data: { kind: "stretch" },
    });
    stretch = stretches.length;
    const preparation = await prepareStrongMatches(digest, settings, context, profile);
    const failedSources = found.sources.filter(
      (s) => s.status === "failed" || s.status === "partial",
    ).length;
    const message = `${strong} strong ${strong === 1 ? "match" : "matches"}, ${stretch} stretch ${stretch === 1 ? "role" : "roles"}. ${scored} scored; ${Math.max(0, fresh.length - toScore.length)} deferred by the scoring limit; ${failures} scoring failures; ${failedSources} ${failedSources === 1 ? "source needs" : "sources need"} attention.${preparation.summary}${context.signal.aborted ? " Run interrupted; completed results are preserved." : ""}`;
    await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { finishedAt: new Date(), message },
    });
    await recordRunEnd(run, message);
    return {
      found: found.postings.length,
      fresh: fresh.length,
      skipped: found.postings.length - fresh.length,
      scored,
      drafted: preparation.drafted,
      message,
    };
  } catch (e) {
    const message =
      "Digest interrupted. Any completed results are preserved; review source status and try the next run.";
    await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { finishedAt: new Date(), message },
    });
    await recordRunEnd(run, message);
    throw e;
  }
}

/** Called before scheduling starts, after the runner has failed interrupted jobs. */
export async function recoverInterruptedDigests(): Promise<number> {
  const result = await prisma.dailyDigest.updateMany({
    where: { finishedAt: null },
    data: {
      finishedAt: new Date(),
      message:
        "Discovery was interrupted by a restart. Completed results are preserved; the next scheduled run will search again.",
    },
  });
  return result.count;
}
