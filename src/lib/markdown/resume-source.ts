import { parseDocument } from "yaml";
import { z } from "zod";
import { MarkdownError } from "./format";

const collections = [
  "about",
  "experience",
  "education",
  "projects",
  "skills",
  "languages",
] as const;
const entrySchema = z.object({
  source_id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  collection: z.enum(collections),
  language: z.enum(["en", "de"]),
  name: z.string().default(""),
  headline: z.string().default(""),
  role: z.string().default(""),
  company: z.string().default(""),
  location: z.string().default(""),
  degree: z.string().default(""),
  school: z.string().default(""),
  link: z.string().default(""),
  group: z.string().trim().min(1).optional(),
  start: z
    .string()
    .regex(/^\d{4}(-(?:0[1-9]|1[0-2]))?$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{4}(-(?:0[1-9]|1[0-2]))?$/)
    .optional(),
  current: z.boolean().default(false),
  level: z.enum(["NATIVE", "C2", "C1", "B2", "B1", "A2", "A1"]).optional(),
});
export type Entry = z.infer<typeof entrySchema> & { body: string };
export function parseResumeSource(text: string): Entry {
  const match = /^---\r?\n([\s\S]*?)^---[ \t]*\r?\n?/m.exec(text);
  if (!match || match.index !== 0)
    throw new MarkdownError(
      "Resume sources require YAML frontmatter with source_id, collection and language.",
    );
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length)
    throw new MarkdownError(`Invalid source YAML: ${doc.errors[0].message}`);
  const entry = entrySchema.parse(doc.toJS());
  if (
    ["skills", "languages", "projects"].includes(entry.collection) &&
    !entry.name
  )
    throw new MarkdownError(`${entry.collection} sources require name.`);
  if (entry.collection === "languages" && !entry.level)
    throw new MarkdownError("Language sources require an explicit level.");
  return { ...entry, body: text.slice(match[0].length).trim() };
}
