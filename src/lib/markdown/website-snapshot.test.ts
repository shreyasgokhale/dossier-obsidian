import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { fetchWebsiteResume, writeWebsiteSnapshot } from "./website-snapshot";
import { source, websiteConfig } from "@/test/website-resume-fixtures";

const revision = "a".repeat(40);
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("public website snapshots", () => {
  it("pins the content archive to one commit and selects only allowlisted content", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/commits/")) return Response.json({ id: revision });
      expect(url).toContain(`sha=${revision}`);
      expect(url).toContain("path=src%2Fcontent");
      return new Response(Buffer.from(zipSync({
        "site-main-commit/src/content/about/about.md": strToU8(source("about/about.md", {}).text),
        "site-main-commit/src/content/about/home.md": strToU8("ignored"),
        "site-main-commit/src/content/about/../../secret.md": strToU8("ignored"),
        "site-main-commit/src/content/subroutines/blog.md": strToU8("ignored"),
      })));
    });
    const result = await fetchWebsiteResume("example/public-site", "main", fetcher);
    expect(result.files.map((file) => file.path)).toEqual(["about/about.md"]);
    expect(result.revision).toBe(revision);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, options]) => options?.redirect === "error" && !options?.headers)).toBe(true);
  });

  it("rejects nonpublic/error responses, oversize bodies and unsafe project names", async () => {
    await expect(fetchWebsiteResume("../secret", "main", vi.fn())).rejects.toThrow("namespace/project");
    await expect(fetchWebsiteResume("example/private", "main", vi.fn(async () => new Response("", { status: 404 })))).rejects.toThrow("404");
    await expect(fetchWebsiteResume("example/public", "main", vi.fn(async () => new Response("x".repeat(1_000_001))))).rejects.toThrow("size limit");
    await expect(fetchWebsiteResume("example/public", "main", vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "120" } })))).rejects.toThrow("Retry after 120 seconds");
  });

  it("falls back only from an unsupported archive to paced, commit-pinned public file reads", async () => {
    const pace = vi.fn(async () => undefined);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/commits/")) return Response.json({ id: revision });
      if (url.includes("/archive.zip")) return new Response("", { status: 406 });
      expect(url).toContain(`ref=${revision}`);
      if (url.includes("/tree?path=src/content/about")) return Response.json([
        { path: "src/content/about/about.md", type: "blob" },
        { path: "src/content/about/home.md", type: "blob" },
        { path: "src/content/../secret.md", type: "blob" },
      ]);
      if (url.includes("/tree?")) return Response.json([]);
      return new Response(source("about/about.md", {}).text);
    });
    const result = await fetchWebsiteResume("example/public", "main", fetcher, pace);
    expect(result.files.map((file) => file.path)).toEqual(["about/about.md"]);
    expect(pace).toHaveBeenCalledTimes(7);
    expect(fetcher).toHaveBeenCalledTimes(9);
    const blocked = vi.fn<typeof fetch>(async (input) => String(input).includes("/commits/")
      ? Response.json({ id: revision }) : new Response("", { status: 429 }));
    await expect(fetchWebsiteResume("example/public", "main", blocked, pace)).rejects.toThrow("429");
    expect(blocked).toHaveBeenCalledTimes(2);
  });

  it("rejects expansion bombs, empty selections and excessive file counts before writing anything", async () => {
    const fetchZip = (files: Record<string, Uint8Array>) => vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/commits/") ? Response.json({ id: revision }) : new Response(Buffer.from(zipSync(files))));
    await expect(fetchWebsiteResume("example/public", "main", fetchZip({ "root/src/content/about/about.md": strToU8("x".repeat(1_000_001)) }))).rejects.toThrow("expanded size limit");
    await expect(fetchWebsiteResume("example/public", "main", fetchZip({ "root/src/content/blog/post.md": strToU8("ignored") }))).rejects.toThrow("No website résumé sources");
    const many = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`root/src/content/work/job_${i}.md`, strToU8("synthetic")]));
    await expect(fetchWebsiteResume("example/public", "main", fetchZip(many))).rejects.toThrow("Too many");
  });

  it("writes compatible sources and completion evidence without replacing existing snapshots", async () => {
    // realpath is needed on macOS, where os.tmpdir() may have symlink parents.
    const { realpath } = await import("node:fs/promises");
    const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "dossier-website-test-"));
    temporary.push(directory);
    const output = path.join(directory, "snapshot");
    const website = { project: "example/public-site", revision, files: [source("about/about.md", {}, "Synthetic summary.")] };
    const manifest = await writeWebsiteSnapshot(output, website, websiteConfig);
    expect(JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"))).toEqual(manifest);
    const text = await readFile(path.join(output, "about/about.en.md"), "utf8");
    expect(text).toContain("Synthetic summary.");
    await expect(writeWebsiteSnapshot(output, website, websiteConfig)).rejects.toThrow("EEXIST");
    expect(await readFile(path.join(output, "about/about.en.md"), "utf8")).toBe(text);
    const link = path.join(directory, "link");
    await symlink(output, link);
    await expect(writeWebsiteSnapshot(path.join(link, "new"), website, websiteConfig)).rejects.toThrow("symlinks");
    await expect(writeWebsiteSnapshot(path.join(process.cwd(), "fixtures", "new"), website, websiteConfig)).rejects.toThrow("outside the application checkout");
    await expect(writeWebsiteSnapshot("relative", website, websiteConfig)).rejects.toThrow("absolute path");
  });
});
