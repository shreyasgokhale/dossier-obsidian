import { isMap, isScalar, parseDocument } from "yaml";
import {
  FIELDS,
  STATUSES,
  type Field,
  type FormatProfile,
  type Values,
} from "./profile";

export class MarkdownError extends Error {}
type Span = { start: number; end: number; value: string };
export type ParsedNote = {
  id?: string;
  values: Values;
  missing: Field[];
  empty: Field[];
  errors: string[];
};
const dateFields = new Set(["applicationDate", "deadline", "followUpDate"]);
const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

export function parseDate(
  value: string,
  format: FormatProfile["dateFormat"],
): string {
  const parts =
    format === "YYYY-MM-DD"
      ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
      : format === "DD.MM.YYYY"
        ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value)
        : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!parts)
    throw new MarkdownError(
      `Use the configured date format ${format}; dates are never guessed.`,
    );
  const [y, m, d] =
    format === "YYYY-MM-DD"
      ? parts.slice(1)
      : format === "DD.MM.YYYY"
        ? [parts[3], parts[2], parts[1]]
        : [parts[3], parts[1], parts[2]];
  const iso = `${y}-${m}-${d}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  )
    throw new MarkdownError(`Invalid calendar date: ${value}`);
  return iso;
}
export function displayValue(
  field: Field,
  value: string,
  p: FormatProfile,
): string {
  if (field === "status" && value)
    return (
      Object.entries(p.statusAliases).find(([, v]) => v === value)?.[0] ?? value
    );
  if (dateFields.has(field) && value) {
    const [y, m, d] = value.split("-");
    return p.dateFormat === "DD.MM.YYYY"
      ? `${d}.${m}.${y}`
      : p.dateFormat === "MM/DD/YYYY"
        ? `${m}/${d}/${y}`
        : value;
  }
  return value;
}
function normalized(field: Field, value: string, p: FormatProfile): string {
  if (!value) return "";
  if (field === "status") {
    const status =
      (Object.hasOwn(p.statusAliases, value)
        ? p.statusAliases[value]
        : undefined) ??
      (STATUSES.includes(value as (typeof STATUSES)[number])
        ? value
        : undefined);
    if (!status)
      throw new MarkdownError(
        `Unsupported status “${value}”. Add a status alias to the profile.`,
      );
    return status;
  }
  if (dateFields.has(field)) return parseDate(value, p.dateFormat);
  if (field === "nextInterviewAt") {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new MarkdownError(
        "Interview datetime needs ISO 8601 with a timezone, e.g. 2026-10-25T14:00:00+01:00.",
      );
    parseDate(value.slice(0, 10), "YYYY-MM-DD");
    return new Date(value).toISOString();
  }
  if (field === "postingUrl" && !/^https?:\/\/\S+$/.test(value))
    throw new MarkdownError("Posting URL must start with http:// or https://.");
  return value;
}
function frontmatter(text: string) {
  if (!/^---\r?\n/.test(text)) return null;
  const closing = /^---[ \t]*\r?$/gm;
  closing.lastIndex = text.indexOf("\n") + 1;
  const match = closing.exec(text);
  if (!match)
    throw new MarkdownError(
      "Unclosed YAML frontmatter. Add a closing --- line.",
    );
  const start = text.indexOf("\n") + 1;
  const end = match.index;
  const doc = parseDocument(text.slice(start, end), {
    keepSourceTokens: true,
    uniqueKeys: true,
  });
  if (doc.errors.length)
    throw new MarkdownError(
      `Invalid YAML: ${doc.errors.map((e) => e.message).join("; ")}`,
    );
  if (doc.contents && !isMap(doc.contents))
    throw new MarkdownError("Frontmatter must be a YAML mapping.");
  return {
    start,
    end,
    bodyStart:
      match.index +
      match[0].length +
      (text[match.index + match[0].length] === "\n" ? 1 : 0),
    doc,
  };
}
export function section(
  text: string,
  title: string,
): { start: number; end: number } | null {
  const headings = [...text.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*\r?$/gm)];
  const matches = headings.filter((m) => m[2] === title);
  if (matches.length > 1)
    throw new MarkdownError(
      `Duplicate heading “${title}”. Make the section mapping unambiguous.`,
    );
  const found = matches[0];
  if (!found) return null;
  const next = headings.find(
    (m) => m.index! > found.index! && m[1].length <= found[1].length,
  );
  return {
    start:
      found.index! +
      found[0].length +
      (text[found.index! + found[0].length] === "\n" ? 1 : 0),
    end: next?.index ?? text.length,
  };
}
function inspect(text: string, p: FormatProfile) {
  const fm = frontmatter(text);
  const spans = new Map<string, Span>();
  const area =
    p.representation === "labels" ? section(text, p.metadataHeading) : null;
  if (p.representation === "frontmatter" && fm && isMap(fm.doc.contents)) {
    for (const key of [...Object.values(p.fields), p.idProperty]) {
      const node = fm.doc.get(key, true);
      if (node === undefined) continue;
      if (
        !isScalar(node) ||
        (node.value !== null &&
          !["string", "number", "boolean"].includes(typeof node.value))
      )
        throw new MarkdownError(
          `Property “${key}” must be a single scalar value.`,
        );
      const range = node.range;
      if (!range)
        throw new MarkdownError(`Cannot safely edit property “${key}”.`);
      if (text.slice(fm.start + range[0], fm.start + range[1]).includes("\n"))
        throw new MarkdownError(`Property “${key}” must be on one line.`);
      spans.set(key, {
        start: fm.start + range[0],
        end: fm.start + range[1],
        value: node.value === null ? "" : String(node.value),
      });
    }
  }
  if (p.representation === "labels" && area) {
    for (const label of Object.values(p.fields)) {
      const lines = [
        ...text.slice(area.start, area.end).matchAll(/^.*$/gm),
      ].filter((m) => m[0].startsWith(label));
      if (lines.length > 1)
        throw new MarkdownError(
          `Duplicate label “${label}” in “${p.metadataHeading}”. Keep one occurrence.`,
        );
      if (lines[0]) {
        const line = lines[0];
        const raw = line[0].slice(label.length).replace(/\r$/, "");
        const spaces = raw.length - raw.trimStart().length;
        const start = area.start + line.index! + label.length + spaces;
        spans.set(label, {
          start,
          end: start + raw.trimStart().length,
          value: raw.trim(),
        });
      }
    }
  }
  const ids = [...text.matchAll(/<!-- dossier:id=([A-Za-z0-9_-]+) -->/g)];
  if (ids.length > 1)
    throw new MarkdownError("Duplicate stable ID comments. Keep one.");
  const id =
    p.representation === "frontmatter"
      ? spans.get(p.idProperty)?.value
      : ids[0]?.[1];
  if (id && !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new MarkdownError("Invalid stable application identifier.");
  // Hide only the integration ID, preserving all other body bytes.
  const bodyStart = fm?.bodyStart ?? 0;
  const body = p.interviewHeading
    ? section(text, p.interviewHeading)
    : p.representation === "labels" && area
      ? { start: area.end, end: text.length }
      : { start: bodyStart, end: text.length };
  const posting = p.postingHeading ? section(text, p.postingHeading) : null;
  if (
    p.interviewHeading &&
    body &&
    posting &&
    body.start < posting.end &&
    posting.start < body.end
  )
    throw new MarkdownError(
      "Posting and interview sections overlap. Map separate sections.",
    );
  return { fm, spans, area, id, ids, body, posting };
}
export function parseNote(text: string, p: FormatProfile): ParsedNote {
  const result: ParsedNote = { values: {}, missing: [], empty: [], errors: [] };
  try {
    const info = inspect(text, p);
    result.id = info.id;
    for (const field of FIELDS) {
      const key = p.fields[field];
      const span = key && info.spans.get(key);
      if (!span) {
        result.missing.push(field);
        continue;
      }
      if (span.value === "") result.empty.push(field);
      try {
        result.values[field] = normalized(field, span.value, p);
      } catch (e) {
        result.errors.push(`${key}: ${(e as Error).message}`);
      }
    }
    if (info.body)
      result.values.body = text
        .slice(info.body.start, info.body.end)
        .replace(/<!-- dossier:id=[A-Za-z0-9_-]+ -->\r?\n?/g, "");
    if (info.posting)
      result.values.postingText = text.slice(
        info.posting.start,
        info.posting.end,
      );
  } catch (e) {
    result.errors.push((e as Error).message);
  }
  return result;
}
/** Edits value spans only. All unrelated bytes, including YAML comments, survive. */
export function writeNote(
  text: string,
  p: FormatProfile,
  changes: Values,
  id?: string,
): string {
  if (id && !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new MarkdownError("Invalid stable application identifier.");
  const parsed = parseNote(text, p);
  if (parsed.errors.length) throw new MarkdownError(parsed.errors.join("\n"));
  const info = inspect(text, p);
  if (
    !p.interviewHeading &&
    changes.body !== undefined &&
    changes.body !== parsed.values.body &&
    changes.postingText !== undefined &&
    changes.postingText !== parsed.values.postingText &&
    info.posting
  ) {
    const bodyPosting =
      p.postingHeading && section(changes.body, p.postingHeading);
    if (!bodyPosting)
      throw new MarkdownError(
        "The edited full body removed its mapped posting heading. Restore it before synchronizing.",
      );
    const selected = changes.body.slice(bodyPosting.start, bodyPosting.end);
    if (
      selected !== parsed.values.postingText &&
      selected !== changes.postingText
    )
      throw new MarkdownError(
        "The full note body and posting text contain different edits to the posting. Review both before synchronizing.",
      );
    const first = writeNote(text, p, { body: changes.body }, id);
    return writeNote(first, p, { ...changes, body: undefined }, id);
  }
  const eol = eolOf(text);
  const edits: { start: number; end: number; text: string }[] = [];
  const additions: string[] = [];
  for (const field of FIELDS) {
    const value = changes[field];
    const key = p.fields[field];
    if (value === undefined || !key || parsed.values[field] === value) continue;
    normalized(field, displayValue(field, value, p), p);
    const display = displayValue(field, value, p);
    const span = info.spans.get(key);
    const encoded =
      p.representation === "frontmatter" ? JSON.stringify(display) : display;
    if (/[\r\n]/.test(display))
      throw new MarkdownError(`${field} must fit on one line.`);
    if (span)
      edits.push({
        ...span,
        text: `${span.start === span.end && text[span.start - 1] === ":" ? " " : ""}${encoded}${p.representation === "frontmatter" && text[span.end] === "#" ? " " : ""}`,
      });
    else
      additions.push(
        p.representation === "frontmatter"
          ? `${key}: ${encoded}`
          : `${key} ${display}`,
      );
  }
  if (id && id !== info.id) {
    if (info.id)
      throw new MarkdownError(
        "This note already belongs to another application.",
      );
    if (p.representation === "frontmatter")
      additions.push(`${p.idProperty}: ${JSON.stringify(id)}`);
    else
      edits.push({ start: 0, end: 0, text: `<!-- dossier:id=${id} -->${eol}` });
  }
  for (const [key, range] of [
    ["body", info.body],
    ["postingText", info.posting],
  ] as const) {
    if (changes[key] === undefined || changes[key] === parsed.values[key])
      continue;
    if (!range)
      throw new MarkdownError(
        `The mapped ${key} section is missing. Create its heading first.`,
      );
    const content = changes[key]!;
    const boundary =
      range.end < text.length && !content.endsWith("\n") ? eol : "";
    edits.push({ ...range, text: content + boundary });
  }
  if (additions.length) {
    const block = additions.join(eol) + eol;
    if (p.representation === "frontmatter") {
      if (info.fm)
        edits.push({ start: info.fm.end, end: info.fm.end, text: block });
      else edits.push({ start: 0, end: 0, text: `---${eol}${block}---${eol}` });
    } else if (info.area)
      edits.push({ start: info.area.start, end: info.area.start, text: block });
    else
      edits.push({
        start: 0,
        end: 0,
        text: `# ${p.metadataHeading}${eol}${block}${eol}`,
      });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
export function renderTemplate(
  p: FormatProfile,
  values: Values,
  id: string,
): string {
  const raw = p.template.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => {
    if (key.trim() === "id") return id;
    const field = key.trim() as Field;
    const value = displayValue(field, values[field] ?? "", p);
    return p.representation === "frontmatter"
      ? JSON.stringify(value)
      : value.replace(/[\r\n]/g, " ");
  });
  const rendered = writeNote(raw, p, values, id);
  const parsed = parseNote(rendered, p);
  if (parsed.errors.length) throw new MarkdownError(parsed.errors.join("\n"));
  return rendered;
}
/** Exact before/after are included; the line diff is deliberately lossless and simple. */
export function fileDiff(before: string, after: string) {
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  return before === after
    ? "No changes"
    : `@@ line ${start + 1} @@\n${a
        .slice(start, a.length - end)
        .map((s) => `-${s}`)
        .join("\n")}\n${b
        .slice(start, b.length - end)
        .map((s) => `+${s}`)
        .join("\n")}`;
}
