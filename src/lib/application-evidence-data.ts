import { ApplicationEvidenceKind } from "@/generated/prisma/enums";

export const EVIDENCE_LABELS: Record<ApplicationEvidenceKind, string> = {
  REPLY: "Employer reply",
  INTERVIEW_NOTE: "Interview note",
  RECORDING: "Interview recording",
  TRANSCRIPT: "Interview transcript",
  EMPLOYER_FEEDBACK: "Employer feedback",
};

export const EVIDENCE_TEXT_LIMIT = 100_000;
export const RECORDING_MAX_BYTES = 5 * 1024 * 1024;
