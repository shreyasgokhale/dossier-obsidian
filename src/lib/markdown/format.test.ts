import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultProfile as fm, labeledProfile as labels, matchesFile, profileSchema } from "./profile";
import { fileDiff, parseDate, parseNote, renderTemplate, section, writeNote } from "./format";
import { mergeValues } from "./merge";
const fixture = readFileSync("fixtures/notes/frontmatter/empty-energy.md", "utf8");
const labeled = readFileSync("fixtures/notes/labeled/application.md", "utf8");
describe("deterministic Markdown formats", () => {
  it("distinguishes empty, missing and invalid without changing unknown content", () => {
    const parsed = parseNote(fixture, fm);
    expect(parsed.errors).toEqual([]);
    expect(parsed.empty).toContain("applicationDate");
    expect(parsed.missing).toContain("postingUrl");
    expect(parsed.values.status).toBe("INTERVIEW");
    const after = writeNote(fixture, fm, { followUpDate: "2026-10-25", location: "Hamburg" }, "stable_1");
    expect(after).toContain('location: "Hamburg" # preserve this comment');
    expect(after).toContain("custom_property: [private, keep]");
    expect(after.slice(after.indexOf("# Posting"))).toBe(fixture.slice(fixture.indexOf("# Posting")));
    expect(parseNote(after, fm).values.followUpDate).toBe("2026-10-25");
    expect(writeNote(after, fm, { followUpDate: "2026-10-25" }, "stable_1")).toBe(after);
  });
  it("edits literal labels only inside the metadata section", () => {
    const text = labeled + "\nCompany: Outside metadata\n";
    const after = writeNote(text, labels, { company: "Example New", followUpDate: "2026-11-01" }, "id_2");
    expect(after).toContain("Company: Outside metadata");
    expect(after).toContain("Company: Example New");
    expect(parseNote(after, labels).id).toBe("id_2");
    expect(after).toContain("[[Control architecture]]");
    expect(writeNote(after, labels, { status: "SENT" }, "id_2")).toContain("Status: sent");
  });
  it("supports configured names, labels, aliases and date formats", () => {
    const p = { ...labels, fields: { company: "Employer =", status: "Phase =", applicationDate: "Date =" }, statusAliases: { Gespräch: "INTERVIEW" as const }, dateFormat: "DD.MM.YYYY" as const };
    const text = "# Application\nEmployer = ACME\nPhase = Gespräch\nDate = 01.10.2026\n# Body\n";
    expect(parseNote(text, p).values).toMatchObject({ company: "ACME", status: "INTERVIEW", applicationDate: "2026-10-01" });
    expect(writeNote(text, p, { applicationDate: "2026-11-02" })).toContain("Date = 02.11.2026");
    expect(parseDate("10/25/2026", "MM/DD/YYYY")).toBe("2026-10-25");
  });
  it.each(["2026-02-30", "01/02/2026", "2026-13-01"])("rejects invalid or ambiguous ISO dates: %s", (day) => { expect(() => parseDate(day, "YYYY-MM-DD")).toThrow(); });
  it.each([
    ["---\nstatus: [bad\n---\n", fm, "Invalid YAML"],
    ["---\nstatus: sent\nstatus: interview\n---\n", fm, "Invalid YAML"],
    ["---\nstatus: unknown\n---\n", fm, "Unsupported status"],
    ["---\ncompany_name: [one, two]\n---\n", fm, "scalar"],
    ["---\napplication_date: 01/02/2026\n---\n", fm, "never guessed"],
    ["---\nnext_interview_at: 2026-10-25T14:00:00\n---\n", fm, "timezone"],
    ["# Application\nCompany: a\nCompany: b\n", labels, "Duplicate label"],
    ["---\nstatus: sent\n", fm, "Unclosed"],
    ["---\n- item\n---\n", fm, "mapping"],
    ["---\njob_url: javascript:alert\n---\n", fm, "http"],
  ] as const)("reports actionable parse errors", (text, p, error) => { expect(parseNote(text, p).errors.join(" ")).toContain(error); expect(() => writeNote(text, p, { company: "x" })).toThrow(); });
  it("preserves CRLF and inline YAML comments", () => {
    const text = '---\r\ncompany_name: Old # hi\r\nstatus: sent\r\n---\r\n\r\n# Notes\r\n- [ ] task\r\n';
    const after = writeNote(text, fm, { company: "New" });
    expect(after).toBe(text.replace("Old", '"New"'));
  });
  it("uses explicitly mapped sections and preserves other sections", () => {
    const p = { ...fm, postingHeading: "Posting", interviewHeading: "Interview" };
    const parsed = parseNote(fixture, p);
    expect(parsed.values.postingText).toContain("PLC");
    expect(parsed.values.body).toContain("## Intro call");
    const after = writeNote(fixture, p, { body: "\nNew interview notes\n" });
    expect(after.slice(0, after.indexOf("# Interview"))).toBe(fixture.slice(0, fixture.indexOf("# Interview")));
    expect(() => section("# Notes\na\n# Notes\nb", "Notes")).toThrow("Duplicate heading");
  });
  it("validates profile templates and duplicate mappings", () => {
    expect(profileSchema.safeParse({ ...fm, template: "{{not_a_field}}" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...fm, fields: { company: "same", role: "same" } }).success).toBe(false);
    expect(profileSchema.safeParse({ ...fm, selection: { include: ["../secret.md"], exclude: [] } }).success).toBe(false);
    for (const p of [fm, labels]) {
      const text = renderTemplate(p, { company: "Example: #yes", role: "Engineer", status: "INTERVIEW", followUpDate: "2026-10-25" }, "new_id");
      expect(parseNote(text, p)).toMatchObject({ id: "new_id", errors: [], values: { company: "Example: #yes", status: "INTERVIEW", followUpDate: "2026-10-25" } });
    }
  });
  it("matches only configured relative selection globs", () => {
    expect(matchesFile("note.md", fm)).toBe(true);
    expect(matchesFile("a/b/note.md", fm)).toBe(true);
    expect(matchesFile("Dossier/view.md", fm)).toBe(false);
    expect(matchesFile("note.txt", fm)).toBe(false);
  });
  it("produces exact diffs and creates missing sections only explicitly", () => {
    expect(fileDiff("a\nb\nc", "a\nx\nc")).toBe("@@ line 2 @@\n-b\n+x");
    expect(fileDiff("x", "x")).toBe("No changes");
    expect(writeNote("# Notes\n", fm, { company: "A" }, "id")).toContain('company_name: "A"');
    expect(() => writeNote(fixture, fm, {}, "bad id")).toThrow("identifier");
    expect(() => writeNote(fixture, fm, { postingText: "x" })).toThrow("section is missing");
  });
});
describe("three-way merge", () => {
  it("merges independent fields, preserves missing vs empty, flags same-field edits", () => {
    expect(mergeValues({ company: "A", role: "B" }, { company: "App", role: "B" }, { company: "A", role: "File" })).toEqual({ values: { company: "App", role: "File" }, conflicts: [] });
    expect(mergeValues({ company: "A" }, { company: "A" }, { company: "" }).values.company).toBe("");
    expect(mergeValues({ company: "A" }, { company: "A" }, {}).values.company).toBe("A");
    expect(mergeValues({ body: "base" }, { body: "app" }, { body: "file" }).conflicts).toEqual([{ field: "body", base: "base", app: "app", file: "file" }]);
  });
});
