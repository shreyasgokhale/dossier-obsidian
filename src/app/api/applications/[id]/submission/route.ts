import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { recordManualSubmission } from "@/lib/submission";
import { submittedFileName, SUBMISSION_DETAILS_LIMIT, SUBMISSION_MAX_BYTES, SUBMISSION_MAX_FILES } from "@/lib/submission-data";

const fields = z.object({
  submittedAt: z.iso.datetime().transform((value) => new Date(value)),
  details: z.string().trim().max(SUBMISSION_DETAILS_LIMIT),
  submittedText: z.string().max(SUBMISSION_DETAILS_LIMIT),
});

export const POST = route<RouteContext<"/api/applications/[id]/submission">>(async (request, { params }) => {
  const tooLarge = () => NextResponse.json({ error: "Choose up to 8 files totaling 5 MiB or less." }, { status: 413 });
  if (Number(request.headers.get("content-length")) > SUBMISSION_MAX_BYTES + 128 * 1024) return tooLarge();

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The submission upload could not be read." }, { status: 400 });

  const parsed = fields.safeParse({
    submittedAt: form.get("submittedAt"),
    details: form.get("details"),
    submittedText: form.get("submittedText"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Check the submission date and text length." }, { status: 400 });
  if (parsed.data.submittedAt > new Date()) {
    return NextResponse.json({ error: "Enter a valid submission date and time in the past." }, { status: 400 });
  }

  const entries = form.getAll("files");
  const files = entries.filter((entry): entry is File => typeof entry !== "string");
  if (files.length !== entries.length || files.some((file) => !submittedFileName.safeParse(file.name).success || file.size === 0)) {
    return NextResponse.json({ error: "Choose non-empty submitted files with valid filenames." }, { status: 400 });
  }
  if (files.length > SUBMISSION_MAX_FILES || files.reduce((size, file) => size + file.size, 0) > SUBMISSION_MAX_BYTES) return tooLarge();
  if (files.length === 0 && !parsed.data.submittedText.trim() && form.get("noDocuments") !== "on") {
    return NextResponse.json({ error: "Add the files or text you submitted, or confirm you applied without either." }, { status: 400 });
  }

  const { id } = await params;
  const outcome = await recordManualSubmission(prisma, id, {
    ...parsed.data,
    files: await Promise.all(files.map(async (file) => ({
      name: file.name,
      content: Buffer.from(await file.arrayBuffer()).toString("base64"),
    }))),
  });

  if (outcome === "conflict") return NextResponse.json({ error: "This application already has a different submission record. Refresh to review it." }, { status: 409 });
  if (outcome === "not-found") return NextResponse.json({ error: "That application no longer exists." }, { status: 404 });
  if (outcome === "awaiting-review") return NextResponse.json({ error: "Keep the draft before recording its submission." }, { status: 409 });
  revalidatePath("/", "layout");
  return NextResponse.json({ outcome }, { status: outcome === "recorded" ? 201 : 200 });
});
