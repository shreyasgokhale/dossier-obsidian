import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { MarkdownError } from "./format";
import {
  convertWebsiteResume, isWebsiteResumePath,
  type WebsiteResumeConfig, type WebsiteSource,
} from "./website-resume";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 300;
const MAX_ARCHIVE_BYTES = 8_000_000;
const MAX_TOTAL_BYTES = 16_000_000;

class GitLabResponseError extends MarkdownError {
  constructor(readonly status: number, retry: string | null) {
    super(`Public GitLab request failed (${status}).${status === 429 && retry && /^\d+$/.test(retry) ? ` Retry after ${retry} seconds.` : ""}`);
  }
}

/** Public GitLab only: no authentication, redirects, HTML scraping or code execution. */
export async function fetchWebsiteResume(
  project: string,
  ref: string,
  fetcher: typeof fetch = fetch,
  pace: () => Promise<unknown> = () => delay(1500),
) {
  if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(project) ||
      project.split("/").some((part) => part === "." || part === ".."))
    throw new MarkdownError("Choose a public GitLab namespace/project.");
  const base = `https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/repository`;
  const get = async (url: string, maxBytes = MAX_FILE_BYTES) => {
    const response = await fetcher(url, {
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new GitLabResponseError(response.status, response.headers.get("retry-after"));
    }
    // Bound both ordinary and chunked responses before decoding/parsing them.
    if (!response.body) throw new MarkdownError("Empty GitLab response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw new MarkdownError("GitLab source exceeds the size limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  };
  const { id: revision } = z.object({ id: z.string().regex(/^[a-f0-9]{40}$/) }).parse(
    JSON.parse((await get(`${base}/commits/${encodeURIComponent(ref)}`)).toString("utf8")),
  );
  // Two requests per refresh: resolve the commit, then fetch its content archive.
  // Exclude the known blog collections server-side; filter everything again
  // before decompression. No archive entry is extracted to the filesystem.
  const params = new URLSearchParams({
    sha: revision, path: "src/content", include_lfs_blobs: "false",
    exclude_paths: "src/content/scribbles,src/content/subroutines,src/content/now",
  });
  let archive: Buffer;
  try {
    archive = await get(`${base}/archive.zip?${params}`, MAX_ARCHIVE_BYTES);
  } catch (error) {
    // Some public projects reject the ZIP representation with HTTP 406 while
    // their tree/raw APIs remain available. Read the same commit via those
    // ordinary APIs, at most 40 requests/minute. Never fall back on 403/429.
    if (!(error instanceof GitLabResponseError) || error.status !== 406) throw error;
    const files: WebsiteSource[] = [];
    let total = 0;
    for (const folder of ["about", "work", "education", "projects", "skills", "languages"]) {
      for (let page = 1; ; page++) {
        await pace();
        const entries = z.array(z.object({ path: z.string(), type: z.string() })).parse(
          JSON.parse((await get(`${base}/tree?path=src/content/${folder}&ref=${revision}&per_page=100&page=${page}`)).toString("utf8")),
        );
        for (const entry of entries) {
          if (entry.type !== "blob" || !entry.path.startsWith(`src/content/${folder}/`)) continue;
          const relative = entry.path.slice("src/content/".length);
          if (!isWebsiteResumePath(relative)) continue;
          if (files.length >= MAX_FILES) throw new MarkdownError("Too many website résumé source files.");
          await pace();
          const bytes = await get(`${base}/files/${encodeURIComponent(entry.path)}/raw?ref=${revision}`);
          total += bytes.length;
          if (total > MAX_TOTAL_BYTES) throw new MarkdownError("Website sources exceed the total size limit.");
          files.push({ path: relative, text: bytes.toString("utf8") });
        }
        if (entries.length < 100) break;
        if (page >= 4) throw new MarkdownError("Website collection exceeds the page limit.");
      }
    }
    if (!files.length) throw new MarkdownError("No website résumé sources were found.");
    return { project, revision, files };
  }
  let count = 0, total = 0;
  const relativePath = (name: string) => /^[^/]+\/src\/content\/(.+)$/.exec(name)?.[1];
  const selected = unzipSync(archive, {
    filter: (file) => {
      const relative = relativePath(file.name);
      if (!relative || !isWebsiteResumePath(relative)) return false;
      if (++count > MAX_FILES) throw new MarkdownError("Too many website résumé source files.");
      total += file.originalSize;
      if (file.originalSize > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES)
        throw new MarkdownError("Website archive exceeds the expanded size limit.");
      return true;
    },
  });
  const files: WebsiteSource[] = Object.entries(selected).map(([name, bytes]) => ({
    path: relativePath(name)!, text: Buffer.from(bytes).toString("utf8"),
  }));
  if (!files.length) throw new MarkdownError("No website résumé sources were found in the archive.");
  return { project, revision, files };
}

/** Create an immutable new source directory; never replace a previous snapshot. */
export async function writeWebsiteSnapshot(
  output: string,
  website: Awaited<ReturnType<typeof fetchWebsiteResume>>,
  config: WebsiteResumeConfig,
) {
  const converted = convertWebsiteResume(website.files, config);
  if (!path.isAbsolute(output)) throw new MarkdownError("Snapshot output must be an absolute path.");
  const destination = path.resolve(output);
  // Parents must already exist, be real directories and contain no symlinks.
  const parent = path.dirname(destination);
  let ancestor = path.parse(parent).root;
  for (const part of parent.slice(ancestor.length).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part);
    const stat = await lstat(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new MarkdownError("Snapshot parents must be directories without symlinks.");
  }
  const checkout = await realpath(process.cwd());
  const resolved = path.join(await realpath(parent), path.basename(destination));
  if (resolved === checkout || resolved.startsWith(checkout + path.sep))
    throw new MarkdownError("Keep runtime website snapshots outside the application checkout.");
  const manifest = {
    version: 1,
    project: website.project,
    revision: website.revision,
    configSha256: digest(JSON.stringify(config)),
    inputs: website.files.map((file) => ({ path: file.path, sha256: digest(file.text) })),
    outputs: converted.sources.map((file) => ({ path: file.path, sha256: digest(file.text) })),
    skipped: converted.skipped,
  };
  // No recursive mkdir here: EEXIST refuses stale or concurrent output selection.
  await mkdir(destination, { mode: 0o700 });
  for (const folder of new Set(converted.sources.map((file) => file.path.split("/")[0])))
    await mkdir(path.join(destination, folder), { mode: 0o700 });
  for (const file of converted.sources)
    await writeFile(path.join(destination, file.path), file.text, { flag: "wx", mode: 0o600 });
  // The manifest is the completion marker. A failed write leaves a partial
  // directory for inspection; only a completed snapshot may be mounted.
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return manifest;
}
