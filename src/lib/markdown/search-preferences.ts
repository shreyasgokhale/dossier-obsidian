import "server-only";
import { isMap, parseDocument } from "yaml";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import {
  searchPreferencesSchema,
  type SearchPreferences,
} from "@/lib/digest/preferences";
import { hash, notesRoot, readNote, writeFileChecked } from "./files";
import { MarkdownError } from "./format";
import { locked } from "./service";
export const PREFERENCES_FILE = "Search Preferences.md";
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : v;
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const preferencesRevision = (p: SearchPreferences | null) =>
  hash(JSON.stringify(p));
export function parsePreferencesNote(text: string) {
  const match = /^---\r?\n([\s\S]*?)^---[ \t]*\r?\n?/m.exec(text);
  if (!match || match.index !== 0)
    throw new MarkdownError("Search Preferences needs YAML frontmatter.");
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents))
    throw new MarkdownError(
      "Invalid Search Preferences YAML. Duplicate keys are not allowed.",
    );
  const result = searchPreferencesSchema.safeParse(
    doc.toJS({ maxAliasCount: 0 }),
  );
  if (!result.success)
    throw new MarkdownError(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return {
    preferences: result.data,
    doc,
    body: text.slice(match[0].length),
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}
export function writePreferencesNote(
  text: string | null,
  preferences: SearchPreferences,
): string {
  const parsed = text === null ? null : parsePreferencesNote(text);
  const doc = parsed?.doc ?? parseDocument("");
  for (const [key, value] of Object.entries(preferences)) doc.set(key, value);
  const eol = parsed?.eol ?? "\n";
  return `---${eol}${doc.toString().replace(/\n/g, eol)}---${eol}${parsed?.body ?? "# Search Preferences\n\nSearch intent only. Your career history stays in Profile.\n"}`;
}
type SyncConflict = {
  app: SearchPreferences | null;
  file: SearchPreferences;
  fileHash: string;
};
export async function syncSearchPreferences() {
  if (!process.env.DOSSIER_NOTES_ROOT) return;
  return locked(async (tx) => {
    try {
      const root = notesRoot();
      let text: string | null = null;
      try {
        text = await readNote(root, PREFERENCES_FILE);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const row = await tx.searchPreferenceSync.findUnique({
        where: { id: "preferences" },
      });
      const setting = await tx.setting.findUnique({
        where: { key: "searchPreferences" },
      });
      const app = setting
        ? searchPreferencesSchema.parse(JSON.parse(setting.value))
        : null;
      const file =
        text === null ? null : parsePreferencesNote(text).preferences;
      if (row?.conflict) {
        if (file)
          await tx.searchPreferenceSync.update({
            where: { id: "preferences" },
            data: {
              conflict: json({ app, file, fileHash: hash(text!) }),
              error: "Concurrent preference edits need review.",
            },
          });
        return;
      }
      if (!app && !file) return;
      const base = row?.snapshot as SearchPreferences | null;
      let next: SearchPreferences | null = app ?? file;
      // Never recreate a missing previously linked note; report it for review.
      if (row?.fileHash && text === null)
        throw new MarkdownError(
          "Search Preferences.md is missing. Restore it to resume synchronization; Dossier preferences are preserved.",
        );
      const appChanged = !same(base, app),
        fileChanged = !same(base, file);
      if (appChanged && fileChanged && file && app && !same(app, file)) {
        await tx.searchPreferenceSync.upsert({
          where: { id: "preferences" },
          create: {
            conflict: json({ app, file, fileHash: hash(text!) }),
            error: "Concurrent preference edits need review.",
          },
          update: {
            conflict: json({ app, file, fileHash: hash(text!) }),
            error: "Concurrent preference edits need review.",
          },
        });
        return;
      }
      if (fileChanged && file) next = file;
      if (!next) return;
      const after = writePreferencesNote(text, next);
      await writeFileChecked(
        root,
        PREFERENCES_FILE,
        after,
        text === null ? null : hash(text),
      );
      await saveSettings({ searchPreferences: next }, tx);
      await tx.searchPreferenceSync.upsert({
        where: { id: "preferences" },
        create: { snapshot: json(next), fileHash: hash(after) },
        update: { snapshot: json(next), fileHash: hash(after), error: null },
      });
    } catch (e) {
      const error =
        e instanceof Error ? e.message : "Preference synchronization failed.";
      await tx.searchPreferenceSync.upsert({
        where: { id: "preferences" },
        create: { error },
        update: { error },
      });
    }
  });
}
export async function saveSearchPreferences(
  preferences: SearchPreferences,
  expected: string,
) {
  await locked(async (tx) => {
    const current = await tx.setting.findUnique({
      where: { key: "searchPreferences" },
    });
    const value = current
      ? searchPreferencesSchema.parse(JSON.parse(current.value))
      : null;
    if (preferencesRevision(value) !== expected)
      throw new MarkdownError(
        "Preferences changed. Reload and review the current version.",
      );
    if (
      (
        await tx.searchPreferenceSync.findUnique({
          where: { id: "preferences" },
        })
      )?.conflict
    )
      throw new MarkdownError(
        "Resolve the preference conflict before editing.",
      );
    await saveSettings({ searchPreferences: preferences }, tx);
  });
  await syncSearchPreferences();
}
export async function resolvePreferenceConflict(
  choice: "app" | "file",
  expected: string,
) {
  await locked(async (tx) => {
    const row = await tx.searchPreferenceSync.findUniqueOrThrow({
      where: { id: "preferences" },
    });
    const conflict = row.conflict as SyncConflict | null;
    if (!conflict || hash(JSON.stringify(conflict)) !== expected)
      throw new MarkdownError("The conflict changed. Reload it first.");
    const text = await readNote(notesRoot(), PREFERENCES_FILE);
    const stored = await tx.setting.findUnique({
      where: { key: "searchPreferences" },
    });
    const app = stored
      ? searchPreferencesSchema.parse(JSON.parse(stored.value))
      : null;
    if (hash(text) !== conflict.fileHash || !same(app, conflict.app))
      throw new MarkdownError(
        "The file or Dossier changed again. Restore the reviewed version before resolving.",
      );
    const next = searchPreferencesSchema.parse(
      choice === "app" ? app : conflict.file,
    );
    const after = writePreferencesNote(text, next);
    await writeFileChecked(
      notesRoot(),
      PREFERENCES_FILE,
      after,
      conflict.fileHash,
    );
    await saveSettings({ searchPreferences: next }, tx);
    await tx.searchPreferenceSync.update({
      where: { id: "preferences" },
      data: {
        snapshot: json(next),
        fileHash: hash(after),
        conflict: Prisma.DbNull,
        error: null,
      },
    });
  });
}
export async function preferenceView() {
  const [settings, sync] = await Promise.all([
    loadSettings(),
    prisma.searchPreferenceSync.findUnique({ where: { id: "preferences" } }),
  ]);
  return {
    preferences: settings.searchPreferences,
    revision: preferencesRevision(settings.searchPreferences),
    enabled: settings.agentEnabled,
    hour: settings.agentHour,
    markdown: !!process.env.DOSSIER_NOTES_ROOT,
    error: sync?.error ?? null,
    conflict: sync?.conflict as SyncConflict | null,
    conflictToken: sync?.conflict ? hash(JSON.stringify(sync.conflict)) : null,
  };
}
