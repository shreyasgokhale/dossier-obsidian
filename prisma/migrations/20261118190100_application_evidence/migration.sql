CREATE TYPE "ApplicationEvidenceKind" AS ENUM ('REPLY', 'INTERVIEW_NOTE', 'RECORDING', 'TRANSCRIPT', 'EMPLOYER_FEEDBACK');

CREATE TABLE "ApplicationEvidence" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "ApplicationEvidenceKind" NOT NULL,
    "text" TEXT NOT NULL,
    "fileName" TEXT,
    "fileContent" TEXT,
    "correctsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationEvidence_applicationId_createdAt_idx" ON "ApplicationEvidence"("applicationId", "createdAt");
ALTER TABLE "ApplicationEvidence" ADD CONSTRAINT "ApplicationEvidence_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
