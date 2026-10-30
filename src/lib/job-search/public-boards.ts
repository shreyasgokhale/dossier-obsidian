import "server-only";
import { z } from "zod";
import type { JobSourceAdapter, RequestContext } from "./adapter";
import { requestJson } from "./http";
import { JobSearchError, jobSearchError } from "./errors";
import {
  safeLink,
  POSTED_WITHIN,
  type FoundPosting,
  type JobSource,
} from "./search";
import { plainText } from "./text";
import { matchesQuery, type SearchPreferences } from "@/lib/digest/preferences";

// Endpoint contracts and local filtering adapted from berlin-job-search search.py.
// Copyright (c) 2026 Umut Yesildal, MIT; see docs/third-party/berlin-job-search-LICENSE.
const text = z
  .string()
  .nullish()
  .transform((v) => v ?? "");
const id = z.union([z.string(), z.number()]).transform(String);
const time = (v: unknown) => {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) && Number.isFinite(new Date(n).getTime())
    ? new Date(n).toISOString()
    : null;
};
function posting(
  source: JobSource,
  externalId: string,
  title: string,
  company: string,
  place: string,
  url: string,
  description: string,
  remote: boolean | null,
  posted: unknown,
  via = "",
): FoundPosting {
  return {
    source,
    externalId: externalId.slice(0, 500),
    title: title.slice(0, 500),
    company: company.slice(0, 300),
    place: place.slice(0, 300),
    url: safeLink(url).slice(0, 2000),
    description: plainText(description).slice(0, 100_000),
    remote,
    postedAt: time(posted),
    salary: "",
    via,
    complete: Boolean(description.trim()),
  };
}
export function parseArbeitnow(payload: unknown): FoundPosting[] {
  const result = z.object({ data: z.array(z.unknown()) }).parse(payload);
  return result.data.flatMap((v) => {
    const row = z
      .object({
        slug: id,
        title: text,
        company_name: text,
        location: text,
        url: text,
        description: text,
        remote: z.boolean().nullable().catch(null),
        created_at: z.number().optional(),
      })
      .safeParse(v);
    return row.success
      ? [
          posting(
            "ARBEITNOW",
            row.data.slug,
            row.data.title,
            row.data.company_name,
            row.data.location,
            row.data.url,
            row.data.description,
            row.data.remote,
            row.data.created_at ? row.data.created_at * 1000 : null,
          ),
        ]
      : [];
  });
}
export function parseDailyBerlin(payload: unknown): FoundPosting[] {
  const result = z.object({ jobs: z.array(z.unknown()) }).parse(payload);
  return result.jobs.flatMap((v) => {
    const row = z
      .object({
        id,
        title: text,
        company: text,
        location: text,
        url: text,
        description: text,
        source: text,
        work_mode: text,
        posted_date: text,
      })
      .safeParse(v);
    if (!row.success) return [];
    const r = row.data,
      mode = r.work_mode.toLowerCase();
    return [
      posting(
        "DAILY_BERLIN",
        r.id,
        r.title,
        r.company,
        r.location,
        r.url,
        r.description,
        mode === "remote"
          ? true
          : ["onsite", "on-site"].includes(mode)
            ? false
            : null,
        r.posted_date,
        r.source,
      ),
    ];
  });
}
export function parseCompanyBoard(
  payload: unknown,
  board: SearchPreferences["boards"][number],
): FoundPosting[] {
  const rows =
    board.provider === "lever"
      ? z.array(z.unknown()).parse(payload)
      : z.object({ jobs: z.array(z.unknown()) }).parse(payload).jobs;
  return rows.flatMap((raw) => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
    if (!parsed.success) return [];
    const r = parsed.data;
    const str = (key: string) =>
      typeof r[key] === "string" ? (r[key] as string) : "";
    const nested = (key: string, field: string) => {
      const v = r[key];
      return v &&
        typeof v === "object" &&
        typeof (v as Record<string, unknown>)[field] === "string"
        ? (v as Record<string, string>)[field]
        : "";
    };
    const jobId =
      typeof r.id === "number" || typeof r.id === "string"
        ? String(r.id)
        : str("jobUrl");
    const title = str("title") || str("text");
    if (!jobId || !title) return [];
    const place =
      typeof r.location === "string"
        ? r.location
        : nested("location", "name") || nested("categories", "location");
    const description =
      str("descriptionPlain") ||
      str("descriptionPlainText") ||
      str("content") ||
      str("descriptionHtml");
    const remote =
      typeof r.isRemote === "boolean"
        ? r.isRemote
        : str("workplaceType") === "remote"
          ? true
          : str("workplaceType") === "on-site"
            ? false
            : null;
    return [
      posting(
        "COMPANY_BOARDS",
        `${board.provider}:${board.slug}:${jobId}`,
        title,
        board.name,
        place,
        str("absolute_url") || str("hostedUrl") || str("jobUrl"),
        description,
        remote,
        r.first_published || r.publishedAt || r.createdAt,
        board.provider,
      ),
    ];
  });
}
export function boardUrl(board: SearchPreferences["boards"][number]): URL {
  const slug = encodeURIComponent(board.slug);
  return new URL(
    board.provider === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
      : board.provider === "lever"
        ? `https://api.lever.co/v0/postings/${slug}?mode=json&limit=100`
        : `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
  );
}
export async function searchCompanyBoard(
  board: SearchPreferences["boards"][number],
  context: RequestContext = {},
) {
  const url = context.baseUrl
    ? new URL(`${context.baseUrl}/${board.provider}/${board.slug}`)
    : boardUrl(board);
  try {
    return parseCompanyBoard(
      await requestJson("COMPANY_BOARDS", url, context),
      board,
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      throw jobSearchError("changed", "COMPANY_BOARDS");
    throw e;
  }
}
function adapter<S extends "ARBEITNOW" | "DAILY_BERLIN">(
  source: S,
  base: string,
  parse: (payload: unknown) => FoundPosting[],
): JobSourceAdapter<S> {
  return {
    source,
    async search(query, _credentials, _next, context = {}) {
      if (
        source === "DAILY_BERLIN" &&
        query.place &&
        !/berlin/i.test(query.place)
      )
        return { postings: [], next: null };
      const url = new URL(
        source === "ARBEITNOW" ? "/api/job-board-api?page=1" : "/api/v1/jobs",
        context.baseUrl ?? base,
      );
      // Keep a test prefix rather than stripping it with an absolute path.
      if (context.baseUrl)
        url.pathname =
          new URL(context.baseUrl).pathname.replace(/\/$/, "") + url.pathname;
      if (source === "DAILY_BERLIN") {
        url.searchParams.set("limit", "500");
        url.searchParams.set(
          "q",
          query.keywords
            .split(/\s+/)
            .toSorted((a, b) => b.length - a.length)[0],
        );
        if (query.remoteOnly) url.searchParams.set("work_mode", "Remote");
      }
      try {
        const days = POSTED_WITHIN.find(
          (p) => p.value === query.postedWithin,
        )?.days;
        const postings = parse(await requestJson(source, url, context)).filter(
          (p) =>
            matchesQuery(p, query) &&
            (!days ||
              !p.postedAt ||
              Date.parse(p.postedAt) >= Date.now() - days * 86400000),
        );
        return { postings, next: null };
      } catch (e) {
        if (e instanceof z.ZodError) throw jobSearchError("changed", source);
        throw e;
      }
    },
    async details() {
      return null;
    },
    async test(credentials, context) {
      await this.search(
        {
          keywords: "",
          place: "",
          country: "de",
          remoteOnly: false,
          radiusKm: 25,
          postedWithin: "any",
        },
        credentials,
        null,
        context,
      );
    },
  };
}
export const arbeitnow = adapter(
  "ARBEITNOW",
  "https://www.arbeitnow.com",
  parseArbeitnow,
);
export const dailyBerlin = adapter(
  "DAILY_BERLIN",
  "https://daily-berlin-jobs.vercel.app",
  parseDailyBerlin,
);
export const companyBoards: JobSourceAdapter<"COMPANY_BOARDS"> = {
  source: "COMPANY_BOARDS",
  async search(query, _credentials, _next, context) {
    const { loadSettings } = await import("@/lib/settings-data");
    const boards = (await loadSettings()).searchPreferences?.boards ?? [];
    if (!boards.length)
      throw new JobSearchError(
        "off",
        "Add company boards in Search Preferences first.",
      );
    const results = await Promise.allSettled(
      boards.map((board) => searchCompanyBoard(board, context)),
    );
    const postings = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((p) => matchesQuery(p, query));
    if (results.length && results.every((r) => r.status === "rejected"))
      throw jobSearchError("unavailable", "COMPANY_BOARDS");
    return { postings, next: null };
  },
  async details() {
    return null;
  },
  async test(credentials, context) {
    await this.search(
      {
        keywords: "",
        place: "",
        country: "de",
        remoteOnly: false,
        radiusKm: 25,
        postedWithin: "any",
      },
      credentials,
      null,
      context,
    );
  },
};
