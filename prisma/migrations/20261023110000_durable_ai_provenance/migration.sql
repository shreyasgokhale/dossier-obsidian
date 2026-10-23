ALTER TABLE "Application" ADD COLUMN "aiProvenance" JSONB;
ALTER TABLE "Application" ADD CONSTRAINT "application_ai_provenance_array"
  CHECK ("aiProvenance" IS NULL OR jsonb_typeof("aiProvenance") = 'array');

-- Jobs have user-configurable retention. Preserve their model/source snapshots
-- with the application, including jobs linked only after a draft is accepted.
-- Updates and repeated claims cannot append the same job attempt twice.
CREATE FUNCTION dossier_preserve_ai_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."applicationId" IS NULL OR NEW.provenance IS NULL
    OR jsonb_typeof(NEW.provenance) <> 'array' THEN RETURN NEW; END IF;
  UPDATE "Application" AS app
  SET "aiProvenance" = COALESCE(app."aiProvenance", '[]'::jsonb) || COALESCE((
    SELECT jsonb_agg(attempt.value || jsonb_build_object(
      'jobId', NEW.id, 'type', NEW.type, 'attempt', attempt.number) ORDER BY attempt.number)
    FROM jsonb_array_elements(NEW.provenance) WITH ORDINALITY AS attempt(value, number)
    WHERE jsonb_typeof(attempt.value) = 'object' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(app."aiProvenance", '[]'::jsonb)) AS saved
      WHERE saved->>'jobId' = NEW.id AND saved->>'attempt' = attempt.number::text
    )
  ), '[]'::jsonb)
  WHERE app.id = NEW."applicationId";
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_ai_provenance
  AFTER INSERT OR UPDATE OF provenance, "applicationId" ON "Job"
  FOR EACH ROW EXECUTE FUNCTION dossier_preserve_ai_provenance();

UPDATE "Job" SET provenance = provenance
WHERE "applicationId" IS NOT NULL AND provenance IS NOT NULL;
