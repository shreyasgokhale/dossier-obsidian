import Link from "next/link";
import { notFound } from "next/navigation";

import { loadApplicationEvidence } from "@/lib/application-evidence";
import { EVIDENCE_LABELS } from "@/lib/application-evidence-data";
import { prisma } from "@/lib/prisma";
import { userTimeZone } from "@/lib/time-zone";

import { EvidenceForm } from "./evidence-form";

export default async function EvidencePage({ params, searchParams }: PageProps<"/applications/[id]/evidence">) {
  const [{ id }, { correct }, timeZone] = await Promise.all([params, searchParams, userTimeZone()]);
  const [application, entries] = await Promise.all([
    prisma.application.findUnique({ where: { id }, select: { title: true, company: true, role: true } }),
    loadApplicationEvidence(prisma, id),
  ]);
  if (!application) notFound();

  const path = `/applications/${encodeURIComponent(id)}`;
  const correction = entries.find((entry) => entry.id === correct);
  const dates = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone });

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
      <Link className="text-sm underline" href={path}>Back to application</Link>
      <h1 className="font-serif text-3xl">Follow-up evidence</h1>
      <p className="text-sm text-muted">{application.title || [application.role, application.company].filter(Boolean).join(" · ") || "Untitled application"}</p>
      <EvidenceForm key={correction?.id ?? "new"} id={id} correction={correction} />
      {entries.length > 0 && (
        <ol aria-label="Follow-up evidence history" className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li key={entry.id} id={`evidence-${entry.id}`} className="flex flex-col gap-2 border-t border-line py-4">
              <h2 className="font-medium">{EVIDENCE_LABELS[entry.kind]}</h2>
              <p className="text-sm text-muted">
                {entry.occurredAt && <>Occurred <time dateTime={entry.occurredAt.toISOString()}>{dates.format(entry.occurredAt)}</time> · </>}
                Saved <time dateTime={entry.createdAt.toISOString()}>{dates.format(entry.createdAt)}</time>
                {entry.correctsId && <> · <a className="underline" href={`#evidence-${entry.correctsId}`}>Correction of earlier entry</a></>}
              </p>
              {entry.text && <p className="whitespace-pre-wrap break-words">{entry.text}</p>}
              {entry.fileName && <a className="underline" href={`/api${path}/evidence/${encodeURIComponent(entry.id)}`} download>{entry.fileName}</a>}
              <Link className="self-start text-sm underline" href={`${path}/evidence?correct=${encodeURIComponent(entry.id)}#add-evidence`}>Add correction</Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
