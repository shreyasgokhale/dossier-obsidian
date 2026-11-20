import { z } from "zod";

export const SUBMISSION_MAX_BYTES = 5 * 1024 * 1024;
export const SUBMISSION_MAX_FILES = 8;
export const SUBMISSION_DETAILS_LIMIT = 20_000;

export const submittedFileName = z.string().min(1).max(255).refine((value) => value.trim().length > 0).regex(/^[^/\\\p{Cc}\p{Cs}]+$/u);

export const submittedFilesSchema = z.array(z.object({
  name: submittedFileName,
  content: z.base64(),
})).max(SUBMISSION_MAX_FILES);

export type SubmittedFile = z.infer<typeof submittedFilesSchema>[number];
