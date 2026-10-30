ALTER TYPE "PostingSource" ADD VALUE 'ARBEITNOW';
ALTER TYPE "PostingSource" ADD VALUE 'DAILY_BERLIN';
ALTER TYPE "PostingSource" ADD VALUE 'COMPANY_BOARDS';
ALTER TABLE "AgentCandidate" ADD COLUMN "identityKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "DailyDigest" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finishedAt" TIMESTAMP(3),
 "demo" BOOLEAN NOT NULL DEFAULT false,
 "preferences" JSONB NOT NULL,
 "sources" JSONB NOT NULL,
 "message" TEXT NOT NULL DEFAULT ''
);
CREATE INDEX "DailyDigest_startedAt_idx" ON "DailyDigest"("startedAt");
CREATE TABLE "DigestItem" (
 "digestId" TEXT NOT NULL REFERENCES "DailyDigest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "candidateId" TEXT NOT NULL REFERENCES "AgentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "kind" TEXT NOT NULL,
 PRIMARY KEY ("digestId", "candidateId")
);
CREATE TABLE "SearchPreferenceSync" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'preferences',
 "snapshot" JSONB,
 "fileHash" TEXT,
 "conflict" JSONB,
 "error" TEXT,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
