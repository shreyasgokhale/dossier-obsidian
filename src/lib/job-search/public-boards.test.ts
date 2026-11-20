import { afterEach, expect, it, vi } from "vitest";
import {
  parseArbeitnow,
  parseDailyBerlin,
  parseCompanyBoard,
  arbeitnow,
  dailyBerlin,
  searchCompanyBoard,
  boardUrl,
} from "./public-boards";
import { EMPTY_QUERY } from "./search";
import { json, stubFetch } from "@/lib/ai/test-http";
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn() }));
const query = {
  ...EMPTY_QUERY,
  country: "de",
  keywords: "Software Engineer",
  place: "Berlin",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("normalizes Arbeitnow and DBJ contracts, rejecting unsafe links and malformed records", () => {
  expect(
    parseArbeitnow({
      data: [
        null,
        {
          slug: "a",
          title: "Software Engineer",
          company_name: "Acme",
          location: "Berlin",
          remote: true,
          description: "<b>Hello</b>",
          url: "javascript:alert(1)",
          created_at: 1700000000,
        },
      ],
    }),
  ).toEqual([
    expect.objectContaining({
      description: "Hello",
      url: "",
      remote: true,
      postedAt: "2023-11-14T22:13:20.000Z",
    }),
  ]);
  expect(
    parseDailyBerlin({
      jobs: [
        { id: 1, title: "Engineer", work_mode: "Hybrid", source: "ats" },
        { id: 2, work_mode: "Remote" },
        { id: 3, work_mode: "On-site" },
      ],
    }).map((j) => [j.remote, j.complete]),
  ).toEqual([
    [null, false],
    [true, false],
    [false, false],
  ]);
  expect(() => parseDailyBerlin({ jobs: "broken" })).toThrow();
});
it("normalizes Greenhouse, Lever and Ashby fields without inferring remote from location", () => {
  const board = { name: "Acme", provider: "greenhouse" as const, slug: "acme" };
  expect(
    parseCompanyBoard(
      {
        jobs: [
          {
            id: 1,
            title: "Engineer",
            absolute_url: "https://jobs.example/1",
            location: { name: "Remote" },
            content: "<p>Build</p>",
          },
        ],
      },
      board,
    )[0],
  ).toMatchObject({
    company: "Acme",
    description: "Build",
    remote: null,
    externalId: "greenhouse:acme:1",
  });
  expect(
    parseCompanyBoard(
      [
        {
          id: "a",
          text: "Engineer",
          categories: { location: "Berlin" },
          workplaceType: "remote",
          descriptionPlain: "Build",
        },
      ],
      { ...board, provider: "lever" },
    )[0],
  ).toMatchObject({ remote: true, place: "Berlin" });
  expect(
    parseCompanyBoard(
      {
        jobs: [
          {
            id: "b",
            title: "Engineer",
            location: "Berlin",
            isRemote: false,
            jobUrl: "https://jobs.example/b",
            descriptionPlain: "Work",
          },
          {},
        ],
      },
      { ...board, provider: "ashby" },
    ),
  ).toHaveLength(1);
  expect(boardUrl(board).hostname).toBe("boards-api.greenhouse.io");
});
it("uses fixed API endpoints, filters feeds locally, and keeps test paths isolated", async () => {
  const requests = stubFetch(() =>
    json({
      data: [
        {
          slug: "ok",
          title: "Software Engineer",
          location: "Berlin",
          remote: true,
        },
        { slug: "wrong", title: "Recruiter", location: "Berlin" },
      ],
    }),
  );
  expect(
    (
      await arbeitnow.search(query, {}, null, {
        baseUrl: "http://localhost:3998/arbeitnow",
      })
    ).postings,
  ).toHaveLength(1);
  expect(String(requests[0].url)).toContain(
    "/arbeitnow/api/job-board-api?page=1",
  );
  expect(
    await dailyBerlin.search({ ...query, place: "Hamburg" }, {}, null),
  ).toEqual({ postings: [], next: null });
  stubFetch(() => json({ bad: [] }));
  await expect(dailyBerlin.search(query, {}, null)).rejects.toMatchObject({
    problem: "changed",
  });
  await expect(
    searchCompanyBoard({ name: "Acme", provider: "lever", slug: "acme" }),
  ).rejects.toMatchObject({ problem: "changed" });
});

it("tests configured company boards with real requests, preserving successful boards when another fails", async () => {
  const { companyBoards } = await import("./public-boards");
  const { loadSettings } = await import("@/lib/settings-data");
  const { settingsFromRows } = await import("@/lib/settings");
  const settings = settingsFromRows([]);
  vi.mocked(loadSettings).mockResolvedValue(settings);
  await expect(companyBoards.test({})).rejects.toMatchObject({
    problem: "off",
  });
  vi.mocked(loadSettings).mockResolvedValue({
    ...settings,
    searchPreferences: {
      roles: ["Engineer"],
      locations: [{ place: "Berlin", country: "de" }],
      remote: "any",
      exclusions: [],
      interests: [],
      sources: ["COMPANY_BOARDS"],
      boards: [
        { name: "Good", provider: "greenhouse", slug: "good" },
        { name: "Bad", provider: "lever", slug: "bad" },
      ],
    },
  });
  const requests = stubFetch((request) =>
    request.url.pathname.includes("good")
      ? json({
          jobs: [
            {
              id: 1,
              title: "Engineer",
              location: { name: "Berlin" },
              content: "Build",
            },
          ],
        })
      : json({}, { status: 503 }),
  );
  await expect(companyBoards.test({})).resolves.toBeUndefined();
  expect(requests).toHaveLength(2);
  expect((await companyBoards.search({ ...query,keywords: "Engineer" }, {}, null)).postings).toHaveLength(
    1,
  );
  stubFetch(() => json({}, { status: 503 }));
  await expect(companyBoards.test({})).rejects.toMatchObject({
    problem: "unavailable",
  });
});
