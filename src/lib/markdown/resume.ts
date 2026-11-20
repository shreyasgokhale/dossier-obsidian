import "server-only";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sameName } from "@/lib/profile";
import { hash, listNotes, readNote } from "./files";
import { MarkdownError } from "./format";
import { locked } from "./service";
import { parseResumeSource, type Entry } from "./resume-source";

export { parseResumeSource } from "./resume-source";

function span(entry: Entry) {
  const parts = (date?: string) => (date ? date.split("-").map(Number) : []);
  const [startYear, startMonth] = parts(entry.start),
    [endYear, endMonth] = parts(entry.end);
  return {
    startYear: startYear ?? null,
    startMonth: startMonth ?? null,
    endYear: endYear ?? null,
    endMonth: endMonth ?? null,
    current: entry.current,
  };
}
function targetId(entry: Entry) {
  return `resume_${hash(`${entry.collection}:${entry.source_id}`).slice(0, 24)}`;
}
function target(entry: Entry) {
  switch (entry.collection) {
    case "about":
      return {
        name: entry.name,
        headline: entry.headline,
        summary: entry.body,
      };
    case "experience":
      return {
        role: entry.role,
        company: entry.company,
        location: entry.location,
        bullets: entry.body,
        ...span(entry),
      };
    case "education":
      return {
        degree: entry.degree,
        school: entry.school,
        notes: entry.body,
        ...span(entry),
      };
    case "projects":
      return {
        name: entry.name,
        link: entry.link,
        bullets: entry.body,
        ...span(entry),
      };
    case "skills":
      return { name: entry.name, ...(entry.group && { group: entry.group }) };
    case "languages":
      return { name: entry.name, level: entry.level! };
  }
}
async function currentProfile() {
  const [basics, experience, education, projects, skills, languages] =
    await Promise.all([
      prisma.profileField.findMany({ orderBy: { key: "asc" } }),
      prisma.experience.findMany({ orderBy: { id: "asc" } }),
      prisma.education.findMany({ orderBy: { id: "asc" } }),
      prisma.project.findMany({ orderBy: { id: "asc" } }),
      prisma.skill.findMany({ orderBy: { id: "asc" } }),
      prisma.language.findMany({ orderBy: { id: "asc" } }),
    ]);
  return { basics, experience, education, projects, skills, languages };
}
export async function resumePreview(language: "en" | "de") {
  const root = process.env.DOSSIER_RESUME_ROOT;
  if (!root || !path.isAbsolute(root))
    throw new MarkdownError(
      "Set DOSSIER_RESUME_ROOT to an absolute, read-only career collection directory.",
    );
  const files = await listNotes(root);
  const sources: {
    id: string;
    path: string;
    contentHash: string;
    entry: Entry;
  }[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (file === "README.md") continue;
    try {
      const text = await readNote(root, file),
        entry = parseResumeSource(text);
      const id = `${entry.collection}:${entry.source_id}:${entry.language}`;
      if (sources.some((s) => s.id === id))
        throw new MarkdownError(`Duplicate source identity: ${id}`);
      sources.push({ id, path: file, contentHash: hash(text), entry });
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
    }
  }
  const about = sources.filter(
    (s) => s.entry.collection === "about" && s.entry.language === language,
  );
  if (about.length > 1)
    errors.push("Choose one about/summary source per language.");
  const previous = await prisma.resumeSource.findMany({
    orderBy: { id: "asc" },
  });
  const current = await currentProfile();
  const removals = previous
    .filter((p) => !sources.some((s) => s.id === p.id))
    .map((p) => ({
      id: p.id,
      path: p.path,
      action: "Report only; Dossier content is preserved.",
    }));
  const renames = sources.flatMap((s) => {
    const p = previous.find((p) => p.id === s.id);
    return p && p.path !== s.path
      ? [{ id: s.id, from: p.path, to: s.path }]
      : [];
  });
  const changes = sources
    .filter((s) => s.entry.language === language)
    .map((s) => {
      const collection = s.entry.collection;
      const prev = previous.find((p) => p.id === s.id);
      const id = prev?.targetId ?? targetId(s.entry);
      const namedSkill = collection === "skills"
        ? current.skills.find((skill) => sameName(skill.name, s.entry.name))
        : undefined;
      const before =
        collection === "about"
          ? Object.fromEntries(
              current.basics
                .filter((b) => ["name", "headline", "summary"].includes(b.key))
                .map((b) => [b.key, b.value]),
            )
          : (namedSkill ?? current[collection].find((row) => row.id === id) ?? null);
      const after = namedSkill ? { ...target(s.entry), name: namedSkill.name } : target(s.entry);
      const changed =
        before === null ||
        Object.entries(after).some(
          ([k, v]) => (before as Record<string, unknown>)[k] !== v,
        );
      return {
        id: s.id,
        targetId: namedSkill?.id ?? id,
        collection,
        path: s.path,
        before,
        after,
        changed,
      };
    });
  const token = hash(JSON.stringify({ language, sources, previous, current }));
  return { language, sources, changes, removals, renames, errors, token };
}
export async function importResume(language: "en" | "de", token: string) {
  return locked(async (tx) => {
    const preview = await resumePreview(language);
    if (preview.token !== token)
      throw new MarkdownError(
        "Source files or Dossier profile changed. Review a new import preview.",
      );
    if (preview.errors.length)
      throw new MarkdownError(preview.errors.join("\n"));
    const ids = new Map<string, string>();
    for (const change of preview.changes) {
      const source = preview.sources.find((s) => s.id === change.id)!;
      const entry = source.entry;
      let id = change.targetId;
      if (change.changed) {
        switch (entry.collection) {
          case "about":
            for (const [key, value] of Object.entries(target(entry)))
              await tx.profileField.upsert({
                where: { key },
                create: { key, value: String(value) },
                update: { value: String(value) },
              });
            break;
          case "experience": {
            const data = {
              role: entry.role,
              company: entry.company,
              location: entry.location,
              bullets: entry.body,
              ...span(entry),
            };
            await tx.experience.upsert({
              where: { id },
              create: { id, ...data },
              update: data,
            });
            break;
          }
          case "education": {
            const data = {
              degree: entry.degree,
              school: entry.school,
              notes: entry.body,
              ...span(entry),
            };
            await tx.education.upsert({
              where: { id },
              create: { id, ...data },
              update: data,
            });
            break;
          }
          case "projects": {
            const data = {
              name: entry.name,
              link: entry.link,
              bullets: entry.body,
              ...span(entry),
            };
            await tx.project.upsert({
              where: { id },
              create: { id, ...data },
              update: data,
            });
            break;
          }
          case "skills": {
            const existing = await tx.skill.findUnique({
              where: { name: entry.name },
            });
            const group = entry.group ? { group: entry.group } : {};
            if (existing) {
              id = existing.id;
              if (entry.group)
                await tx.skill.update({ where: { id }, data: group });
            } else {
              await tx.skill.upsert({
                where: { id },
                create: { id, name: entry.name, ...group },
                update: { name: entry.name, ...group },
              });
            }
            break;
          }
          case "languages": {
            const existing = await tx.language.findUnique({
              where: { name: entry.name },
            });
            if (existing) id = existing.id;
            await tx.language.upsert({
              where: { id },
              create: { id, name: entry.name, level: entry.level! },
              update: { name: entry.name, level: entry.level! },
            });
            break;
          }
        }
      }
      ids.set(`${entry.collection}:${entry.source_id}`, id);
    }
    // Keep both languages without changing the read-only collection.
    for (const source of preview.sources) {
      const existing = await tx.resumeSource.findUnique({
        where: { id: source.id },
      });
      const id =
        ids.get(`${source.entry.collection}:${source.entry.source_id}`) ??
        existing?.targetId ??
        targetId(source.entry);
      const data = {
        path: source.path,
        language: source.entry.language,
        collection: source.entry.collection,
        contentHash: source.contentHash,
        content: source.entry as Prisma.InputJsonValue,
        targetId: id,
      };
      if (
        existing &&
        existing.path === data.path &&
        existing.contentHash === data.contentHash &&
        existing.targetId === id
      )
        continue;
      await tx.resumeSource.upsert({
        where: { id: source.id },
        create: { id: source.id, ...data },
        update: data,
      });
    }
  });
}
