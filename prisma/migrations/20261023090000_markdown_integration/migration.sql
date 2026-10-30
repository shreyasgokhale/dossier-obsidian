ALTER TABLE "Application" ADD COLUMN "applicationDate" DATE, ADD COLUMN "followUpDate" DATE, ADD COLUMN "nextAction" TEXT NOT NULL DEFAULT '';
CREATE TABLE "MarkdownProfile" (id TEXT PRIMARY KEY, config JSONB NOT NULL, draft JSONB, paused BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "MarkdownLink" ("applicationId" TEXT PRIMARY KEY REFERENCES "Application"(id) ON DELETE CASCADE, "profileId" TEXT NOT NULL REFERENCES "MarkdownProfile"(id), path TEXT NOT NULL UNIQUE, "noteId" TEXT NOT NULL UNIQUE, snapshot JSONB NOT NULL, "contentHash" TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'linked', error TEXT, conflict JSONB, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "MarkdownWork" ("applicationId" TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "MarkdownDocument" ("documentId" TEXT PRIMARY KEY REFERENCES "Document"(id) ON DELETE CASCADE, path TEXT NOT NULL UNIQUE, snapshot JSONB NOT NULL, "contentHash" TEXT NOT NULL, conflict JSONB, error TEXT, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "ResumeSource" (id TEXT PRIMARY KEY, path TEXT NOT NULL, language TEXT NOT NULL, collection TEXT NOT NULL, "contentHash" TEXT NOT NULL, content JSONB NOT NULL, "targetId" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL);
-- Every existing mutation path queues work within its database transaction.
-- Triggers keep upstream hooks focused, including background AI/document writes.
CREATE FUNCTION dossier_markdown_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE app_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Application' THEN app_id := COALESCE(NEW.id, OLD.id);
  ELSE app_id := COALESCE(NEW."applicationId", OLD."applicationId"); END IF;
  INSERT INTO "MarkdownWork" ("applicationId", "updatedAt") VALUES (app_id, now())
  ON CONFLICT ("applicationId") DO UPDATE SET revision = "MarkdownWork".revision + 1, "updatedAt" = now();
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER markdown_application AFTER INSERT OR UPDATE OR DELETE ON "Application" FOR EACH ROW EXECUTE FUNCTION dossier_markdown_enqueue();
CREATE TRIGGER markdown_note AFTER INSERT OR UPDATE OR DELETE ON "Note" FOR EACH ROW EXECUTE FUNCTION dossier_markdown_enqueue();
CREATE TRIGGER markdown_document AFTER INSERT OR UPDATE OR DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION dossier_markdown_enqueue();
CREATE TRIGGER markdown_chat AFTER INSERT OR UPDATE OR DELETE ON "ChatMessage" FOR EACH ROW EXECUTE FUNCTION dossier_markdown_enqueue();
