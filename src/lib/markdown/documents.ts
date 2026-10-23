import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { unitsSchema, matchSchema, type Unit } from "@/lib/application-data";
import { updateDocumentsTx } from "@/lib/document-units";
import { prisma } from "@/lib/prisma";
import { MarkdownError } from "./format";
import { hash, notesRoot, readNote, writeFileChecked } from "./files";
import { locked } from "./service";
import { mergeValues } from "./merge";
import type { Values } from "./profile";

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const marker = (id: string) => Buffer.from(id).toString("base64url");
export function renderDocument(
  units: Unit[],
  applicationId: string,
  kind: string,
  applicationPath = `Applications/${applicationId}.md`,
): string {
  return (
    `# ${kind.replaceAll("_", " ")}\n\n[[${applicationPath.replace(/\.md$/, "")}|Application]]\n\nEdit text inside the unit markers. Keep every marker intact.\n\n` +
    units
      .map(
        (u) =>
          `## ${u.label.replace(/[\r\n]/g, " ")}\n\n<!-- dossier:unit ${marker(u.id)} -->\n${u.text}\n<!-- /dossier:unit -->\n`,
      )
      .join("\n")
  );
}
export function parseDocumentUnits(text: string, expected: Unit[]): Unit[] {
  const matches = [
    ...text.matchAll(
      /<!-- dossier:unit ([A-Za-z0-9_-]+) -->\r?\n([\s\S]*?)\r?\n<!-- \/dossier:unit -->/g,
    ),
  ];
  const allMarkers = text.match(/<!--\s*\/?dossier:unit\b/g) ?? [];
  if (
    matches.length !== expected.length ||
    allMarkers.length !== expected.length * 2
  )
    throw new MarkdownError(
      "Document markers are damaged or missing. No text was imported. Preserve your edits, then repair the export from the app.",
    );
  const byId = new Map<string, string>();
  for (const m of matches) {
    const id = Buffer.from(m[1], "base64url").toString();
    if (
      byId.has(id) ||
      marker(id) !== m[1] ||
      !expected.some((u) => u.id === id) ||
      m[2].includes("dossier:unit")
    )
      throw new MarkdownError(
        "Duplicate or unknown document unit markers. Repair the export before importing.",
      );
    byId.set(id, m[2]);
  }
  return expected.map((u) => ({ ...u, text: byId.get(u.id)! }));
}
function changedText(units: Unit[], previous: Unit[]) {
  return units.map((u) => {
    const old = previous.find((p) => p.id === u.id);
    if (old && old.text !== u.text) {
      const clean = { ...u };
      delete clean.unverified;
      return clean;
    }
    return u;
  });
}
const unitValues = (units: Unit[]) =>
  Object.fromEntries(units.map((u) => [u.id, u.text])) as Values;
