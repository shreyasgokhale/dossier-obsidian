import "server-only";
import { searchPostings } from "@/lib/job-search";
import {
  credentialsFor,
  loadJobSearchConfig,
  requestContext,
} from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { searchCompanyBoard } from "@/lib/job-search/public-boards";
import { type FoundPosting } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import {
  acceptsPreference,
  matchesQuery,
  preferenceQueries,
  type SearchPreferences,
} from "./preferences";
export type SourceReport = {
  source: string;
  status: "ok" | "partial" | "failed" | "skipped";
  count: number;
  message: string;
};
export async function discover(
  p: SearchPreferences,
  signal?: AbortSignal,
): Promise<{ postings: FoundPosting[]; sources: SourceReport[] }> {
  const config = await loadJobSearchConfig();
  const queries = preferenceQueries(p);
  const tasks = p.sources.flatMap((source) =>
    source === "COMPANY_BOARDS"
      ? p.boards.map((board) => ({
          name: `${board.name} (${board.provider})`,
          requests: [
            () =>
              searchCompanyBoard(board, {
                ...requestContext(source),
                signal,
              }).then((jobs) =>
                jobs.filter((job) => queries.some((q) => matchesQuery(job, q))),
              ),
          ],
        }))
      : [
          {
            name: SOURCE_INFO[source].name,
            requests: queries.map(
              (query) => () =>
                searchPostings(
                  source,
                  credentialsFor(config, source),
                  query,
                  null,
                  { ...requestContext(source), signal },
                ).then((page) => page.postings),
            ),
          },
        ],
  );
  // Sources run independently; requests within one source are sequential and bounded.
  const results = await Promise.all(
    tasks.map(async (task) => {
      const postings: FoundPosting[] = [],
        errors: string[] = [];
      let successes = 0;
      for (const request of task.requests) {
        if (signal?.aborted) {
          errors.push("Run interrupted.");
          break;
        }
        try {
          postings.push(...(await request()));
          successes++;
        } catch (e) {
          errors.push(
            e instanceof JobSearchError
              ? e.message
              : "The source could not be read.",
          );
        }
      }
      return {
        postings: postings.filter((job) => acceptsPreference(p, job)),
        report: {
          source: task.name,
          status: errors.length ? (successes ? "partial" : "failed") : "ok",
          count: postings.length,
          message: [...new Set(errors)].join(" "),
        } satisfies SourceReport,
      };
    }),
  );
  return {
    postings: results.flatMap((r) => r.postings),
    sources: results.map((r) => r.report),
  };
}
