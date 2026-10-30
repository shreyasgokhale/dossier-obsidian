import Link from "next/link";
import { recoverApplicationDraft } from "@/lib/jobs/recover-draft";
import type { Metadata } from "next";

import { isAiConfigured, isAiUsable } from "@/lib/ai/config";
import { handsOffToClaude } from "@/lib/connector/handoff";
import { DEMO_POSTING } from "@/lib/demo-profile";
import { postingText } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { getStartup, startupPostingText } from "@/lib/startups/store";

import { NewApplication } from "./new-application";

export const metadata: Metadata = { title: "New application" };

/** Posting → details and match → tailored documents (PRD §6.4). Nothing is created until the last step. */
export default async function NewApplicationPage({ searchParams }: PageProps<"/new">) {
  const { fresh, posting, resume, startup: startupId } = await searchParams;
  const [aiReady, writeInClaude, applications, settings, fromFindJobs, startup] = await Promise.all([
    isAiConfigured(),
    isAiUsable().then(handsOffToClaude),
    prisma.application.count({ where: { awaitingReview: false } }),
    loadSettings(),
    // "Start application" on Find jobs (E14-8).
    typeof posting === "string" ? prisma.posting.findUnique({ where: { id: posting } }) : null,
    // "Write to them" on Startups (#222): what's known about the startup, without its addresses.
    typeof startupId === "string" ? getStartup(startupId) : null,
  ]);
  const recovered = typeof resume === "string" ? await recoverApplicationDraft(resume, settings.defaultTone) : null;
  const saved = fresh === undefined ? await prisma.job.findMany({ where: { applicationId: null, type: { in: ["read-posting", "write-documents"] }, key: null }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, type: true, status: true, createdAt: true } }) : [];
  return (
    <>
    {saved.length > 0 && <aside className="mx-10 mt-4 rounded-card border border-line p-3 text-sm" aria-label="Saved AI work"><details><summary>Saved AI work · resume after closing a tab</summary><ul>{saved.map((job) => <li key={job.id}><Link href={`/new?resume=${job.id}`}>{job.type} · {job.status} · {job.createdAt.toISOString()}</Link></li>)}</ul></details></aside>}
    <NewApplication
      recovered={recovered}
      aiReady={aiReady}
      writeInClaude={writeInClaude}
      defaultTone={settings.defaultTone}
      fresh={fresh !== undefined}
      fromPosting={
        fromFindJobs
          ? { id: fromFindJobs.id, text: postingText(fromFindJobs), url: fromFindJobs.url, complete: fromFindJobs.complete }
          : startup && {
              id: null,
              startup: { id: startup.id, company: startup.company },
              text: startupPostingText(startup),
              url: startup.links[0]?.url ?? startup.website,
              complete: true,
            }
      }
      // A first-run helper: only until the first application exists (E7-1).
      samplePosting={applications === 0 ? DEMO_POSTING : null}
    />
    </>
  );
}
