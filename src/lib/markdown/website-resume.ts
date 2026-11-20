import { createHash } from "node:crypto";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import { MarkdownError, parseDate } from "./format";
import { parseResumeSource } from "./resume-source";

const level = z.enum(["NATIVE", "C2", "C1", "B2", "B1", "A2", "A1"]);
export const websiteResumeConfig = z.object({
  // The website keeps these in TypeScript, outside its Markdown collections.
  // Supply them explicitly; never execute website code to read configuration.
  basics: z.object({
    en: z.object({ name: z.string().min(1), headline: z.string() }),
    de: z.object({ name: z.string().min(1), headline: z.string() }),
  }),
  // Keys are literal proficiency labels, e.g. "Bilingual" or "Citizen".
  // A nationality or informal description does not establish a CEFR level.
  languageLevels: z.record(z.string(), level).default({}),
}).strict();
export type WebsiteResumeConfig = z.input<typeof websiteResumeConfig>;
export type WebsiteSource = { path: string; text: string };

export function isWebsiteResumePath(file: string) {
  return /^(?:about\/(?:about|about-de)|(?:work|education|projects|skills|languages)\/[a-zA-Z0-9_-]+(?:\.de)?)\.md$/.test(file);
}

function month(value: unknown) {
  const text = z.string().parse(value);
  // Astro's current source uses MM/DD/YYYY; ISO dates are also unambiguous.
  const format = text.includes("/") ? "MM/DD/YYYY" : "YYYY-MM-DD";
  return parseDate(text, format).slice(0, 7);
}

/** Adapt only the public résumé collections, without AI or source mutations. */
export function convertWebsiteResume(
  files: WebsiteSource[],
  input: WebsiteResumeConfig,
) {
  const config = websiteResumeConfig.parse(input);
  const output: WebsiteSource[] = [];
  const skipped: string[] = [];
  const identities = new Set<string>();
  const emit = (fields: Record<string, unknown>, body: string) => {
    const text = `---\n${stringify(fields)}---\n${body.trim()}\n`;
    const entry = parseResumeSource(text);
    const identity = `${entry.collection}:${entry.source_id}:${entry.language}`;
    if (identities.has(identity))
      throw new MarkdownError(`Duplicate website source identity: ${identity}`);
    identities.add(identity);
    output.push({
      path: `${entry.collection}/${entry.source_id}.${entry.language}.md`,
      text,
    });
  };
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
    if (!isWebsiteResumePath(file.path)) {
      skipped.push(file.path);
      continue;
    }
    try {
      const match = /^---\r?\n([\s\S]*?)^---[ \t]*\r?\n?/m.exec(file.text);
      if (!match || match.index !== 0)
        throw new MarkdownError("Website sources require YAML frontmatter.");
      const yaml = parseDocument(match[1], { uniqueKeys: true });
      if (yaml.errors.length) throw new MarkdownError(yaml.errors[0].message);
      const data = z.record(z.string(), z.unknown()).parse(yaml.toJS());
      if (data.draft !== undefined) z.boolean().parse(data.draft);
      if (data.draft === true) {
        skipped.push(file.path);
        continue;
      }
      const language = z.enum(["en", "de"]).parse(data.lang ?? "en");
      const [folder, filename] = file.path.split("/");
      if ((filename.endsWith(".de.md") || filename === "about-de.md") !== (language === "de"))
        throw new MarkdownError("Filename and explicit language disagree.");
      const collection = folder === "work" ? "experience" : folder;
      const sourceId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(
        data.source_id ?? filename.replace(/(?:\.de)?\.md$/, "").replace(/^about-de$/, "about"),
      );
      const fields: Record<string, unknown> = {
        source_id: sourceId, collection, language,
      };
      let body = file.text.slice(match[0].length).trim();
      const required = (key: string) => z.string().min(1).parse(data[key]);
      switch (collection) {
        case "about":
          Object.assign(fields, config.basics[language]);
          break;
        case "experience":
        case "education": {
          const current = data.dateEnd === "Current";
          Object.assign(fields, {
            start: month(data.dateStart),
            ...(current ? { current: true } : { end: month(data.dateEnd) }),
            ...(collection === "experience"
              ? { company: required("company"), role: required("role"), location: required("location") }
              : { school: required("company"), degree: required("role") }),
          });
          break;
        }
        case "projects":
          Object.assign(fields, {
            name: required("title"), start: month(data.date),
            link: z.string().parse(data.demoURL ?? data.repoURL ?? ""),
          });
          body = [required("description"), body].filter(Boolean).join("\n\n");
          break;
        case "skills": {
          const group = z.string().trim().min(1).optional().parse(data.category);
          // The website renders one literal bullet as one skill.
          const skills = body.split(/\r?\n/).filter((line) => line.trim().startsWith("-"))
            .map((line) => line.trim().slice(1).trim()).filter(Boolean);
          if (!skills.length) throw new MarkdownError("A skill group needs bullet items.");
          for (const name of new Set(skills)) {
            const id = createHash("sha256").update(name).digest("hex").slice(0, 24);
            // A skill shared across website categories is still one skill.
            if (!identities.has(`skills:skill_${id}:${language}`))
              emit({ ...fields, source_id: `skill_${id}`, name, ...(group && { group }) }, name);
          }
          continue;
        }
        case "languages": {
          const proficiency = required("proficiency");
          const explicit = level.safeParse(proficiency);
          const mapped = config.languageLevels[proficiency] ?? (explicit.success ? explicit.data : undefined);
          if (!mapped)
            throw new MarkdownError(`Choose an explicit languageLevels mapping for ${JSON.stringify(proficiency)}; proficiency is never inferred.`);
          Object.assign(fields, { name: required("language"), level: mapped });
          body = [body, `Website proficiency: ${proficiency}`].filter(Boolean).join("\n\n");
          break;
        }
      }
      if (data.tags !== undefined) {
        const tags = z.array(z.string()).parse(data.tags);
        if (tags.length) body = [body, `Technologies: ${tags.join(", ")}`].filter(Boolean).join("\n\n");
      }
      emit(fields, body);
    } catch (error) {
      throw new MarkdownError(`${file.path}: ${(error as Error).message}`);
    }
  }
  if (!output.length) throw new MarkdownError("No website résumé sources were found.");
  return { sources: output, skipped };
}
