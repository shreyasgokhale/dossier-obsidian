import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { ApplicationStatus } from "@/generated/prisma/enums";
import { applyStatusChangeTx } from "@/lib/status-changes";
import { submittedFilesSchema, type SubmittedFile } from "@/lib/submission-data";

type ManualSubmission = {
  submittedAt: Date;
  details: string;
  submittedText?: string;
  files: SubmittedFile[];
};

/** Records what the owner actually sent, independently of editable drafts and status history. */
export async function recordManualSubmission(
  db: PrismaClient,
  applicationId: string,
  input: ManualSubmission,
): Promise<"recorded" | "already-recorded" | "conflict" | "not-found" | "awaiting-review"> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      select: { company: true, role: true, status: true, sentAt: true, awaitingReview: true, submission: true },
    });
    if (!application) return "not-found";
    if (application.awaitingReview) return "awaiting-review";
    const saved = application.submission;
    if (saved) {
      const files = submittedFilesSchema.parse(saved.files);
      const sameFiles = files.length === input.files.length &&
        files.every((file, index) => file.name === input.files[index].name && file.content === input.files[index].content);
      return sameFiles && saved.submittedAt.getTime() === input.submittedAt.getTime() &&
        saved.details === input.details && saved.submittedText === (input.submittedText ?? "")
        ? "already-recorded" : "conflict";
    }

    await tx.applicationSubmission.create({
      data: { applicationId, company: application.company, role: application.role, ...input },
    });
    if (application.status === ApplicationStatus.DRAFT || (application.status === ApplicationStatus.DECLINED && !application.sentAt)) {
      await applyStatusChangeTx(tx, applicationId, ApplicationStatus.SENT);
    }
    await tx.application.update({
      where: { id: applicationId },
      data: { sentAt: input.submittedAt },
    });
    return "recorded";
  });
}
