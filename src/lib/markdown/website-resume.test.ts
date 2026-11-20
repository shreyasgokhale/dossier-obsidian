import { describe, expect, it } from "vitest";
import { source, websiteConfig } from "@/test/website-resume-fixtures";
import { parseResumeSource } from "./resume-source";
import { convertWebsiteResume } from "./website-resume";

describe("website résumé conversion", () => {
  it("maps every résumé collection while preserving source text and literal tags", () => {
    const original = [
      source("about/about.md", {}, "First paragraph.\n\nSecond paragraph."),
      source("work/example.md", { company: "Example Labs", role: "Engineer", location: "Berlin", dateStart: "02/01/2021", dateEnd: "Current", tags: ["C", "ROS2"] }, "- Built a system.\n- Measured results."),
      source("education/example.md", { company: "Example University", role: "MSc", dateStart: "09/01/2017", dateEnd: "11/01/2020" }),
      source("projects/example.md", { title: "Example Robot", description: "A literal description.", date: "2020-03-01", repoURL: "https://example.org/robot" }, "- Tested navigation."),
      source("skills/example.md", { category: "Systems" }, "- C++\n- ROS2\n- C++"),
      source("skills/other.md", { category: "Other" }, "- ROS2"),
      source("languages/english.md", { language: "English", proficiency: "Fluent" }, ""),
    ];
    const before = JSON.stringify(original);
    const result = convertWebsiteResume(original, websiteConfig);
    const entries = result.sources.map((file) => parseResumeSource(file.text));
    expect(entries).toHaveLength(7);
    expect(entries.find((entry) => entry.collection === "about")).toMatchObject({ name: "Alex Example", headline: "Systems engineer", body: "First paragraph.\n\nSecond paragraph." });
    expect(entries.find((entry) => entry.collection === "experience")).toMatchObject({ source_id: "example", start: "2021-02", current: true, body: "- Built a system.\n- Measured results.\n\nTechnologies: C, ROS2" });
    expect(entries.find((entry) => entry.collection === "education")).toMatchObject({ degree: "MSc", school: "Example University", end: "2020-11" });
    expect(entries.find((entry) => entry.collection === "projects")).toMatchObject({ name: "Example Robot", start: "2020-03", link: "https://example.org/robot", body: "A literal description.\n\n- Tested navigation." });
    expect(entries.filter((entry) => entry.collection === "skills").map((entry) => entry.name).sort()).toEqual(["C++", "ROS2"]);
    expect(entries.find((entry) => entry.name === "ROS2")?.group).toBe("Systems");
    expect(entries.find((entry) => entry.collection === "languages")).toMatchObject({ level: "C1", body: "Website proficiency: Fluent" });
    expect(JSON.stringify(original)).toBe(before);
    expect(convertWebsiteResume([...original].reverse(), websiteConfig)).toEqual(result);
  });

  it("pairs explicit language variants with one stable identity and excludes unrelated content/drafts", () => {
    const fields = { company: "Example", role: "Engineer", location: "Berlin", dateStart: "01/01/2020", dateEnd: "12/31/2021" };
    const result = convertWebsiteResume([
      source("work/example.md", fields),
      source("work/example.de.md", { ...fields, lang: "de", role: "Ingenieur" }),
      source("about/about-de.md", { lang: "de" }),
      source("about/home.md", {}),
      source("scribbles/private.md", {}),
      source("projects/draft.md", { draft: true }),
    ], websiteConfig);
    const entries = result.sources.map((file) => parseResumeSource(file.text));
    expect(entries.filter((entry) => entry.collection === "experience").map((entry) => [entry.source_id, entry.language])).toEqual([["example", "de"], ["example", "en"]]);
    expect(entries.find((entry) => entry.collection === "about")?.headline).toBe("Systemingenieur");
    expect(result.skipped.sort()).toEqual(["about/home.md", "projects/draft.md", "scribbles/private.md"]);
  });

  it("never guesses proficiency, ambiguous dates, language variants or duplicate identities", () => {
    expect(() => convertWebsiteResume([source("languages/german.md", { language: "German", proficiency: "Citizen" })], websiteConfig)).toThrow('mapping for "Citizen"');
    expect(() => convertWebsiteResume([source("projects/x.md", { title: "X", description: "X", date: "02/30/2020" })], websiteConfig)).toThrow("Invalid calendar date");
    expect(() => convertWebsiteResume([source("work/example.de.md", {})], websiteConfig)).toThrow("language disagree");
    expect(() => convertWebsiteResume([source("about/about.md", {}), source("about/about.md", {})], websiteConfig)).toThrow("Duplicate website source identity");
    expect(() => convertWebsiteResume([{ path: "about/about.md", text: "---\nlang: en\nlang: de\n---\n" }], websiteConfig)).toThrow("unique");
    expect(() => convertWebsiteResume([source("projects/x.md", { draft: "false" })], websiteConfig)).toThrow();
    expect(() => convertWebsiteResume([source("../about/about.md", {})], websiteConfig)).toThrow("No website résumé sources");
  });

  it("accepts explicit CEFR values and stable source IDs across renames", () => {
    const files = [source("languages/renamed.md", { source_id: "language_1", language: "English", proficiency: "C2" })];
    expect(parseResumeSource(convertWebsiteResume(files, websiteConfig).sources[0].text)).toMatchObject({ source_id: "language_1", level: "C2" });
  });
});
