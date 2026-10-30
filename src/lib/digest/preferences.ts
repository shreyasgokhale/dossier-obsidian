import { z } from "zod";
import {
  EMPTY_QUERY,
  type FoundPosting,
  type SearchQuery,
} from "@/lib/job-search/search";

export const DIGEST_SOURCES = [
  "ARBEITNOW",
  "DAILY_BERLIN",
  "COMPANY_BOARDS",
  "FREEHIRE",
  "JSEARCH",
  "ADZUNA",
] as const;
const lines = z.array(z.string().trim().min(1).max(150)).max(30);
export const boardSchema = z.object({
  name: z.string().trim().min(1).max(150),
  provider: z.enum(["greenhouse", "lever", "ashby"]),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
});
export const searchPreferencesSchema = z
  .object({
    roles: lines.min(1).max(4),
    locations: z
      .array(
        z.object({
          place: z.string().trim().max(150),
          country: z.string().regex(/^[a-z]{2}$/),
        }),
      )
      .min(1)
      .max(3),
    remote: z.enum(["any", "preferred", "only", "onsite"]),
    exclusions: lines,
    interests: lines,
    sources: z
      .array(z.enum(DIGEST_SOURCES))
      .min(1)
      .max(6)
      .refine((v) => new Set(v).size === v.length, "Choose each source once."),
    boards: z.array(boardSchema).max(10),
  })
  .refine(
    (v) => !v.sources.includes("COMPANY_BOARDS") || v.boards.length > 0,
    "Add at least one company board or disable Company career boards.",
  );
export type SearchPreferences = z.infer<typeof searchPreferencesSchema>;
export const DEFAULT_PREFERENCES: SearchPreferences = {
  roles: ["Software Engineer"],
  locations: [{ place: "Berlin", country: "de" }],
  remote: "any",
  exclusions: [],
  interests: [],
  sources: ["ARBEITNOW", "DAILY_BERLIN"],
  boards: [],
};
export function preferenceQueries(p: SearchPreferences): SearchQuery[] {
  return p.roles.flatMap((keywords) =>
    p.locations.map((location) => ({
      ...EMPTY_QUERY,
      ...location,
      keywords,
      remoteOnly: p.remote === "only",
      postedWithin: "week" as const,
    })),
  );
}
const normalized = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
export function acceptsPreference(
  p: SearchPreferences,
  job: FoundPosting,
): boolean {
  const text = normalized([job.title, job.company, job.description].join(" "));
  if (p.exclusions.some((word) => text.includes(normalized(word))))
    return false;
  if (p.remote === "only" && job.remote !== true) return false;
  if (p.remote === "onsite" && job.remote !== false) return false;
  return true;
}
export function matchesQuery(job: FoundPosting, query: SearchQuery): boolean {
  const title = normalized(job.title);
  const words = normalized(query.keywords).match(/[\p{L}\p{N}+#]+/gu) ?? [];
  return (
    words.every((word) => title.includes(word)) &&
    (!query.remoteOnly || job.remote === true) &&
    (!query.place ||
      normalized(job.place).includes(normalized(query.place)) ||
      (query.remoteOnly && job.remote === true))
  );
}
