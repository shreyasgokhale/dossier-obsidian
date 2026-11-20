import { beforeEach, expect, it, vi } from "vitest";
import { discover } from "./search";
import { DEFAULT_PREFERENCES } from "./preferences";
import { searchPostings } from "@/lib/job-search";
import { searchCompanyBoard } from "@/lib/job-search/public-boards";
import { JobSearchError } from "@/lib/job-search/errors";
import type { FoundPosting } from "@/lib/job-search/search";
vi.mock("@/lib/job-search", () => ({ searchPostings: vi.fn() }));
vi.mock("@/lib/job-search/public-boards", () => ({
  searchCompanyBoard: vi.fn(),
}));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({}),
  credentialsFor: () => ({}),
  requestContext: () => ({}),
}));
const posting: FoundPosting = {
  source: "ARBEITNOW",
  externalId: "1",
  title: "Software Engineer",
  company: "Example",
  place: "Berlin",
  remote: true,
  salary: "",
  postedAt: null,
  url: "https://jobs.example/1",
  via: "",
  description: "Build tools",
  complete: true,
};
beforeEach(() => {
  vi.resetAllMocks();
});
it("isolates each source and board outage while keeping successful source results", async () => {
  vi.mocked(searchPostings).mockImplementation(async (source) => {
    if (source === "DAILY_BERLIN")
      throw new JobSearchError("unavailable", "Unavailable");
    return { postings: [posting], next: null };
  });
  vi.mocked(searchCompanyBoard).mockImplementation(async (board) => {
    if (board.slug === "bad") throw new Error("failed");
    return [{ ...posting, source: "COMPANY_BOARDS" }];
  });
  const found = await discover({
    ...DEFAULT_PREFERENCES,
    sources: ["ARBEITNOW", "DAILY_BERLIN", "COMPANY_BOARDS"],
    boards: [
      { name: "Good", provider: "greenhouse", slug: "good" },
      { name: "Bad", provider: "lever", slug: "bad" },
    ],
  });
  expect(found.postings).toHaveLength(2);
  expect(found.sources.map((s) => s.status)).toEqual([
    "ok",
    "failed",
    "ok",
    "failed",
  ]);
  expect(found.sources[3].message).toBe("The source could not be read.");
});
it("records partial multi-role searches and applies hard exclusions", async () => {
  vi.mocked(searchPostings)
    .mockResolvedValueOnce({ postings: [posting], next: null })
    .mockRejectedValueOnce(new Error("failed"));
  const found = await discover({
    ...DEFAULT_PREFERENCES,
    roles: ["Software Engineer", "Developer"],
    sources: ["ARBEITNOW"],
    exclusions: ["Example"],
  });
  expect(found.postings).toEqual([]);
  expect(found.sources[0].status).toBe("partial");
});
it("does not issue new requests after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const found = await discover(DEFAULT_PREFERENCES, controller.signal);
  expect(searchPostings).not.toHaveBeenCalled();
  expect(found.sources.every((s) => s.status === "failed")).toBe(true);
});
