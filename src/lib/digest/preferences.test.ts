import { expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  acceptsPreference,
  matchesQuery,
  preferenceQueries,
  searchPreferencesSchema,
} from "./preferences";
import { identityKeys } from "./identity";
import type { FoundPosting } from "@/lib/job-search/search";
const job: FoundPosting = {
  source: "ARBEITNOW",
  externalId: "1",
  title: "Senior Software Engineer (m/w/d)",
  company: "Café Tools",
  place: "Berlin",
  remote: null,
  salary: "",
  postedAt: null,
  url: "https://jobs.example/1?utm_source=board#apply",
  via: "",
  description: "Build tools",
  complete: true,
};
it("keeps search intent independent of career data and bounds source requests", () => {
  const p = searchPreferencesSchema.parse(DEFAULT_PREFERENCES);
  expect(preferenceQueries(p)).toEqual([
    expect.objectContaining({
      keywords: "Software Engineer",
      place: "Berlin",
      country: "de",
      remoteOnly: false,
    }),
  ]);
  expect(
    searchPreferencesSchema.safeParse({ ...p, sources: ["ARBEITSAGENTUR"] })
      .success,
  ).toBe(false);
  expect(
    searchPreferencesSchema.safeParse({
      ...p,
      sources: ["COMPANY_BOARDS"],
      boards: [],
    }).success,
  ).toBe(false);
  expect(
    searchPreferencesSchema.safeParse({
      ...p,
      boards: [{ name: "x", provider: "lever", slug: "../../localhost" }],
    }).success,
  ).toBe(false);
});
it("enforces exclusions and explicit-only work preferences; preferred remote keeps unknowns", () => {
  expect(acceptsPreference(DEFAULT_PREFERENCES, job)).toBe(true);
  expect(
    acceptsPreference({ ...DEFAULT_PREFERENCES, exclusions: ["cafe"] }, job),
  ).toBe(false);
  expect(
    acceptsPreference({ ...DEFAULT_PREFERENCES, remote: "only" }, job),
  ).toBe(false);
  expect(
    acceptsPreference(
      { ...DEFAULT_PREFERENCES, remote: "onsite" },
      { ...job, remote: false },
    ),
  ).toBe(true);
  expect(
    acceptsPreference({ ...DEFAULT_PREFERENCES, remote: "preferred" }, job),
  ).toBe(true);
  const query = preferenceQueries(DEFAULT_PREFERENCES)[0];
  expect(matchesQuery(job, query)).toBe(true);
  expect(matchesQuery({ ...job, place: "Paris" }, query)).toBe(false);
  expect(matchesQuery({ ...job, title: "Recruiter" }, query)).toBe(false);
});
it("matches canonical links and role identities across sources, trackers and gender suffixes", () => {
  const keys = identityKeys(job);
  expect(
    identityKeys({
      ...job,
      source: "DAILY_BERLIN",
      externalId: "other",
      url: "https://www.jobs.example/1/",
    }).some((k) => keys.includes(k)),
  ).toBe(true);
  expect(
    identityKeys({
      ...job,
      source: "COMPANY_BOARDS",
      externalId: "another",
      url: "https://employer.example/other",
      company: "Cafe Tools",
      title: "Senior Software Engineer",
    }).some((k) => keys.includes(k)),
  ).toBe(true);
  expect(
    identityKeys({
      ...job,
      company: "Other Company",
      url: "https://jobs.example/other",
      externalId: "x",
    }).some((k) => keys.includes(k)),
  ).toBe(false);
});
