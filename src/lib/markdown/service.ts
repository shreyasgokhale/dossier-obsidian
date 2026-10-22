import "server-only";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type Application,
  type MarkdownLink,
} from "@/generated/prisma/client";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { applyStatusChangeTx } from "@/lib/status-changes";
import {
  defaultProfile,
  labeledProfile,
  FIELDS,
  matchesFile,
  profileSchema,
  type FormatProfile,
  type Values,
} from "./profile";
import {
  MarkdownError,
  parseNote,
  writeNote,
  renderTemplate,
  fileDiff,
} from "./format";
import {
  hash,
  listNotes,
  notesRoot,
  readNote,
  writeFileChecked,
} from "./files";
import { mergeValues, type Conflict } from "./merge";

type DB = Prisma.TransactionClient;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const date = (value: string) =>
  value ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : null;
const isoDate = (value: Date | null) => value?.toISOString().slice(0, 10) ?? "";
export function applicationValues(app: Application, body: string): Values {
  return {
    company: app.company,
    role: app.role,
    status: app.status,
    applicationDate: isoDate(app.applicationDate),
    postingUrl: app.postingUrl,
    location: app.location,
    deadline: isoDate(app.deadline),
    nextAction: app.nextAction,
    followUpDate: isoDate(app.followUpDate),
    nextInterviewAt: app.nextInterviewAt?.toISOString() ?? "",
    body,
    postingText: app.postingText,
  };
}
/** One integration writer across requests, watcher and workers, released on rollback/crash. */
export async function locked<T>(run: (tx: DB) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(13824671)::text`;
      return run(tx);
    },
    { timeout: 60_000, maxWait: 60_000 },
  );
}
export async function ensureProfiles() {
  if ((await prisma.markdownProfile.count()) === 0) {
    await prisma.markdownProfile.createMany({
      data: [
        { id: "default-frontmatter", config: json(defaultProfile) },
        { id: "default-labels", config: json(labeledProfile) },
      ],
      skipDuplicates: true,
    });
  }
  return prisma.markdownProfile.findMany({ orderBy: { id: "asc" } });
}
async function appState(tx: DB, link: MarkdownLink) {
  await tx.$queryRaw`SELECT 1 FROM "Application" WHERE id = ${link.applicationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT 1 FROM "Note" WHERE id = ${link.noteId} FOR UPDATE`;
  const app = await tx.application.findUniqueOrThrow({
    where: { id: link.applicationId },
  });
  const note = await tx.note.findUnique({ where: { id: link.noteId } });
  if (!note)
    throw new MarkdownError(
      "The associated Dossier note was deleted. Restore it or unlink this Markdown mapping before continuing.",
    );
  return applicationValues(app, note.body);
}
/** Reuses the status domain and writes its history in the import transaction. */
async function importValues(
  tx: DB,
  id: string,
  noteId: string,
  before: Values,
  next: Values,
) {
  if (next.status !== undefined && next.status !== before.status) {
    if (!next.status)
      throw new MarkdownError("Status cannot be empty. Choose a status alias.");
    await applyStatusChangeTx(tx, id, next.status as ApplicationStatus);
  }
  const data: Prisma.ApplicationUpdateInput = {};
  for (const key of [
    "company",
    "role",
    "postingUrl",
    "location",
    "nextAction",
    "postingText",
  ] as const)
    if (next[key] !== undefined && next[key] !== before[key])
      data[key] = next[key];
  for (const key of [
    "applicationDate",
    "deadline",
    "followUpDate",
    "nextInterviewAt",
  ] as const)
    if (next[key] !== undefined && next[key] !== before[key])
      data[key] = date(next[key]!);
  if (Object.keys(data).length)
    await tx.application.update({ where: { id }, data });
  if (next.body !== undefined && next.body !== before.body)
    await tx.note.update({ where: { id: noteId }, data: { body: next.body } });
}
export async function adoptionPreview(
  file: string,
  profileId: string,
  fill: Values = {},
) {
  const row = await prisma.markdownProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  const profile = profileSchema.parse(row.config);
  if (!matchesFile(file, profile))
    throw new MarkdownError(
      "This file does not match the profile's selection rules.",
    );
  const before = await readNote(notesRoot(), file);
  const parsed = parseNote(before, profile);
  if (parsed.id)
    throw new MarkdownError(
      "This note already has a stable ID. Resolve its existing mapping before adoption.",
    );
  // Fill only missing/empty values, after a user reviews the resulting diff.
  const values = { ...parsed.values };
  for (const key of FIELDS)
    if (!values[key] && fill[key] !== undefined) values[key] = fill[key];
  const id = `md_${hash(file + hash(before) + profileId).slice(0, 24)}`;
  const after = parsed.errors.length
    ? before
    : writeNote(before, profile, values, id);
  return {
    file,
    profileId,
    id,
    before,
    after,
    hash: hash(before),
    profileHash: hash(JSON.stringify(profile)),
    parsed,
    values,
    diff: fileDiff(before, after),
    creates: FIELDS.filter(
      (f) => parsed.values[f] === undefined && values[f] !== undefined,
    ),
  };
}
export async function adoptNote(
  file: string,
  profileId: string,
  expected: string,
  profileHash: string,
  fill: Values,
) {
  const adopted = await locked(async (tx) => {
    const preview = await adoptionPreview(file, profileId, fill);
    if (preview.hash !== expected || preview.profileHash !== profileHash)
      throw new MarkdownError(
        "The file or profile changed. Review a new adoption preview.",
      );
    if (preview.parsed.errors.length)
      throw new MarkdownError(preview.parsed.errors.join("\n"));
    const { company, role, status } = preview.values;
    if (!company || !role || !status)
      throw new MarkdownError(
        "Fill Company, Role and Status before confirming adoption.",
      );
    const existing = await tx.markdownLink.findUnique({
      where: { path: file },
    });
    if (existing) {
      if (
        existing.applicationId === preview.id &&
        existing.state === "adopting"
      )
        return existing.applicationId;
      throw new MarkdownError("This file is already adopted.");
    }
    const app = await tx.application.create({
      data: { id: preview.id, title: `${role} · ${company}` },
    });
    const note = await tx.note.create({
      data: { applicationId: app.id, body: preview.values.body ?? "" },
    });
    await importValues(
      tx,
      app.id,
      note.id,
      applicationValues(app, note.body),
      preview.values,
    );
    // Commit the application and adoption intent before touching the file.
    // A crash here is recovered by startup reconciliation.
    await tx.markdownLink.create({
      data: {
        applicationId: app.id,
        noteId: note.id,
        profileId,
        path: file,
        snapshot: json(preview.values),
        contentHash: expected,
        state: "adopting",
      },
    });
    return app.id;
  });
  await reconcile();
  return adopted;
}
async function exportNew(tx: DB, applicationId: string, profileId: string) {
  const row = await tx.markdownProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  if (row.paused) return;
  const profile = profileSchema.parse(row.config);
  const app = await tx.application.findUnique({ where: { id: applicationId } });
  if (!app || app.awaitingReview) return;
  const file = `Applications/${app.id}.md`;
  if (!matchesFile(file, profile)) return;
  const note = await tx.note.findFirst({
    where: { applicationId },
    orderBy: { createdAt: "asc" },
  });
  let values = applicationValues(app, note?.body ?? "");
  if (!note) delete values.body;
  if (!profile.postingHeading) delete values.postingText;
  const text = renderTemplate(profile, values, applicationId);
  values = { ...values, ...parseNote(text, profile).values };
  const associated =
    note ??
    (await tx.note.create({
      data: { applicationId, body: values.body ?? "" },
    }));
  let existingText: string | null = null;
  try {
    existingText = await readNote(notesRoot(), file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (existingText !== null && existingText !== text)
    throw new MarkdownError(
      "An existing file blocks export. Move it aside or adopt it explicitly.",
    );
  await writeFileChecked(
    notesRoot(),
    file,
    text,
    existingText === null ? null : hash(existingText),
  );
  await tx.markdownLink.create({
    data: {
      applicationId,
      noteId: associated.id,
      profileId,
      path: file,
      snapshot: json(values),
      contentHash: hash(text),
    },
  });
}
/** Scans stable IDs first so duplicate IDs block every affected file. */
async function scan(profiles: { id: string; config: unknown }[]) {
  const files = await listNotes(notesRoot());
  const ids = new Map<string, Set<string>>();
  const texts = new Map<string, string>();
  for (const file of files) {
    for (const row of profiles) {
      const profile = profileSchema.parse(row.config);
      if (!matchesFile(file, profile)) continue;
      const text = texts.get(file) ?? (await readNote(notesRoot(), file));
      texts.set(file, text);
      const parsed = parseNote(text, profile);
      if (parsed.id) {
        const set = ids.get(parsed.id) ?? new Set<string>();
        set.add(file);
        ids.set(parsed.id, set);
      }
    }
  }
  return { files, texts, ids };
}
export async function reconcile() {
  if (!process.env.DOSSIER_NOTES_ROOT) return { linked: 0 };
  await ensureProfiles();
  return locked(async (tx) => {
    const profiles = await tx.markdownProfile.findMany();
    const scanned = await scan(profiles);
    const links = await tx.markdownLink.findMany({
      include: { profile: true },
    });
    for (const link of links) {
      if (link.profile.paused) continue;
      try {
        const found = [...(scanned.ids.get(link.applicationId) ?? [])];
        if (found.length > 1)
          throw new MarkdownError(
            `Duplicate stable ID in: ${found.join(", ")}. Remove the duplicate ID before retrying.`,
          );
        let file = found[0];
        if (
          !file &&
          link.state === "adopting" &&
          scanned.files.includes(link.path)
        ) {
          const pendingText =
            scanned.texts.get(link.path) ??
            (await readNote(notesRoot(), link.path));
          if (hash(pendingText) !== link.contentHash)
            throw new MarkdownError(
              "Adoption is saved, but the file changed before its ID was added. Restore the reviewed file or add the application ID shown in Dossier to reconnect it.",
            );
          file = link.path;
          const completed = writeNote(
            pendingText,
            profileSchema.parse(link.profile.config),
            link.snapshot as Values,
            link.applicationId,
          );
          await writeFileChecked(
            notesRoot(),
            file,
            completed,
            link.contentHash,
          );
          scanned.texts.set(file, completed);
        }
        if (!file) {
          // A damaged ID or malformed YAML at the old path is a failure, not a deletion.
          if (scanned.files.includes(link.path)) {
            const parsed = parseNote(
              scanned.texts.get(link.path) ??
                (await readNote(notesRoot(), link.path)),
              profileSchema.parse(link.profile.config),
            );
            throw new MarkdownError(
              parsed.errors.join("\n") ||
                "Stable ID is missing or changed. Restore the original ID to reconnect this file.",
            );
          }
          await tx.markdownLink.update({
            where: { applicationId: link.applicationId },
            data: {
              state: "unlinked",
              error:
                "File is missing. The application is preserved; restore the file with its stable ID to reconnect.",
            },
          });
          continue;
        }
        if (file !== link.path)
          await tx.markdownLink.update({
            where: { applicationId: link.applicationId },
            data: { path: file },
          });
        const profile = profileSchema.parse(link.profile.config);
        const text = scanned.texts.get(file)!;
        const parsed = parseNote(text, profile);
        if (parsed.errors.length)
          throw new MarkdownError(parsed.errors.join("\n"));
        const app = await appState(tx, link);
        // Only explicitly mapped posting sections are editable.
        if (!profile.postingHeading) delete app.postingText;
        for (const key of FIELDS)
          if (
            parsed.values[key] === undefined &&
            (link.snapshot as Values)[key] === undefined &&
            app[key] === ""
          )
            delete app[key];
        const merged = mergeValues(link.snapshot as Values, app, parsed.values);
        if (link.conflict || merged.conflicts.length) {
          await tx.markdownLink.update({
            where: { applicationId: link.applicationId },
            data: {
              state: "conflict",
              conflict: json({
                base: link.snapshot,
                app,
                file: parsed.values,
                conflicts: merged.conflicts,
                fileHash: hash(text),
              }),
              error:
                "Concurrent edits need review. Both versions are preserved.",
            },
          });
          continue;
        }
        const after = writeNote(
          text,
          profile,
          merged.values,
          link.applicationId,
        );
        Object.assign(merged.values, parseNote(after, profile).values);
        await importValues(
          tx,
          link.applicationId,
          link.noteId,
          app,
          merged.values,
        );
        await writeFileChecked(notesRoot(), file, after, hash(text));
        await tx.markdownLink.update({
          where: { applicationId: link.applicationId },
          data: {
            path: file,
            snapshot: json(merged.values),
            contentHash: hash(after),
            state: "linked",
            error: null,
          },
        });
        await tx.markdownWork.deleteMany({
          where: { applicationId: link.applicationId },
        });
      } catch (e) {
        await tx.markdownLink.update({
          where: { applicationId: link.applicationId },
          data: {
            state: link.state === "adopting" ? "adopting" : "failed",
            error: (e as Error).message,
          },
        });
        await tx.markdownWork.upsert({
          where: { applicationId: link.applicationId },
          create: {
            applicationId: link.applicationId,
            attempts: 1,
            error: (e as Error).message,
          },
          update: { attempts: { increment: 1 }, error: (e as Error).message },
        });
      }
    }
    const chosen =
      (
        await tx.setting.findUnique({
          where: { key: "markdownDefaultProfile" },
        })
      )?.value ?? process.env.DOSSIER_MARKDOWN_PROFILE;
    const defaultRow =
      profiles.find(
        (p) => p.id === chosen || (p.config as FormatProfile).name === chosen,
      ) ?? profiles.find((p) => p.id === "default-frontmatter");
    if (defaultRow) {
      const unlinked = await tx.application.findMany({
        where: { markdown: null, awaitingReview: false },
        select: { id: true },
      });
      for (const app of unlinked) {
        try {
          await exportNew(tx, app.id, defaultRow.id);
          await tx.markdownWork.deleteMany({
            where: { applicationId: app.id },
          });
        } catch (e) {
          await tx.markdownWork.upsert({
            where: { applicationId: app.id },
            create: {
              applicationId: app.id,
              error: (e as Error).message,
              attempts: 1,
            },
            update: { error: (e as Error).message, attempts: { increment: 1 } },
          });
        }
      }
    }
    await tx.markdownWork.deleteMany({
      where: {
        applicationId: {
          notIn: (await tx.application.findMany({ select: { id: true } })).map(
            (a) => a.id,
          ),
        },
      },
    });
    return { linked: links.length };
  });
}
export async function resolveConflict(
  applicationId: string,
  choices: Record<string, "app" | "file">,
  expected: string,
) {
  return locked(async (tx) => {
    const link = await tx.markdownLink.findUniqueOrThrow({
      where: { applicationId },
      include: { profile: true },
    });
    if (link.profile.paused)
      throw new MarkdownError(
        "Review and activate the format profile before resolving conflicts.",
      );
    const text = await readNote(notesRoot(), link.path);
    if (hash(text) !== expected)
      throw new MarkdownError(
        "The file changed again. Reconcile and review the latest conflict.",
      );
    const profile = profileSchema.parse(link.profile.config);
    const parsed = parseNote(text, profile);
    if (parsed.errors.length || parsed.id !== applicationId)
      throw new MarkdownError(
        parsed.errors.join("\n") || "Restore the stable ID first.",
      );
    const app = await appState(tx, link);
    if (!profile.postingHeading) delete app.postingText;
    const previous = link.conflict as { app?: Values } | null;
    if (
      previous?.app &&
      [...new Set([...Object.keys(previous.app), ...Object.keys(app)])].some(
        (field) => {
          const key = field as keyof Values;
          return (
            previous.app![key] !== app[key] &&
            !(previous.app![key] === undefined && app[key] === "")
          );
        },
      )
    )
      throw new MarkdownError(
        "The app changed again. Reconcile and review the latest conflict before resolving it.",
      );
    const merged = mergeValues(link.snapshot as Values, app, parsed.values);
    for (const conflict of merged.conflicts) {
      const choice = choices[conflict.field];
      if (!choice)
        throw new MarkdownError(
          `Choose which version to keep for ${conflict.field}.`,
        );
      const key = conflict.field as keyof Values;
      merged.values[key] = (choice === "app" ? app : parsed.values)[key];
    }
    const after = writeNote(text, profile, merged.values, applicationId);
    Object.assign(merged.values, parseNote(after, profile).values);
    // Retain the full conflict as a recovery artifact in the database work record
    // until the next successful reconciliation; filesystem recovery copies persist.
    await importValues(tx, applicationId, link.noteId, app, merged.values);
    await writeFileChecked(notesRoot(), link.path, after, expected);
    await tx.markdownLink.update({
      where: { applicationId },
      data: {
        snapshot: json(merged.values),
        contentHash: hash(after),
        conflict: Prisma.DbNull,
        state: "linked",
        error: null,
      },
    });
  });
}
export async function stageProfile(id: string | undefined, input: unknown) {
  const config = profileSchema.parse(input);
  return locked(async (tx) => {
    if (!id)
      return tx.markdownProfile.create({
        data: {
          id: randomUUID(),
          config: json(config),
          draft: json(config),
          paused: true,
        },
      });
    return tx.markdownProfile.update({
      where: { id },
      data: { draft: json(config), paused: true },
    });
  });
}
export async function profileReview(id: string) {
  const row = await prisma.markdownProfile.findUniqueOrThrow({ where: { id } });
  const candidate = profileSchema.parse(row.draft ?? row.config);
  const current = profileSchema.parse(row.config);
  const links = await prisma.markdownLink.findMany({
    where: { profileId: id },
  });
  const files = [];
  for (const link of links) {
    try {
      const before = await readNote(notesRoot(), link.path);
      const app = await prisma.application.findUniqueOrThrow({
        where: { id: link.applicationId },
      });
      const note = await prisma.note.findUnique({ where: { id: link.noteId } });
      const appValues = applicationValues(app, note?.body ?? "");
      if (!candidate.postingHeading) delete appValues.postingText;
      const currentParsed = parseNote(before, current);
      for (const key of FIELDS)
        if (
          currentParsed.values[key] === undefined &&
          (link.snapshot as Values)[key] === undefined &&
          appValues[key] === ""
        )
          delete appValues[key];
      const values = mergeValues(
        link.snapshot as Values,
        appValues,
        currentParsed.values,
      );
      if (values.conflicts.length)
        throw new MarkdownError(
          "Resolve concurrent edits before changing this profile.",
        );
      const parsed = parseNote(before, current);
      if (parsed.errors.length)
        throw new MarkdownError(parsed.errors.join("\n"));
      if (!matchesFile(link.path, candidate))
        throw new MarkdownError(
          "File is excluded by the proposed selection rules.",
        );
      // Existing aliases/properties remain untouched; new mappings are added explicitly.
      const rebound = parseNote(before, candidate);
      if (rebound.errors.length)
        throw new MarkdownError(rebound.errors.join("\n"));
      if (
        candidate.interviewHeading !== current.interviewHeading ||
        candidate.representation !== current.representation
      ) {
        if (appValues.body !== (link.snapshot as Values).body)
          throw new MarkdownError(
            "Synchronize pending app note edits before changing the body section mapping.",
          );
        if (rebound.values.body === undefined)
          throw new MarkdownError(
            "Create the proposed interview/body heading before activating its mapping.",
          );
        // Rebind the associated note to the selected existing section. Never copy
        // the old full body into a narrower heading and duplicate unrelated content.
        values.values.body = rebound.values.body;
      }
      if (
        candidate.postingHeading !== current.postingHeading &&
        candidate.postingHeading
      ) {
        if (rebound.values.postingText === undefined)
          throw new MarkdownError(
            "Create the proposed posting heading before activating its mapping.",
          );
        values.values.postingText = rebound.values.postingText;
      }
      const after = writeNote(
        before,
        candidate,
        values.values,
        link.applicationId,
      );
      Object.assign(values.values, parseNote(after, candidate).values);
      files.push({
        file: link.path,
        before,
        after,
        diff: fileDiff(before, after),
        values: values.values,
        error: null,
      });
    } catch (e) {
      files.push({
        file: link.path,
        before: "",
        after: "",
        diff: "",
        error: (e as Error).message,
      });
    }
  }
  return {
    id,
    config: candidate,
    files,
    token: hash(JSON.stringify({ candidate, files })),
  };
}
export async function activateProfile(id: string, token: string) {
  return locked(async (tx) => {
    // Upstream app edits use row locks, not the integration advisory lock.
    // Hold those rows before regenerating the reviewed proposal.
    const links = await tx.markdownLink.findMany({ where: { profileId: id } });
    for (const link of links) await appState(tx, link);
    const review = await profileReview(id);
    if (review.token !== token)
      throw new MarkdownError("The review is stale. Generate a new dry run.");
    if (review.files.some((f) => f.error))
      throw new MarkdownError("Fix all dry-run errors before activation.");
    // Apply the exact reviewed edits; retries see the same content and are safe.
    for (const file of review.files) {
      await writeFileChecked(
        notesRoot(),
        file.file,
        file.after,
        hash(file.before),
      );
      const link = await tx.markdownLink.findUniqueOrThrow({
        where: { path: file.file },
      });
      const app = await appState(tx, link);
      await importValues(
        tx,
        link.applicationId,
        link.noteId,
        app,
        file.values ?? {},
      );
      await tx.markdownLink.update({
        where: { path: file.file },
        data: {
          snapshot: json(file.values ?? {}),
          contentHash: hash(file.after),
        },
      });
      await tx.markdownWork.upsert({
        where: { applicationId: link.applicationId },
        create: { applicationId: link.applicationId },
        update: { revision: { increment: 1 } },
      });
    }
    await tx.markdownProfile.update({
      where: { id },
      data: {
        config: json(review.config),
        draft: Prisma.DbNull,
        paused: false,
      },
    });
  });
}
export async function integrationView() {
  const profiles = await ensureProfiles();
  const [links, pending] = await Promise.all([
    prisma.markdownLink.findMany({ orderBy: { path: "asc" } }),
    prisma.markdownWork.findMany(),
  ]);
  let files: string[] = [],
    error: string | null = null;
  if (process.env.DOSSIER_NOTES_ROOT) {
    try {
      files = await listNotes(notesRoot());
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return {
    enabled: !!process.env.DOSSIER_NOTES_ROOT,
    vault: process.env.DOSSIER_OBSIDIAN_VAULT ?? "",
    profiles: profiles.map((p) => ({
      id: p.id,
      config: profileSchema.parse(p.config),
      draft: p.draft ? profileSchema.parse(p.draft) : null,
      paused: p.paused,
    })),
    links: links.map((l) => ({
      applicationId: l.applicationId,
      path: l.path,
      state: l.state,
      error: l.error,
      conflict: l.conflict as {
        conflicts: Conflict[];
        fileHash: string;
        app: Values;
        file: Values;
      } | null,
    })),
    pending: pending.map((p) => ({
      applicationId: p.applicationId,
      attempts: p.attempts,
      error: p.error,
    })),
    files,
    error,
  };
}
