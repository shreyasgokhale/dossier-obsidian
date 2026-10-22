import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  mkdtemp,
  cp,
  readFile,
  writeFile,
  rename,
  unlink,
  symlink,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createTestClient, resetDatabase } from "@/test/db";
import { defaultProfile, labeledProfile, type Values } from "./profile";
import { parseNote, writeNote } from "./format";
import { hash, readNote, safePath, writeFileChecked } from "./files";
import {
  ensureProfiles,
  adoptionPreview,
  adoptNote,
  reconcile,
  resolveConflict,
  stageProfile,
  profileReview,
  activateProfile,
  integrationView,
} from "./service";
import {
  exportObsidian,
  syncDocuments,
  parseDocumentUnits,
  repairDocument,
  resolveDocument,
} from "./documents";
import { buildExport } from "@/lib/data-export";
import { importExport, parseExport } from "@/lib/data-import";
import { resumePreview, importResume } from "./resume";
const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof createTestClient> | null,
}));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.db!;
  },
}));
let root: string;
const db = () => state.db!;
const fmFile = "frontmatter/empty-energy.md",
  labelFile = "labeled/application.md";
async function adopt(
  file = fmFile,
  profileId = "default-frontmatter",
  fill: Values = {},
) {
  const p = await adoptionPreview(file, profileId, fill);
  return adoptNote(file, profileId, p.hash, p.profileHash, fill);
}
async function link(id: string) {
  return db().markdownLink.findUniqueOrThrow({ where: { applicationId: id } });
}
async function text(file = fmFile) {
  return readNote(process.env.DOSSIER_NOTES_ROOT!, file);
}
async function edit(file: string, values: Values, labels = false) {
  const before = await text(file);
  await writeFile(
    path.join(root, "notes", file),
    writeNote(before, labels ? labeledProfile : defaultProfile, values),
  );
}
async function app(id: string) {
  return db().application.findUniqueOrThrow({ where: { id } });
}
beforeAll(() => {
  state.db = createTestClient();
});
beforeEach(async () => {
  await resetDatabase(db());
  root = await mkdtemp(path.join(os.tmpdir(), "dossier-markdown-test-"));
  await cp("fixtures/notes", path.join(root, "notes"), { recursive: true });
  await cp("fixtures/resume", path.join(root, "resume"), { recursive: true });
  await mkdir(path.join(root, "data"));
  vi.stubEnv("DOSSIER_NOTES_ROOT", path.join(root, "notes"));
  vi.stubEnv("DOSSIER_DATA_DIR", path.join(root, "data"));
  vi.stubEnv("DOSSIER_RESUME_ROOT", path.join(root, "resume"));
  await ensureProfiles();
});
afterAll(async () => {
  await db().$disconnect();
  vi.unstubAllEnvs();
});
describe("Markdown integration against PostgreSQL and a real filesystem", () => {
  it("adopts both formats in place after explicit preview, preserving original bodies and empty values", async () => {
    const before = await text();
    const preview = await adoptionPreview(fmFile, "default-frontmatter", {
      applicationDate: "2026-10-01",
    });
    expect(await text()).toBe(before);
    expect(preview.diff).toContain("dossier_id");
    const id = await adopt(fmFile, "default-frontmatter", {
      applicationDate: "2026-10-01",
    });
    expect((await app(id)).applicationDate?.toISOString()).toContain(
      "2026-10-01",
    );
    expect((await text()).slice((await text()).indexOf("# Posting"))).toBe(
      before.slice(before.indexOf("# Posting")),
    );
    expect(
      await db().note.findMany({ where: { applicationId: id } }),
    ).toHaveLength(1);
    expect(await db().statusEvent.count({ where: { applicationId: id } })).toBe(
      1,
    );
    const other = await adopt(labelFile, "default-labels");
    expect((await app(other)).status).toBe("INTERVIEW");
    await expect(adopt(fmFile)).rejects.toThrow("stable ID");
    await reconcile();
    await reconcile();
    expect(await db().application.count()).toBe(2);
    expect(await db().note.count()).toBe(2);
    expect(await db().statusEvent.count()).toBe(2);
  });
  it("rejects stale adoption previews and invalid metadata without touching records", async () => {
    const p = await adoptionPreview(fmFile, "default-frontmatter");
    await edit(fmFile, { role: "Changed" });
    await expect(
      adoptNote(fmFile, "default-frontmatter", p.hash, p.profileHash, {}),
    ).rejects.toThrow("changed");
    expect(await db().application.count()).toBe(0);
    await writeFile(
      path.join(root, "notes", fmFile),
      "---\nstatus: [invalid\n---\n",
    );
    const bad = await adoptionPreview(fmFile, "default-frontmatter");
    expect(bad.parsed.errors.length).toBeGreaterThan(0);
    await expect(
      adoptNote(fmFile, "default-frontmatter", bad.hash, bad.profileHash, {}),
    ).rejects.toThrow("YAML");
  });
  it("merges independent changes from both interfaces and records each status transition once", async () => {
    const id = await adopt();
    await db().application.update({
      where: { id },
      data: {
        nextAction: "Call recruiter",
        followUpDate: new Date("2026-11-05"),
      },
    });
    await edit(fmFile, { status: "OFFER", location: "Munich" });
    await reconcile();
    expect(await app(id)).toMatchObject({
      status: "OFFER",
      location: "Munich",
      nextAction: "Call recruiter",
    });
    expect(parseNote(await text(), defaultProfile).values).toMatchObject({
      status: "OFFER",
      followUpDate: "2026-11-05",
      nextAction: "Call recruiter",
    });
    const after = await text();
    await reconcile();
    await reconcile();
    expect(await text()).toBe(after);
    expect(await db().statusEvent.count()).toBe(2);
    expect(await db().markdownWork.count()).toBe(0);
    expect(after).toContain("custom_property: [private, keep]");
    expect(after).toContain("[[Energy research]]");
  });
  it("imports and exports labeled follow-ups and mapped interview text", async () => {
    await db().markdownProfile.update({
      where: { id: "default-labels" },
      data: {
        config: {
          ...labeledProfile,
          interviewHeading: "Interview",
          postingHeading: "Posting",
        },
      },
    });
    const id = await adopt(labelFile, "default-labels");
    const before = await text(labelFile);
    const note = await db().note.findFirstOrThrow({
      where: { applicationId: id },
    });
    await db().note.update({
      where: { id: note.id },
      data: { body: "\n## Updated call\n- [ ] Follow up\n" },
    });
    await db().application.update({
      where: { id },
      data: { followUpDate: new Date("2026-11-07") },
    });
    await reconcile();
    expect(await text(labelFile)).toContain("Follow-up: 2026-11-07");
    expect(await text(labelFile)).toContain("## Updated call");
    expect(
      (await text(labelFile)).split("# Posting")[1].split("# Interview")[0],
    ).toBe(before.split("# Posting")[1].split("# Interview")[0]);
  });
  it("preserves both versions of field/body conflicts and resolves through the review service", async () => {
    const id = await adopt();
    const noteId = (await link(id)).noteId;
    await db().application.update({
      where: { id },
      data: { company: "App company" },
    });
    await db().note.update({
      where: { id: noteId },
      data: { body: "App notes\n" },
    });
    await edit(fmFile, { company: "File company", body: "File notes\n" });
    await reconcile();
    const row = await link(id);
    expect(row.state).toBe("conflict");
    expect(row.conflict).toMatchObject({
      app: { company: "App company", body: "App notes\n" },
      file: { company: "File company", body: "File notes\n" },
    });
    expect((await app(id)).company).toBe("App company");
    expect(await text()).toContain("File company");
    await expect(resolveConflict(id, {}, hash(await text()))).rejects.toThrow(
      "Choose",
    );
    await db().application.update({
      where: { id },
      data: { role: "Changed again" },
    });
    await expect(
      resolveConflict(id, { company: "file", body: "app" }, hash(await text())),
    ).rejects.toThrow("app changed again");
    await reconcile();
    await resolveConflict(
      id,
      { company: "file", body: "app" },
      hash(await text()),
    );
    expect((await app(id)).company).toBe("File company");
    expect(await text()).toContain("App notes");
    await reconcile();
    expect((await link(id)).state).toBe("linked");
  });
  it("detects rename, duplicate IDs, deletion and restoration without duplicating records", async () => {
    const id = await adopt();
    const original = await text();
    await rename(
      path.join(root, "notes", fmFile),
      path.join(root, "notes", "renamed.md"),
    );
    await reconcile();
    expect((await link(id)).path).toBe("renamed.md");
    await writeFile(path.join(root, "notes", "copy.md"), original);
    await reconcile();
    expect((await link(id)).error).toContain("Duplicate stable ID");
    await unlink(path.join(root, "notes", "copy.md"));
    await unlink(path.join(root, "notes", "renamed.md"));
    await reconcile();
    expect((await link(id)).state).toBe("unlinked");
    expect(await db().application.count()).toBe(1);
    await writeFile(path.join(root, "notes", "restored.md"), original);
    await reconcile();
    expect((await link(id)).path).toBe("restored.md");
    expect((await link(id)).state).toBe("linked");
  });
  it("retains durable work and retries after disconnected mounts and malformed YAML", async () => {
    const id = await adopt();
    await db().application.update({
      where: { id },
      data: { nextAction: "Retry me" },
    });
    expect(await db().markdownWork.count()).toBeGreaterThan(0);
    await rename(path.join(root, "notes"), path.join(root, "offline"));
    await expect(reconcile()).rejects.toThrow();
    expect(await db().markdownWork.count()).toBeGreaterThan(0);
    await rename(path.join(root, "offline"), path.join(root, "notes"));
    await reconcile();
    expect(await text()).toContain("Retry me");
    const good = await text();
    await writeFile(
      path.join(root, "notes", fmFile),
      good.replace("status: interview", "status: [bad"),
    );
    await reconcile();
    expect((await link(id)).error).toContain("YAML");
    await writeFile(path.join(root, "notes", fmFile), good);
    await reconcile();
    expect((await link(id)).state).toBe("linked");
  });
  it("requires dry-run review for property renames and rejects stale approval tokens", async () => {
    const id = await adopt();
    const before = await text();
    await stageProfile("default-frontmatter", {
      ...defaultProfile,
      fields: { ...defaultProfile.fields, company: "employer" },
    });
    await db().application.update({
      where: { id },
      data: { company: "App changed" },
    });
    await reconcile();
    expect(await text()).toBe(before);
    const review = await profileReview("default-frontmatter");
    expect(review.files[0].diff).toContain("employer");
    expect(review.files[0].error).toBeNull();
    await expect(
      activateProfile("default-frontmatter", "wrong"),
    ).rejects.toThrow("stale");
    await activateProfile("default-frontmatter", review.token);
    expect(await text()).toContain('employer: "App changed"');
    expect(await text()).toContain("company_name: Example Energy");
    await reconcile();
    expect((await link(id)).state).toBe("linked");
  });
  it("rebinds narrower section mappings without duplicating or moving unrelated content", async () => {
    const id = await adopt();
    const before = await text();
    await stageProfile("default-frontmatter", {
      ...defaultProfile,
      postingHeading: "Posting",
      interviewHeading: "Interview",
    });
    const review = await profileReview("default-frontmatter");
    expect(review.files[0].error).toBeNull();
    await activateProfile("default-frontmatter", review.token);
    expect(await text()).toBe(before);
    const note = await db().note.findUniqueOrThrow({
      where: { id: (await link(id)).noteId },
    });
    expect(note.body).toContain("## Intro call");
    expect(note.body).not.toContain("# Posting");
    expect((await app(id)).postingText).toContain("renewable energy");
    await reconcile();
    expect(await text()).toBe(before);
  });
  it("exports new applications using templates and refuses traversal/symlink escapes", async () => {
    const created = await db().application.create({
      data: { company: "New Company", role: "Engineer" },
    });
    await reconcile();
    const row = await link(created.id);
    expect(row.path).toContain("Applications/");
    expect(parseNote(await text(row.path), defaultProfile)).toMatchObject({
      id: created.id,
      errors: [],
      values: { company: "New Company" },
    });
    await expect(
      safePath(path.join(root, "notes"), "../secret.md"),
    ).rejects.toThrow("relative");
    await expect(
      safePath(path.join(root, "notes"), "/tmp/secret.md"),
    ).rejects.toThrow("relative");
    await symlink(path.join(root, "data"), path.join(root, "notes", "escape"));
    await expect(
      safePath(path.join(root, "notes"), "escape/secret.md", true),
    ).rejects.toThrow("Symlinks");
    await expect(
      writeFileChecked(path.join(root, "notes"), row.path, "changed", "bad"),
    ).rejects.toThrow("changed since preview");
    expect((await integrationView()).links).toHaveLength(1);
  });
  it("round-trips document units with versions, repairs damaged markers, and resolves conflicts", async () => {
    const id = await adopt();
    const doc = await db().document.create({
      data: {
        applicationId: id,
        kind: "RESUME",
        units: [
          { id: "summary", label: "Summary", text: "Original summary" },
          { id: "experience:1", label: "Work", text: "PLC and Python" },
        ],
      },
    });
    await syncDocuments();
    const mapping = await db().markdownDocument.findUniqueOrThrow({
      where: { documentId: doc.id },
    });
    const first = await text(mapping.path);
    await writeFile(
      path.join(root, "notes", mapping.path),
      first.replace("Original summary", "Edited summary"),
    );
    await syncDocuments();
    expect(
      (await db().document.findUniqueOrThrow({ where: { id: doc.id } })).units,
    ).toMatchObject([{ text: "Edited summary" }, { text: "PLC and Python" }]);
    expect(await db().documentVersion.count()).toBe(1);
    await syncDocuments();
    expect(await db().documentVersion.count()).toBe(1);
    const good = await text(mapping.path);
    await writeFile(
      path.join(root, "notes", mapping.path),
      good.replace("dossier:unit", "broken:unit"),
    );
    await syncDocuments();
    const damaged = await db().markdownDocument.findUniqueOrThrow({
      where: { documentId: doc.id },
    });
    expect(damaged.error).toContain("markers");
    await repairDocument(doc.id, damaged.contentHash);
    expect(
      parseDocumentUnits(await text(mapping.path), [
        { id: "summary", label: "Summary", text: "" },
        { id: "experience:1", label: "Work", text: "" },
      ])[0].text,
    ).toBe("Edited summary");
    await db().document.update({
      where: { id: doc.id },
      data: {
        units: [
          { id: "summary", label: "Summary", text: "App summary" },
          { id: "experience:1", label: "Work", text: "PLC and Python" },
        ],
      },
    });
    await writeFile(
      path.join(root, "notes", mapping.path),
      (await text(mapping.path)).replace("Edited summary", "File summary"),
    );
    await syncDocuments();
    const conflict = await db().markdownDocument.findUniqueOrThrow({
      where: { documentId: doc.id },
    });
    expect(conflict.conflict).toBeTruthy();
    await resolveDocument(doc.id, "file", conflict.contentHash);
    expect(
      (await db().document.findUniqueOrThrow({ where: { id: doc.id } })).units,
    ).toMatchObject([{ text: "File summary" }, { text: "PLC and Python" }]);
    await exportObsidian();
    expect(await text("Dossier/Dashboard.md")).toContain("Example Energy");
    expect(await text(`Dossier/Views/${id}.md`)).toContain(
      "Documents and attachments",
    );
  });
  it("restores applications, follow-ups, snapshots and mappings from a versioned backup", async () => {
    const id = await adopt();
    await db().application.update({
      where: { id },
      data: {
        followUpDate: new Date("2026-11-15"),
        nextAction: "Preserve backup",
      },
    });
    await reconcile();
    const original = await text();
    const exported = await buildExport(db());
    expect(exported.schemaVersion).toBe(5);
    const parsed = parseExport(JSON.stringify(exported));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    await resetDatabase(db());
    await importExport(db(), parsed.data);
    expect((await app(id)).nextAction).toBe("Preserve backup");
    expect((await link(id)).path).toBe(fmFile);
    await reconcile();
    expect(await text()).toBe(original);
    expect(await db().application.count()).toBe(1);
  });
  it("imports career collections idempotently, preserves variants, and reports renames/removals", async () => {
    const before = await readFile(
      path.join(root, "resume", "about/alex.en.md"),
      "utf8",
    );
    let preview = await resumePreview("en");
    expect(preview.errors).toEqual([]);
    expect(preview.sources).toHaveLength(12);
    await importResume("en", preview.token);
    expect(await db().resumeSource.count()).toBe(12);
    expect(await db().experience.count()).toBe(1);
    preview = await resumePreview("en");
    expect(preview.changes.every((c) => !c.changed)).toBe(true);
    const rows = await db().resumeSource.findMany();
    await importResume("en", preview.token);
    expect(await db().resumeSource.findMany()).toEqual(rows);
    expect(
      await readFile(path.join(root, "resume", "about/alex.en.md"), "utf8"),
    ).toBe(before);
    const german = await resumePreview("de");
    await importResume("de", german.token);
    expect(
      (await db().profileField.findUniqueOrThrow({ where: { key: "summary" } }))
        .value,
    ).toContain("Automatisierungsingenieur");
    expect(await db().experience.count()).toBe(1);
    await rename(
      path.join(root, "resume", "experience/energy.en.md"),
      path.join(root, "resume", "experience/renamed.en.md"),
    );
    await unlink(path.join(root, "resume", "projects/monitor.en.md"));
    preview = await resumePreview("en");
    expect(preview.renames).toHaveLength(1);
    expect(preview.removals).toHaveLength(1);
    await expect(importResume("en", "stale")).rejects.toThrow("changed");
    await importResume("en", preview.token);
    expect(await db().project.count()).toBe(1);
    await writeFile(path.join(root, "resume", "bad.md"), "no frontmatter");
    expect((await resumePreview("en")).errors.length).toBeGreaterThan(0);
  });
  it("activates a new profile explicitly and uses its template for new records", async () => {
    const staged = await stageProfile(undefined, { ...labeledProfile, name: "Custom labels" });
    expect(staged.paused).toBe(true);
    const review = await profileReview(staged.id);
    expect(review.files).toEqual([]);
    await activateProfile(staged.id, review.token);
    await db().setting.create({ data: { key: "markdownDefaultProfile", value: staged.id } });
    const record = await db().application.create({ data: { company: "Template Company", role: "Engineer" } });
    await reconcile();
    const mapping = await link(record.id);
    expect(mapping.profileId).toBe(staged.id);
    expect(parseNote(await text(mapping.path), labeledProfile)).toMatchObject({ id: record.id, errors: [], values: { company: "Template Company" } });
  });
  it("preserves an existing unowned file and exposes retryable export failures", async () => {
    const record = await db().application.create({ data: { id: "blocked-export", company: "Keep safe", role: "Engineer" } });
    await mkdir(path.join(root, "notes/Applications"));
    const target = path.join(root, "notes/Applications/blocked-export.md");
    await writeFile(target, "Unowned original content");
    await reconcile();
    expect(await readFile(target, "utf8")).toBe("Unowned original content");
    expect((await db().markdownWork.findUniqueOrThrow({ where: { applicationId: record.id } })).error).toContain("existing file blocks export");
    await unlink(target);
    await reconcile();
    expect((await link(record.id)).state).toBe("linked");
  });
  it("leaves ordinary tracking operational with Markdown integration switched off", async () => {
    vi.stubEnv("DOSSIER_NOTES_ROOT", "");
    expect(await reconcile()).toEqual({ linked: 0 });
    await syncDocuments(); await exportObsidian();
    expect((await integrationView()).enabled).toBe(false);
    const app = await db().application.create({ data: { company: "Offline tracking" } });
    expect(app.company).toBe("Offline tracking");
    expect(await db().markdownWork.count()).toBe(1);
  });

});
