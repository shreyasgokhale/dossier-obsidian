import { afterAll, beforeEach, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { addApplicationEvidence, loadApplicationEvidence } from "./application-evidence";
import { buildExport } from "./data-export";
import { importExport, parseExport } from "./data-import";

const db = createTestClient();

beforeEach(async () => {
  await resetDatabase(db);
  await db.application.createMany({ data: [{ id: "role" }, { id: "other-role" }] });
});
afterAll(() => db.$disconnect());

it("keeps a supplied employer reply and its correction on the correct application", async () => {
  const original = await addApplicationEvidence(db, "role", { kind: "REPLY", text: "Interview on Friday." });
  expect(original).toMatchObject({ outcome: "recorded" });
  if (original.outcome !== "recorded") throw new Error("Missing original evidence");
  const correction = { kind: "REPLY", text: "Interview on Thursday.", correctsId: original.id, occurredAt: new Date("2026-11-04T12:30:00Z") } as const;
  expect(await addApplicationEvidence(db, "other-role", correction)).toEqual({ outcome: "invalid-correction" });
  expect(await addApplicationEvidence(db, "role", correction)).toMatchObject({ outcome: "recorded" });
  expect(await loadApplicationEvidence(db, "other-role")).toEqual([]);
  expect(await loadApplicationEvidence(db, "role")).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: original.id, kind: "REPLY", text: "Interview on Friday.", correctsId: null }),
    expect.objectContaining({ ...correction }),
  ]));

  const exported = await buildExport(db);
  const corrected = exported.applications.find(({ id }) => id === "role")?.evidence?.find((entry) => entry.correctsId);
  if (!corrected) throw new Error("Expected the saved correction to be exported");
  corrected.correctsId = "missing";
  expect(parseExport(JSON.stringify(exported))).toMatchObject({ ok: false, error: expect.stringContaining("Invalid follow-up evidence history") });
});

it("keeps a recording with its interview transcript after export and restore", async () => {
  const file = { name: "interview.webm", content: "AQIDBA==" };
  await addApplicationEvidence(db, "role", { kind: "RECORDING", text: "Synthetic interview transcript.", file });
  const exported = parseExport(JSON.stringify(await buildExport(db)));
  if (!exported.ok) throw new Error(exported.error);
  await importExport(db, exported.data);
  expect(await loadApplicationEvidence(db, "role")).toEqual([
    expect.objectContaining({ kind: "RECORDING", text: "Synthetic interview transcript.", fileName: file.name }),
  ]);
  const restored = await db.applicationEvidence.findFirstOrThrow({ where: { applicationId: "role", kind: "RECORDING" } });
  expect(restored.fileContent).toBe(file.content);
});
