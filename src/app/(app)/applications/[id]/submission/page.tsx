import Link from "next/link";

import { loadApplication } from "@/lib/application-documents";
import { prisma } from "@/lib/prisma";
import { submittedFilesSchema } from "@/lib/submission-data";
import { userTimeZone } from "@/lib/time-zone";

import { SubmissionForm } from "./submission-form";

export default async function SubmissionPage({ params }: PageProps<"/applications/[id]/submission">) {
  const { id } = await params;
  const [application, submission, timeZone] = await Promise.all([
    loadApplication(id),
    prisma.applicationSubmission.findUnique({ where: { applicationId: id } }),
    userTimeZone(),
  ]);
  const files = submittedFilesSchema.safeParse(submission?.files);
  const encodedId = encodeURIComponent(id);

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-8">
      <Link className="text-sm underline" href={`/applications/${encodedId}`}>Back to application</Link>
      <h1 className="font-serif text-3xl">Submission record</h1>
      {submission ? (
        <>
          <p>{[submission.role, submission.company].filter(Boolean).join(" · ")}</p>
          <p className="text-sm text-muted">
            Submitted <time dateTime={submission.submittedAt.toISOString()}>
              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(submission.submittedAt)}
            </time>
          </p>
          {submission.submittedText && (
            <div>
              <h2 className="font-medium">Submitted text</h2>
              <p className="whitespace-pre-wrap break-words">{submission.submittedText}</p>
            </div>
          )}
          {submission.details && <p className="whitespace-pre-wrap break-words">{submission.details}</p>}
          {files.success && files.data.length > 0 && (
            <ul aria-label="Submitted files" className="flex flex-col gap-2">
              {files.data.map(({ name }, index) => (
                <li key={index}>
                  <a className="underline" href={`/api/applications/${encodedId}/submission/${index}`} download>{name}</a>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : application.awaitingReview ? (
        <p>Keep the draft before recording its submission.</p>
      ) : (
        <SubmissionForm id={id} />
      )}
    </section>
  );
}
