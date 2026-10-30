"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, ActionError } from "@/lib/action";
import {
  MarkdownError,
  parseNote,
  writeNote,
  fileDiff,
  renderTemplate,
} from "@/lib/markdown/format";
import { FIELDS, profileSchema } from "@/lib/markdown/profile";
import {
  integrationView,
  stageProfile,
  profileReview,
  activateProfile,
  adoptionPreview,
  adoptNote,
  reconcile,
  resolveConflict,
} from "@/lib/markdown/service";
import {
  exportObsidian,
  syncDocuments,
  repairDocument,
  resolveDocument,
} from "@/lib/markdown/documents";
import { resumePreview, importResume } from "@/lib/markdown/resume";
import { prisma } from "@/lib/prisma";
const values = z.partialRecord(
  z.enum([...FIELDS, "body", "postingText"]),
  z.string().max(100_000),
);
const request = z.discriminatedUnion("command", [
  z.object({ command: z.literal("default-profile"), id: z.string() }),
  z.object({ command: z.literal("refresh") }),
  z.object({ command: z.literal("reconcile") }),
  z.object({
    command: z.literal("stage"),
    id: z.string().optional(),
    config: z.unknown(),
  }),
  z.object({ command: z.literal("review"), id: z.string() }),
  z.object({
    command: z.literal("activate"),
    id: z.string(),
    token: z.string(),
  }),
  z.object({
    command: z.literal("preview"),
    file: z.string(),
    profileId: z.string(),
    fill: values,
  }),
  z.object({
    command: z.literal("adopt"),
    file: z.string(),
    profileId: z.string(),
    expected: z.string(),
    profileHash: z.string(),
    fill: values,
  }),
  z.object({
    command: z.literal("sample"),
    config: z.unknown(),
    text: z.string().max(2_000_000),
    values,
  }),
  z.object({
    command: z.literal("resolve"),
    id: z.string(),
    choices: z.record(z.string(), z.enum(["app", "file"])),
    expected: z.string(),
  }),
  z.object({
    command: z.literal("resume-preview"),
    language: z.enum(["en", "de"]),
  }),
  z.object({
    command: z.literal("resume-import"),
    language: z.enum(["en", "de"]),
    token: z.string(),
  }),
  z.object({
    command: z.literal("document-repair"),
    id: z.string(),
    expected: z.string(),
  }),
  z.object({
    command: z.literal("document-resolve"),
    id: z.string(),
    choice: z.enum(["app", "file"]),
    expected: z.string(),
  }),
]);
export const markdownCommand = action(request, async (input) => {
  try {
    switch (input.command) {
      case "default-profile": {
        const profile = await prisma.markdownProfile.findUnique({
          where: { id: input.id },
        });
        if (!profile || profile.paused)
          throw new MarkdownError(
            "Activate the reviewed profile before using it for new notes.",
          );
        await prisma.setting.upsert({
          where: { key: "markdownDefaultProfile" },
          create: { key: "markdownDefaultProfile", value: input.id },
          update: { value: input.id },
        });
        return { view: await integrationView() };
      }
      case "refresh":
        return {
          view: await integrationView(),
          documents: await prisma.markdownDocument.findMany(),
        };
      case "reconcile":
        await reconcile();
        await syncDocuments();
        await exportObsidian();
        revalidatePath("/", "layout");
        return {
          view: await integrationView(),
          documents: await prisma.markdownDocument.findMany(),
        };
      case "stage":
        return { staged: (await stageProfile(input.id, input.config)).id };
      case "review":
        return { review: await profileReview(input.id) };
      case "activate":
        await activateProfile(input.id, input.token);
        return { view: await integrationView() };
      case "preview":
        return {
          preview: await adoptionPreview(
            input.file,
            input.profileId,
            input.fill,
          ),
        };
      case "adopt": {
        const id = await adoptNote(
          input.file,
          input.profileId,
          input.expected,
          input.profileHash,
          input.fill,
        );
        revalidatePath("/", "layout");
        return { adopted: id, view: await integrationView() };
      }
      case "sample": {
        const p = profileSchema.parse(input.config),
          parsed = parseNote(input.text, p);
        const after = parsed.errors.length
          ? input.text
          : writeNote(input.text, p, input.values, parsed.id ?? "preview-id");
        return {
          sample: {
            parsed,
            after,
            diff: fileDiff(input.text, after),
            template: renderTemplate(p, input.values, "preview-id"),
          },
        };
      }
      case "resolve":
        await resolveConflict(input.id, input.choices, input.expected);
        revalidatePath("/", "layout");
        return { view: await integrationView() };
      case "resume-preview":
        return { resume: await resumePreview(input.language) };
      case "resume-import":
        await importResume(input.language, input.token);
        revalidatePath("/profile");
        return { resume: await resumePreview(input.language) };
      case "document-repair":
        await repairDocument(input.id, input.expected);
        return { documents: await prisma.markdownDocument.findMany() };
      case "document-resolve":
        await resolveDocument(input.id, input.choice, input.expected);
        return { documents: await prisma.markdownDocument.findMany() };
    }
  } catch (e) {
    if (e instanceof MarkdownError || e instanceof z.ZodError)
      throw new ActionError(e.message);
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new ActionError(
        "A file or runtime root is missing. Restore it, then retry.",
      );
    if (["EACCES", "EROFS"].includes((e as NodeJS.ErrnoException).code ?? ""))
      throw new ActionError(
        "The notes mount is not writable. Fix its permissions, then retry synchronization.",
      );
    throw e;
  }
});
