import { beforeEach, expect, it, vi } from "vitest";
import { recoverApplicationDraft } from "./recover-draft";
import { prisma } from "@/lib/prisma";
vi.mock("@/lib/prisma", () => ({ prisma: { job: { findUnique: vi.fn() } } }));
const extracted = {
  title: "Engineer · Example",
  company: "Example",
  role: "Engineer",
  location: "Berlin",
  mode: null,
  salary: null,
  deadline: null,
  requirements: [],
  asksForReferences: false,
  language: "English",
};
const result = {
  extracted,
  extractedWith: "extract-posting@1",
  match: { items: [] },
  matchedWith: "match@1",
};
beforeEach(() => vi.mocked(prisma.job.findUnique).mockReset());
it("recovers saved posting text, URL, source link and result after the browser closes", async () => {
  vi.mocked(prisma.job.findUnique).mockResolvedValue({
    id: "read",
    type: "read-posting",
    applicationId: null,
    key: null,
    status: "DONE",
    input: {
      posting: "Original input",
      postingUrl: "https://example.invalid/job",
      postingId: "source-posting",
    },
    result,
  } as never);
  expect(await recoverApplicationDraft("read", "WARM")).toMatchObject({
    step: "review",
    posting: "Original input",
    postingUrl: "https://example.invalid/job",
    postingId: "source-posting",
    readJobId: "read",
    details: { company: "Example", location: "Berlin" },
  });
});
it("reattaches unfinished and failed work without losing input", async () => {
  vi.mocked(prisma.job.findUnique).mockResolvedValue({
    id: "read",
    type: "read-posting",
    status: "FAILED",
    input: { posting: "Keep this" },
  } as never);
  expect(await recoverApplicationDraft("read", "WARM")).toMatchObject({
    step: "reading",
    posting: "Keep this",
    read: null,
  });
});
it("recovers written drafts with corrected metadata, tone and user notes", async () => {
  vi.mocked(prisma.job.findUnique)
    .mockResolvedValueOnce({
      id: "write",
      type: "write-documents",
      status: "DONE",
      input: {
        readJobId: "read",
        posting: "Original input",
        extracted: { ...extracted, company: "Corrected" },
        match: { items: [] },
        tone: "FORMAL",
        note: "Remember my relocation",
      },
    } as never)
    .mockResolvedValueOnce({
      id: "read",
      type: "read-posting",
      status: "DONE",
      input: { posting: "Original input" },
      result,
    } as never);
  expect(await recoverApplicationDraft("write", "WARM")).toMatchObject({
    step: "creating",
    writeJobId: "write",
    tone: "FORMAL",
    note: "Remember my relocation",
    details: { company: "Corrected" },
  });
});
it("refuses unavailable, malformed, unsupported and already-claimed jobs", async () => {
  for (const row of [
    null,
    { applicationId: "existing" },
    { key: "application:existing" },
    { type: "refine" },
    { type: "read-posting", input: {} },
    { type: "write-documents", input: {} },
  ]) {
    vi.mocked(prisma.job.findUnique).mockResolvedValue(row as never);
    expect(await recoverApplicationDraft("id", "WARM")).toBeNull();
  }
});
