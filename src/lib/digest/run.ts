import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { AiError } from "@/lib/ai/errors";
import { logServerError } from "@/lib/log";
import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import { candidateData } from "@/lib/agent/candidates";
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
export async function unseenDigestPostings(postings: FoundPosting[]) {
  const [candidates, stored, applications] = await Promise.all([
    prisma.agentCandidate.findMany(),
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
    const failedSources = found.sources.filter(
      (s) => s.status === "failed" || s.status === "partial",
    ).length;
    const message = `${strong} strong ${strong === 1 ? "match" : "matches"}, ${stretch} stretch ${stretch === 1 ? "role" : "roles"}. ${scored} scored; ${Math.max(0, fresh.length - toScore.length)} deferred by the scoring limit; ${failures} scoring failures; ${failedSources} ${failedSources === 1 ? "source needs" : "sources need"} attention.${context.signal.aborted ? " Run interrupted; completed results are preserved." : ""}`;
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
      drafted: 0,
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
