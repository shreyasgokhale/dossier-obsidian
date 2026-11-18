CREATE TABLE "ApplicationSubmission" (
    "applicationId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    CONSTRAINT "ApplicationSubmission_pkey" PRIMARY KEY ("applicationId")
);

ALTER TABLE "ApplicationSubmission" ADD CONSTRAINT "ApplicationSubmission_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
