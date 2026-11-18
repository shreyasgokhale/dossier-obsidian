import { afterAll, beforeEach, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { buildExport } from "./data-export";
import { importExport, parseExport } from "./data-import";
import { undoStatusChange } from "./status-changes";
import { recordManualSubmission } from "./submission";

const db = createTestClient();

beforeEach(async () => {
  await resetDatabase(db);
  await db.application.create({ data: { id: "role", company: "Northwind", role: "Engineer" } });
});
afterAll(() => db.$disconnect());

it("records the actual sent files once and keeps them when the draft changes", async () => {
  const submittedAt = new Date("2026-11-17T12:00:00Z");
  const input = {
    submittedAt,
    details: "Portal receipt 42",
    submittedText: "  Exact line\nnext line ",
    files: [{ name: "sent.pdf", content: Buffer.from("%PDF-original").toString("base64") }],
  };
  const results = await Promise.all([
    recordManualSubmission(db, "role", input),
    recordManualSubmission(db, "role", input),
  ]);
  expect(results.sort()).toEqual(["already-recorded", "recorded"]);
  expect(await recordManualSubmission(db, "role", { ...input, files: [] })).toBe("conflict");
  await db.application.update({ where: { id: "role" }, data: { company: "Edited company" } });
  const saved = await db.application.findUniqueOrThrow({ where: { id: "role" }, include: { submission: true } });
  const event = await db.statusEvent.findFirstOrThrow({ where: { applicationId: "role" } });
  expect(await undoStatusChange(db, event.id)).toEqual({ outcome: "superseded" });
  expect(saved).toMatchObject({
    status: "SENT",
    sentAt: submittedAt,
    submission: { submittedAt, company: "Northwind", role: "Engineer", details: input.details, submittedText: input.submittedText, files: input.files },
  });
});

it("adds an explicit receipt to a legacy application without reversing its progress", async () => {
  await db.application.update({
    where: { id: "role" },
    data: { status: "INTERVIEW", furthestStage: "INTERVIEW", sentAt: new Date("2026-11-18T12:00:00Z") },
  });
  const submittedAt = new Date("2026-11-17T12:00:00Z");
  expect(await recordManualSubmission(db, "role", { submittedAt, details: "Employer form", files: [] })).toBe("recorded");
  expect(await db.application.findUniqueOrThrow({ where: { id: "role" } })).toMatchObject({ status: "INTERVIEW", sentAt: submittedAt });
});


it("preserves the exact supplied bytes through a JSON export and import", async () => {
  const files = [{ name: "Résumé.pdf", content: "AAECAwQ=" }];
  await recordManualSubmission(db, "role", { submittedAt: new Date("2026-11-17T12:00:00Z"), details: "Applied online", files });
  const exported = parseExport(JSON.stringify(await buildExport(db)));
  if (!exported.ok) throw new Error(exported.error);
  await importExport(db, exported.data);
  const restored = await db.applicationSubmission.findUniqueOrThrow({ where: { applicationId: "role" } });
  expect(restored.files).toEqual(files);
});
