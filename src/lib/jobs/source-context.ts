import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@/generated/prisma/client";
import type { AiConfig } from "@/lib/ai/config";
import type { ProfileData } from "@/lib/profile";
/** All AI calls and profile reads within one attempt use this captured source. */
export const jobSourceContext = new AsyncLocalStorage<{
  config: AiConfig;
  profile: ProfileData;
  jobId?: string;
  type?: string;
}>();

/** Commit a retry checkpoint with the mutation it represents. */
export async function checkpointJob(
  tx: Prisma.TransactionClient,
  result: unknown,
) {
  const source = jobSourceContext.getStore();
  if (
    !source?.jobId ||
    !["refine", "regenerate-unit", "write-email", "draft-reply"].includes(
      source.type ?? "",
    ) ||
    result === undefined
  )
    return;
  await tx.job.updateMany({
    where: { id: source.jobId },
    data: { result: JSON.parse(JSON.stringify(result)) },
  });
}
