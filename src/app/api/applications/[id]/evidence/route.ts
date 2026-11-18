import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApplicationEvidenceKind } from "@/generated/prisma/enums";
import { addApplicationEvidence } from "@/lib/application-evidence";
import { EVIDENCE_TEXT_LIMIT, RECORDING_MAX_BYTES } from "@/lib/application-evidence-data";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { submittedFileName } from "@/lib/submission-data";

const fields = z.object({
  kind: z.enum(ApplicationEvidenceKind),
  text: z.string().max(EVIDENCE_TEXT_LIMIT),
  correctsId: z.string().min(1).max(128).nullable(),
  occurredAt: z.iso.datetime().transform((value) => new Date(value)).nullable(),
});

export const POST = route<RouteContext<"/api/applications/[id]/evidence">>(async (request, { params }) => {
  const tooLarge = () => NextResponse.json({ error: "Choose a recording of 5 MiB or less." }, { status: 413 });
  if (Number(request.headers.get("content-length")) > RECORDING_MAX_BYTES + 512 * 1024) return tooLarge();
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The evidence upload could not be read." }, { status: 400 });

  const input = fields.safeParse({
    kind: form.get("kind"),
    text: form.get("text"),
    correctsId: form.get("correctsId"),
    occurredAt: form.get("occurredAt"),
  });
  if (!input.success || (input.data.occurredAt && input.data.occurredAt > new Date())) return NextResponse.json({ error: "Check the evidence type, date, and text length." }, { status: 400 });
  const files = form.getAll("file");
  const file = files[0];
  if (files.length > 1 || typeof file === "string" ||
    (file && (!submittedFileName.safeParse(file.name).success || file.size === 0 || input.data.kind !== ApplicationEvidenceKind.RECORDING))) {
    return NextResponse.json({ error: "Attach a single non-empty file to a recording entry." }, { status: 400 });
  }
  if (file && file.size > RECORDING_MAX_BYTES) return tooLarge();
  if (!file && !input.data.text.trim()) {
    return NextResponse.json({ error: "Enter the evidence text or attach a recording." }, { status: 400 });
  }
  if (!file && input.data.kind === ApplicationEvidenceKind.RECORDING && !input.data.correctsId) {
    return NextResponse.json({ error: "Choose the recording you want to retain." }, { status: 400 });
  }

  const { id } = await params;
  const result = await addApplicationEvidence(prisma, id, {
    ...input.data,
    correctsId: input.data.correctsId ?? undefined,
    occurredAt: input.data.occurredAt ?? undefined,
    file: file ? { name: file.name, content: Buffer.from(await file.arrayBuffer()).toString("base64") } : undefined,
  });
  if (result.outcome === "not-found") return NextResponse.json({ error: "That application no longer exists." }, { status: 404 });
  if (result.outcome === "invalid-correction") return NextResponse.json({ error: "The original evidence is unavailable for correction." }, { status: 409 });
  revalidatePath(`/applications/${id}/evidence`);
  return NextResponse.json(result, { status: 201 });
});