export async function syncDocuments() {
  if (!process.env.DOSSIER_NOTES_ROOT) return;
  await locked(async (tx) => {
    const docs = await tx.document.findMany({
      where: { application: { markdown: { isNot: null } } },
      include: {
        markdown: true,
        application: { include: { markdown: { include: { profile: true } } } },
      },
    });
    for (const doc of docs) {
      if (doc.application.markdown?.profile.paused) continue;
      const units = unitsSchema.parse(doc.units);
      const file = doc.markdown?.path ?? `Dossier/Documents/${doc.id}.md`;
      let before: string | null = null;
      try {
        try {
          before = await readNote(notesRoot(), file);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (!doc.markdown) {
          if (before !== null)
            throw new MarkdownError(
              "An unlinked document already exists at the export path. Move it aside before retrying.",
            );
          const after = renderDocument(
            units,
            doc.applicationId,
            doc.kind,
            doc.application.markdown?.path,
          );
          await writeFileChecked(notesRoot(), file, after, null);
          await tx.markdownDocument.create({
            data: {
              documentId: doc.id,
              path: file,
              snapshot: json(units),
              contentHash: hash(after),
            },
          });
          continue;
        }
        if (before === null)
          throw new MarkdownError(
            "Document export is missing. Restore it or repair the export; the app document is preserved.",
          );
        const base = unitsSchema.parse(doc.markdown.snapshot);
        // Parse against the last exported unit structure: newly added app units are safe to append.
        const fromFile = parseDocumentUnits(before, base);
        const merged = mergeValues(
          unitValues(base),
          unitValues(units),
          unitValues(fromFile),
        );
        const structureChanged = base.some(
          (u) => !units.some((v) => v.id === u.id),
        );
        if (
          structureChanged ||
          merged.conflicts.length ||
          doc.markdown.conflict
        ) {
          await tx.markdownDocument.update({
            where: { documentId: doc.id },
            data: {
              conflict: json({
                base,
                app: units,
                file: fromFile,
                conflicts: merged.conflicts,
              }),
              contentHash: hash(before),
              error:
                "Concurrent document changes require review. Both versions are preserved.",
            },
          });
          continue;
        }
        const next = changedText(
          units.map((u) => ({
            ...u,
            text: merged.values[u.id as keyof Values] ?? u.text,
          })),
          units,
        );
        const appLink = `[[${doc.application.markdown!.path.replace(/\.md$/, "")}|Application]]`;
        let after = before.replace(
          /^\[\[[^\n]*?\|Application\]\]$/m,
          () => appLink,
        );
        if (units.length !== base.length)
          after = renderDocument(
            next,
            doc.applicationId,
            doc.kind,
            doc.application.markdown?.path,
          );
        else
          for (const u of next) {
            const old = fromFile.find((f) => f.id === u.id)!;
            if (old.text === u.text) continue;
            const pattern = new RegExp(
              `(<!-- dossier:unit ${marker(u.id)} -->\\r?\\n)([\\s\\S]*?)(\\r?\\n<!-- /dossier:unit -->)`,
            );
            after = after.replace(
              pattern,
              (_whole, start: string, _old: string, end: string) =>
                start +
                u.text.replace(
                  /\r?\n/g,
                  after.includes("\r\n") ? "\r\n" : "\n",
                ) +
                end,
            );
          }
        if (JSON.stringify(next) !== JSON.stringify(units)) {
          await updateDocumentsTx(
            tx,
            doc.applicationId,
            async (documents) => {
              documents[doc.kind] = next;
            },
            { version: { cause: "RESTORED", detail: "Edited in Markdown" } },
          );
        }
        await writeFileChecked(notesRoot(), file, after, hash(before));
        await tx.markdownDocument.update({
          where: { documentId: doc.id },
          data: { snapshot: json(next), contentHash: hash(after), error: null },
        });
      } catch (e) {
        if (doc.markdown)
          await tx.markdownDocument.update({
            where: { documentId: doc.id },
            data: {
              error: (e as Error).message,
              ...(before !== null ? { contentHash: hash(before) } : {}),
            },
          });
        // Unlinked export errors stay in the application's durable work row.
        else
          await tx.markdownWork.upsert({
            where: { applicationId: doc.applicationId },
            create: {
              applicationId: doc.applicationId,
              attempts: 1,
              error: (e as Error).message,
            },
            update: { attempts: { increment: 1 }, error: (e as Error).message },
          });
      }
    }
  });
}
export async function repairDocument(documentId: string, expected: string) {
  await locked(async (tx) => {
    const doc = await tx.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { markdown: true, application: { include: { markdown: true } } },
    });
    if (!doc.markdown)
      throw new MarkdownError("Document has no export mapping.");
    let before: string | null = null;
    try {
      before = await readNote(notesRoot(), doc.markdown.path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (before !== null && hash(before) !== expected)
      throw new MarkdownError(
        "The export changed again. Refresh status before repairing.",
      );
    const units = unitsSchema.parse(doc.units);
    await writeFileChecked(
      notesRoot(),
      doc.markdown.path,
      renderDocument(
        units,
        doc.applicationId,
        doc.kind,
        doc.application.markdown?.path,
      ),
      before === null ? null : expected,
    );
    await tx.markdownDocument.update({
      where: { documentId },
      data: {
        snapshot: json(units),
        contentHash: hash(
          renderDocument(
            units,
            doc.applicationId,
            doc.kind,
            doc.application.markdown?.path,
          ),
        ),
        conflict: Prisma.DbNull,
        error: null,
      },
    });
  });
}
export async function resolveDocument(
  documentId: string,
  choice: "app" | "file",
  expected: string,
) {
  await locked(async (tx) => {
    const doc = await tx.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { markdown: true, application: { include: { markdown: true } } },
    });
    if (!doc.markdown?.conflict)
      throw new MarkdownError("No document conflict to resolve.");
    const before = await readNote(notesRoot(), doc.markdown.path);
    if (hash(before) !== expected)
      throw new MarkdownError(
        "File changed again. Reconcile before resolving.",
      );
    const app = unitsSchema.parse(doc.units);
    const conflict = doc.markdown.conflict as { app: unknown; file: unknown };
    if (JSON.stringify(app) !== JSON.stringify(unitsSchema.parse(conflict.app)))
      throw new MarkdownError(
        "App document changed again. Reconcile before resolving.",
      );
    const units =
      choice === "app"
        ? app
        : changedText(unitsSchema.parse(conflict.file), app);
    await updateDocumentsTx(
      tx,
      doc.applicationId,
      async (documents) => {
        documents[doc.kind] = units;
      },
      { version: { cause: "RESTORED", detail: "Resolved Markdown conflict" } },
    );
    const after = renderDocument(
      units,
      doc.applicationId,
      doc.kind,
      doc.application.markdown?.path,
    );
    await writeFileChecked(notesRoot(), doc.markdown.path, after, expected);
    await tx.markdownDocument.update({
      where: { documentId },
      data: {
        snapshot: json(units),
        contentHash: hash(after),
        conflict: Prisma.DbNull,
        error: null,
      },
    });
  });
}
const owned =
  "<!-- Generated by Dossier; edits to this view are replaced. -->\n";
