import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ApplicationEvidenceKind } from "@/generated/prisma/enums";
import type { SubmittedFile } from "@/lib/submission-data";

type EvidenceInput = {
  kind: ApplicationEvidenceKind;
  text: string;
  correctsId?: string;
  occurredAt?: Date;
  file?: SubmittedFile;
};

type RecordEvidenceResult =
  | { outcome: "recorded"; id: string }
  | { outcome: "not-found" | "invalid-correction" };

export async function addApplicationEvidence(db: PrismaClient, applicationId: string, input: EvidenceInput): Promise<RecordEvidenceResult> {
  return db.$transaction(async (tx) => {
    const application = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Application" WHERE id = ${applicationId} FOR KEY SHARE`;
    if (!application.length) return { outcome: "not-found" };
    if (input.correctsId && !(await tx.applicationEvidence.findFirst({
      where: { id: input.correctsId, applicationId, kind: input.kind },
      select: { id: true },
    }))) {
      return { outcome: "invalid-correction" };
    }
    const { id } = await tx.applicationEvidence.create({
      data: {
        applicationId,
        kind: input.kind,
        text: input.text,
        correctsId: input.correctsId,
        occurredAt: input.occurredAt,
        fileName: input.file?.name,
        fileContent: input.file?.content,
      },
      select: { id: true },
    });
    return { outcome: "recorded", id };
  });
}

export function loadApplicationEvidence(db: PrismaClient, applicationId: string) {
  return db.applicationEvidence.findMany({
    where: { applicationId },
    omit: { applicationId: true, fileContent: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}
