import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTestClient, resetDatabase } from "@/test/db";
import { DEFAULT_PREFERENCES } from "@/lib/digest/preferences";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import {
  syncSearchPreferences,
  saveSearchPreferences,
  preferenceView,
  resolvePreferenceConflict,
  preferencesRevision,
  writePreferencesNote,
  parsePreferencesNote,
} from "./search-preferences";
const state = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestClient> | undefined,
}));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  state.db = createTestClient();
  return { prisma: state.db };
});
let root: string;
const db = () => state.db!;
const file = () => path.join(root, "notes", "Search Preferences.md");
beforeEach(async () => {
  await resetDatabase(db());
  root = await mkdtemp(path.join(os.tmpdir(), "dossier-preferences-test-"));
  await mkdir(path.join(root, "notes"));
  await mkdir(path.join(root, "data"));
  vi.stubEnv("DOSSIER_NOTES_ROOT", path.join(root, "notes"));
  vi.stubEnv("DOSSIER_DATA_DIR", path.join(root, "data"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db().$disconnect();
});
it("syncs both directions without career changes or per-job notes, and retries persisted app intent", async () => {
  await saveSearchPreferences(DEFAULT_PREFERENCES, preferencesRevision(null));
  expect(
    parsePreferencesNote(await readFile(file(), "utf8")).preferences,
  ).toEqual(DEFAULT_PREFERENCES);
  await writeFile(
    file(),
    writePreferencesNote(await readFile(file(), "utf8"), {
      ...DEFAULT_PREFERENCES,
      interests: ["Energy"],
    }),
  );
  await syncSearchPreferences();
  expect((await loadSettings()).searchPreferences?.interests).toEqual([
    "Energy",
  ]);
  await syncSearchPreferences();
  expect((await preferenceView()).conflict).toBeNull();
  expect(await db().profileField.count()).toBe(0);
  expect(await db().application.count()).toBe(0);
  expect(await db().markdownLink.count()).toBe(0);
  // A committed app edit remains pending when the process stops before its filesystem write.
  await saveSettings({
    searchPreferences: { ...DEFAULT_PREFERENCES, interests: ["Climate"] },
  });
  await syncSearchPreferences();
  expect(
    parsePreferencesNote(await readFile(file(), "utf8")).preferences.interests,
  ).toEqual(["Climate"]);
});
it("preserves concurrent versions, rejects stale resolution, and resolves the reviewed latest file", async () => {
  await saveSearchPreferences(DEFAULT_PREFERENCES, preferencesRevision(null));
  await saveSettings({
    searchPreferences: { ...DEFAULT_PREFERENCES, interests: ["App edit"] },
  });
  await writeFile(
    file(),
    writePreferencesNote(await readFile(file(), "utf8"), {
      ...DEFAULT_PREFERENCES,
      interests: ["File edit"],
    }),
  );
  await syncSearchPreferences();
  const view = await preferenceView();
  expect(view.conflict?.app?.interests).toEqual(["App edit"]);
  expect(view.conflict?.file.interests).toEqual(["File edit"]);
  await writeFile(
    file(),
    writePreferencesNote(await readFile(file(), "utf8"), {
      ...DEFAULT_PREFERENCES,
      interests: ["New file edit"],
    }),
  );
  await expect(
    resolvePreferenceConflict("file", view.conflictToken!),
  ).rejects.toThrow(/changed again/);
  await syncSearchPreferences();
  await resolvePreferenceConflict(
    "file",
    (await preferenceView()).conflictToken!,
  );
  expect((await loadSettings()).searchPreferences?.interests).toEqual([
    "New file edit",
  ]);
  expect((await preferenceView()).conflict).toBeNull();
});
it("reports invalid or deleted notes and never overwrites them", async () => {
  await saveSearchPreferences(DEFAULT_PREFERENCES, preferencesRevision(null));
  await writeFile(file(), "---\nroles: invalid\n---\nKeep me");
  await syncSearchPreferences();
  expect((await preferenceView()).error).toBeTruthy();
  expect(await readFile(file(), "utf8")).toContain("Keep me");
  expect((await loadSettings()).searchPreferences).toEqual(DEFAULT_PREFERENCES);
  await rm(file());
  await syncSearchPreferences();
  expect((await preferenceView()).error).toContain("missing");
});
it("imports a standalone preference note and rejects stale app edits and stale resolution tokens", async () => {
  await writeFile(file(),writePreferencesNote(null,DEFAULT_PREFERENCES));
  await syncSearchPreferences();
  await expect(saveSearchPreferences(DEFAULT_PREFERENCES,"stale")).rejects.toThrow(/changed/);
  await expect(resolvePreferenceConflict("app","stale")).rejects.toThrow(/changed/);
  expect((await loadSettings()).searchPreferences).toEqual(DEFAULT_PREFERENCES);
});
it("keeps an app choice on reviewed conflicts and blocks editing until review", async () => {
  await saveSearchPreferences(DEFAULT_PREFERENCES,preferencesRevision(null));
  await saveSettings({ searchPreferences: { ...DEFAULT_PREFERENCES,interests: ["App version"] } });
  await writeFile(file(),writePreferencesNote(await readFile(file(),"utf8"),{ ...DEFAULT_PREFERENCES,interests: ["File version"] }));
  await syncSearchPreferences();
  const view = await preferenceView();
  await expect(saveSearchPreferences(DEFAULT_PREFERENCES,view.revision)).rejects.toThrow(/Resolve/);
  await resolvePreferenceConflict("app",view.conflictToken!);
  expect(parsePreferencesNote(await readFile(file(),"utf8")).preferences.interests).toEqual(["App version"]);
});
