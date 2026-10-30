import "server-only";
import { prisma } from "@/lib/prisma";
import { readPostingJob } from "./read-posting";
import { writeDocumentsJob } from "./write-documents";
import type { Draft } from "@/app/(app)/new/new-application";
import type { Tone } from "@/generated/prisma/enums";
/** Recover the durable input and output of explicit work after the tab closes. */
export async function recoverApplicationDraft(
  id: string,
  tone: Tone,
): Promise<Draft | null> {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.applicationId || job.key?.startsWith("application:"))
    return null;
  let reading = job,
    writeJobId: string | null = null;
  let note = "";
  if (job.type === "write-documents") {
    const input = writeDocumentsJob.input.safeParse(job.input);
    if (!input.success) return null;
    const read = await prisma.job.findUnique({
      where: { id: input.data.readJobId },
    });
    if (!read) return null;
    reading = read;
    writeJobId = id;
    tone = input.data.tone;
    note = input.data.note;
  } else if (job.type !== "read-posting") return null;
  const input = readPostingJob.input.safeParse(reading.input);
  if (!input.success) return null;
  const parsed =
    reading.status === "DONE"
      ? readPostingJob.result.safeParse(reading.result)
      : null;
  const read = parsed?.success ? parsed.data : null;
  const writtenInput = writeJobId
    ? writeDocumentsJob.input.parse(job.input)
    : null;
  const extracted = writtenInput?.extracted ?? read?.extracted;
  return {
    step: writeJobId ? "creating" : read ? "review" : "reading",
    posting: input.data.posting,
    postingUrl: input.data.postingUrl ?? "",
    postingId: input.data.postingId ?? null,
    readJobId: reading.id,
    readFor: input.data.posting,
    read: read && writtenInput ? { ...read, match: writtenInput.match } : read,
    writeJobId,
    tone,
    note,
    details: {
      title: extracted?.title ?? "",
      company: extracted?.company ?? "",
      role: extracted?.role ?? "",
      location: extracted?.location ?? "",
      mode: extracted?.mode ?? "",
      salary: extracted?.salary ?? "",
      deadline: extracted?.deadline ?? "",
    },
  };
}
