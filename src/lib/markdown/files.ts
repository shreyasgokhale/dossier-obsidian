import "server-only";
import { constants } from "node:fs";
import {
  lstat,
  realpath,
  readdir,
  open,
  mkdir,
  rename,
  unlink,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { MarkdownError } from "./format";
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function notesRoot(): string {
  const root = process.env.DOSSIER_NOTES_ROOT;
  if (!root || !path.isAbsolute(root))
    throw new MarkdownError(
      "Set DOSSIER_NOTES_ROOT to an absolute writable notes directory to enable Markdown integration.",
    );
  const resolved = path.resolve(root);
  const checkout = path.resolve(process.cwd());
  if (resolved === checkout || resolved.startsWith(checkout + path.sep))
    throw new MarkdownError(
      "Keep writable notes outside the application checkout; copy synthetic fixtures to an isolated runtime directory.",
    );
  const data = process.env.DOSSIER_DATA_DIR;
  if (
    !data ||
    !path.isAbsolute(data) ||
    path.resolve(data) === resolved ||
    path.resolve(data).startsWith(resolved + path.sep)
  )
    throw new MarkdownError(
      "Set DOSSIER_DATA_DIR to an absolute directory outside the synchronized notes root.",
    );
  return root;
}
/** Reject all symlinks, traversal and absolute paths, including existing parents. */
export async function safePath(
  root: string,
  relative: string,
  createParents = false,
): Promise<string> {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some((s) => ["", ".", ".."].includes(s))
  )
    throw new MarkdownError(
      "Choose a relative file path within the configured root.",
    );
  if ((await lstat(root)).isSymbolicLink())
    throw new MarkdownError("Symlinks are not allowed as an integration root.");
  const base = await realpath(root);
  let current = base;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink())
        throw new MarkdownError(
          "Symlinks are not allowed in integration paths.",
        );
      if (i < parts.length - 1 && !stat.isDirectory())
        throw new MarkdownError("A parent path is not a directory.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      if (i < parts.length - 1) {
        if (!createParents) throw e;
        await mkdir(current, { mode: 0o2770 });
        await chmod(current, 0o2770);
      }
    }
  }
  const parent = await realpath(path.dirname(current));
  if (parent !== base && !parent.startsWith(base + path.sep))
    throw new MarkdownError("Path escapes the configured root.");
  return current;
}
export async function readNote(root: string, file: string): Promise<string> {
  const full = await safePath(root, file);
  const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2_000_000)
      throw new MarkdownError("Notes must be regular files smaller than 2 MB.");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
export async function listNotes(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(folder: string) {
    if (files.length > 10_000)
      throw new MarkdownError(
        "Limit the configured root to 10,000 Markdown files.",
      );
    for (const entry of await readdir(
      folder ? await safePath(root, folder) : await realpath(root),
      { withFileTypes: true },
    )) {
      if (entry.name.startsWith(".")) continue;
      const file = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(file);
    }
  }
  await walk("");
  return files.sort();
}
/** Atomic replacement, stale-read guard, and a recoverable pre-write copy. */
export async function writeFileChecked(
  root: string,
  file: string,
  text: string,
  expected: string | null,
): Promise<void> {
  const full = await safePath(root, file, true);
  let before: string | null = null;
  try {
    before = await readNote(root, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if ((before === null ? null : hash(before)) !== expected)
    throw new MarkdownError(
      "The file changed since preview. Refresh the preview and review both versions.",
    );
  if (before === text) return;
  if (before !== null) {
    const recoveryRoot = process.env.DOSSIER_DATA_DIR;
    if (!recoveryRoot)
      throw new MarkdownError(
        "Set DOSSIER_DATA_DIR outside the notes root for recovery copies.",
      );
    await mkdir(recoveryRoot, { recursive: true });
    const recoveryPath = await safePath(
      recoveryRoot,
      `markdown-recovery/${hash(file)}-${hash(before)}.md`,
      true,
    );
    const recovery = await open(
      recoveryPath,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      if ((await recovery.stat()).size === 0) {
        await recovery.writeFile(before);
        await recovery.sync();
      }
    } finally {
      await recovery.close();
    }
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  const tempFull = await safePath(root, temp, true);
  const mode = before === null ? 0o660 : (await lstat(full)).mode & 0o777;
  const handle = await open(tempFull, "wx", mode);
  try {
    await handle.chmod(mode);
    await handle.writeFile(text);
    await handle.sync();
    await handle.close();
    await safePath(root, file);
    let latest: string | null = null;
    try {
      latest = hash(await readNote(root, file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (latest !== expected)
      throw new MarkdownError(
        "File changed during synchronization. Retry after reviewing it.",
      );
    await rename(tempFull, full);
  } finally {
    await handle.close().catch(() => {});
    await unlink(tempFull).catch(() => {});
  }
}