/** Readable companion exports, isolated under Dossier/. Application source notes stay in place. */
export async function exportObsidian() {
  if (!process.env.DOSSIER_NOTES_ROOT) return;
  const apps = await prisma.application.findMany({
    where: { markdown: { isNot: null } },
    include: {
      markdown: true,
      documents: true,
      messages: { orderBy: { createdAt: "asc" } },
      notes: true,
    },
  });
  async function generated(file: string, text: string) {
    let before: string | null = null;
    try {
      before = await readNote(notesRoot(), file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (before !== null && !before.includes(owned.trim()))
      throw new MarkdownError(
        `Refusing to overwrite unowned generated view: ${file}`,
      );
    await writeFileChecked(
      notesRoot(),
      file,
      text,
      before === null ? null : hash(before),
    );
  }
  const publicUrl = process.env.DOSSIER_PUBLIC_URL ?? "http://localhost:3000";
  const vault = process.env.DOSSIER_OBSIDIAN_VAULT;
  const lines = [];
  for (const app of apps) {
    const file = app.markdown!.path;
    const title = `${app.role} · ${app.company}`.replace(/[\[\]\r\n|]/g, " ");
    lines.push(
      `- [[${file.replace(/\.md$/, "")}|${title}]] — ${app.status}${app.followUpDate ? ` · follow-up ${app.followUpDate.toISOString().slice(0, 10)}` : ""}`,
    );
    const docs = app.documents.map(
      (d) =>
        `- [[Dossier/Documents/${d.id}|${d.kind}]] · [PDF](${publicUrl}/api/pdf?doc=${d.kind === "RESUME" ? "resume" : "letter"}&application=${app.id})`,
    );
    const chat = app.messages
      .map((m) => `## ${m.role} · ${m.createdAt.toISOString()}\n\n${m.text}`)
      .join("\n\n");
    const extraNotes = app.notes
      .filter((n) => n.id !== app.markdown!.noteId)
      .map((n) => `## Note · ${n.createdAt.toISOString()}\n\n${n.body}`)
      .join("\n\n");
    const match = matchSchema.safeParse(app.match);
    const assessment = match.success
      ? match.data.items
          .map(
            (item) =>
              `- **${item.requirement}** — ${item.result}${item.note ? `. ${item.note}` : ""}`,
          )
          .join("\n")
      : "No fit assessment yet.";
    await generated(
      `Dossier/Views/${app.id}.md`,
      `---\ndossier_view: true\narchived: ${app.archivedAt !== null}\nstatus: ${app.status}\nfollow_up_date: ${app.followUpDate?.toISOString().slice(0, 10) ?? ""}\nnext_interview_at: ${app.nextInterviewAt?.toISOString() ?? ""}\napplication: ${JSON.stringify(`[[${file.replace(/\.md$/, "")}]]`)}\n---\n${owned}\n# ${title}\n\n[[${file.replace(/\.md$/, "")}|Application note]] · [Open Dossier](${publicUrl}/applications/${app.id})${vault ? ` · [Open in Obsidian](obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)})` : ""}\n\n## Documents and attachments\n\n${docs.join("\n")}\n\n## Fit assessment\n\n${assessment}\n\n## Conversation\n\n${chat}\n\n${extraNotes}\n`,
    );
  }
  await generated(
    "Dossier/Dashboard.md",
    `${owned}\n# Applications\n\n${lines.join("\n")}\n\n![[Dossier/Active.base]]\n![[Dossier/Interviews.base]]\n![[Dossier/Follow-ups.base]]\n`,
  );
  for (const [name, filter, order] of [
    [
      "Active",
      '!archived && !list("ACCEPTED", "REJECTED", "DECLINED").contains(status)',
      "status",
    ],
    [
      "Interviews",
      '!archived && status == "INTERVIEW" && next_interview_at != null && date(next_interview_at) >= now()',
      "next_interview_at",
    ],
    [
      "Follow-ups",
      '!archived && follow_up_date != null && !list("ACCEPTED", "REJECTED", "DECLINED").contains(status)',
      "follow_up_date",
    ],
  ]) {
    await generated(
      `Dossier/${name}.base`,
      `# ${owned.trim()}\nfilters:\n  and:\n    - file.inFolder("Dossier/Views")\n    - ${JSON.stringify(filter)}\nviews:\n  - type: table\n    name: ${name}\n    order:\n      - application\n      - status\n      - ${order}\n    sort:\n      - property: ${order}\n        direction: ASC\n`,
    );
  }
}
