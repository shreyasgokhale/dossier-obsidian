import "server-only";
import { formatDateTime } from "@/lib/dates";
import { lastKnownTimeZone } from "@/lib/time-zone";
import { prisma } from "@/lib/prisma";
import { foundFromPosting, postingStates } from "@/lib/postings";
import { postingKey } from "@/lib/job-search/search";
import { stringsOf } from "@/lib/agent/candidates";
import { identityKeys } from "./identity";
import type { SourceReport } from "./search";
export async function loadDigestView(id?: string) {
  const timeZone = await lastKnownTimeZone();
  const history = await prisma.dailyDigest.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
  });
  const digest = id
    ? await prisma.dailyDigest.findUnique({
        where: { id },
        include: { items: { include: { candidate: true } } },
      })
    : await prisma.dailyDigest.findFirst({
        orderBy: { startedAt: "desc" },
        include: { items: { include: { candidate: true } } },
      });
  const items = digest?.items ?? [];
  const itemIds = new Set(items.map((item) => item.candidateId));
  const outstanding = !id && digest ? await prisma.agentCandidate.findMany({
    where: {
      id: { notIn: [...itemIds] },
      status: "DRAFTED",
      application: { awaitingReview: true, archivedAt: null },
      digestItems: { some: { digest: { demo: digest.demo } } },
    },
  }) : [];
  const visibleItems = [...items, ...outstanding.map((candidate) => ({ kind: "strong", candidate }))];
  const found = visibleItems.map((i) => foundFromPosting(i.candidate));
  const states = await postingStates(found);
  const [stored, applications] = await Promise.all([
    prisma.posting.findMany({
      where: {
        OR: [{ savedAt: { not: null } }, { dismissedAt: { not: null } }],
      },
    }),
    prisma.application.findMany({
      where: { awaitingReview: false },
      select: { id: true, company: true, role: true, postingUrl: true },
    }),
  ]);
  const dismissedKeys = new Set(
    stored.filter((p) => p.dismissedAt).flatMap(identityKeys),
  );
  const savedKeys = new Set(
    stored.filter((p) => p.savedAt).flatMap(identityKeys),
  );
  const pursued = new Map<string, string>();
  for (const app of applications)
    for (const key of identityKeys({
      source: "JSEARCH",
      externalId: "",
      company: app.company,
      title: app.role,
      url: app.postingUrl,
      place: "",
    }).slice(1))
      pursued.set(key, app.id);

  return {
    history: history.map((d) => ({
      id: d.id,
      at: d.startedAt.toISOString(),
      label: formatDateTime(d.startedAt, timeZone),
      demo: d.demo,
    })),
    digest: digest
      ? {
          id: digest.id,
          at: digest.startedAt.toISOString(),
          finished: !!digest.finishedAt,
          demo: digest.demo,
          message: digest.message,
          sources: digest.sources as SourceReport[],
          items: visibleItems
            .map((i) => ({
              id: i.candidate.id,
              kind: i.kind,
              posting: foundFromPosting(i.candidate),
              score: i.candidate.score,
              reasons: stringsOf(i.candidate.reasons),
              gaps: stringsOf(i.candidate.redFlags),
              preparation: {
                status: i.candidate.status,
                error: i.candidate.error,
                applicationId: i.candidate.status === "DRAFTED" ? i.candidate.applicationId : null,
              },
              state: {
                ...states.get(postingKey(i.candidate))!,
                saved:
                  states.get(postingKey(i.candidate))!.saved ||
                  identityKeys(i.candidate).some((k) => savedKeys.has(k)),
                applicationId:
                  states.get(postingKey(i.candidate))!.applicationId ??
                  identityKeys(i.candidate)
                    .map((k) => pursued.get(k))
                    .find(Boolean) ??
                  null,
              },
              dismissed:
                i.candidate.status === "DISMISSED" ||
                identityKeys(i.candidate).some((k) => dismissedKeys.has(k)),
            }))
            .sort((a, b) => b.score - a.score),
        }
      : null,
  };
}
export type DigestView = Awaited<ReturnType<typeof loadDigestView>>;
