import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { websiteResumeConfig } from "../src/lib/markdown/website-resume.ts";
import { fetchWebsiteResume, writeWebsiteSnapshot } from "../src/lib/markdown/website-snapshot.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" }, ref: { type: "string", default: "main" },
      config: { type: "string" }, output: { type: "string" },
    },
  });
  if (!values.project || !values.config || !values.output) {
    throw new Error("Usage: yarn resume:website --project namespace/project --config /absolute/config.json --output /absolute/new-snapshot [--ref main|COMMIT]");
  }
  const config = websiteResumeConfig.parse(JSON.parse(await readFile(values.config, "utf8")));
  const website = await fetchWebsiteResume(values.project, values.ref!);
  const manifest = await writeWebsiteSnapshot(values.output, website, config);
  console.log(`Created ${manifest.outputs.length} résumé sources from public GitLab commit ${manifest.revision}.`);
  console.log(`Snapshot: ${values.output}; skipped ${manifest.skipped.length} non-résumé or draft files.`);
  console.log("Mount the completed snapshot read-only, then preview and confirm its import in Settings → Markdown integration.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Website snapshot failed.");
  process.exitCode = 1;
});
