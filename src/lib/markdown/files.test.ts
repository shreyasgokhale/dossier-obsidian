import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  readFile,
  symlink,
  rm,
  stat,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  notesRoot,
  safePath,
  readNote,
  listNotes,
  writeFileChecked,
  hash,
} from "./files";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dossier-files-test-"));
  await mkdir(path.join(root, "notes"));
  vi.stubEnv("DOSSIER_NOTES_ROOT", path.join(root, "notes"));
  vi.stubEnv("DOSSIER_DATA_DIR", path.join(root, "runtime"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
it("requires external absolute runtime roots and separates recovery state from synchronized notes", () => {
  expect(notesRoot()).toBe(path.join(root, "notes"));
  vi.stubEnv("DOSSIER_NOTES_ROOT", "relative");
  expect(() => notesRoot()).toThrow("absolute");
  vi.stubEnv("DOSSIER_NOTES_ROOT", path.join(process.cwd(), "fixtures/notes"));
  expect(() => notesRoot()).toThrow("checkout");
  vi.stubEnv("DOSSIER_NOTES_ROOT", path.join(root, "notes"));
  vi.stubEnv("DOSSIER_DATA_DIR", path.join(root, "notes/state"));
  expect(() => notesRoot()).toThrow("outside");
});
it("rejects traversal, symlinks, oversized files and non-directory parents", async () => {
  const base = notesRoot();
  for (const name of ["", "../x", "a/../x", "/x", "a\\x", "a//x", "./x"])
    await expect(safePath(base, name)).rejects.toThrow("relative");
  await writeFile(path.join(base, "file.md"), "small");
  await expect(safePath(base, "file.md/x")).rejects.toThrow("directory");
  await symlink(path.join(base, "file.md"), path.join(base, "link.md"));
  await expect(readNote(base, "link.md")).rejects.toThrow("Symlinks");
  await writeFile(path.join(base, "big.md"), "x".repeat(2_000_001));
  await expect(readNote(base, "big.md")).rejects.toThrow("2 MB");
  await expect(readNote(base, "missing/child.md")).rejects.toThrow();
});
it("writes atomically, rejects stale reads, preserves recovery bytes and ignores internal files", async () => {
  const base = notesRoot();
  await writeFileChecked(base, "folder/note.md", "old", null);
  expect((await stat(path.join(base, "folder/note.md"))).mode & 0o777).toBe(
    0o660,
  );
  await chmod(path.join(base, "folder/note.md"), 0o640);
  await writeFileChecked(base, "folder/note.md", "new", hash("old"));
  await writeFileChecked(base, "folder/note.md", "new", hash("new"));
  expect(await readNote(base, "folder/note.md")).toBe("new");
  expect((await stat(path.join(base, "folder/note.md"))).mode & 0o777).toBe(
    0o640,
  );
  const recovery = await readdir(path.join(root, "runtime/markdown-recovery"));
  expect(recovery).toHaveLength(1);
  expect(
    await readFile(
      path.join(root, "runtime/markdown-recovery", recovery[0]),
      "utf8",
    ),
  ).toBe("old");
  await expect(
    writeFileChecked(base, "folder/note.md", "oops", hash("old")),
  ).rejects.toThrow("changed since preview");
  await mkdir(path.join(base, ".hidden"));
  await writeFile(path.join(base, ".hidden/private.md"), "hidden");
  await writeFile(path.join(base, "skip.txt"), "skip");
  await symlink(path.join(base, "folder"), path.join(base, "sym"));
  expect(await listNotes(base)).toEqual(["folder/note.md"]);
  vi.stubEnv("DOSSIER_DATA_DIR", "");
  await expect(
    writeFileChecked(base, "folder/note.md", "third", hash("new")),
  ).rejects.toThrow("recovery");
});
