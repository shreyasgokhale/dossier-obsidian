import { z } from "zod";

export const FIELDS = ["company", "role", "status", "applicationDate", "postingUrl", "location", "deadline", "nextAction", "followUpDate", "nextInterviewAt"] as const;
export type Field = (typeof FIELDS)[number];
export const STATUSES = ["DRAFT", "SENT", "SCREENING", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED", "DECLINED"] as const;
export type Values = Partial<Record<Field | "body" | "postingText", string>>;
const name = z.string().min(1).max(100).regex(/^[\p{L}\p{N}_ .-]+$/u);
const glob = z.string().min(1).max(200).refine((s) => !s.startsWith("/") && !s.split("/").includes("..") && !/[\\\[\]{}?!]/.test(s), "Use relative paths with literal names, * or ** only.");
export const profileSchema = z.object({
  version: z.literal(1), name: z.string().min(1).max(100),
  representation: z.enum(["frontmatter", "labels"]),
  selection: z.object({ include: z.array(glob).min(1), exclude: z.array(glob) }).strict(),
  fields: z.partialRecord(z.enum(FIELDS), z.string().min(1).max(100).refine((s) => !/[\r\n]/.test(s), "Mappings must be single lines.")),
  idProperty: name.default("dossier_id"), metadataHeading: z.string().min(1).max(100).default("Application"),
  statusAliases: z.record(z.string().min(1), z.enum(STATUSES)),
  dateFormat: z.enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY"]),
  template: z.string().max(100_000),
  postingHeading: z.string().min(1).max(100).optional(), interviewHeading: z.string().min(1).max(100).optional(),
}).strict().superRefine((p, ctx) => {
  const mappings = Object.values(p.fields);
  if (new Set(mappings).size !== mappings.length) ctx.addIssue({ code: "custom", message: "Each field needs a unique property or label." });
  if (p.representation === "frontmatter" && mappings.some((v) => !/^[\p{L}\p{N}_-]+$/u.test(v))) ctx.addIssue({ code: "custom", message: "YAML property names must use letters, numbers, _ or -." });
  if (mappings.includes(p.idProperty)) ctx.addIssue({ code: "custom", message: "The stable ID property cannot also map a field." });
  if (p.postingHeading && p.postingHeading === p.interviewHeading) ctx.addIssue({ code: "custom", message: "Posting and interview headings must differ." });
  for (const match of p.template.matchAll(/\{\{([^{}]+)\}\}/g)) if (![...FIELDS, "id"].includes(match[1].trim() as Field)) ctx.addIssue({ code: "custom", message: `Unknown template placeholder: ${match[1]}` });
  if (/\{\{|\}\}/.test(p.template.replace(/\{\{[^{}]+\}\}/g, ""))) ctx.addIssue({ code: "custom", message: "Malformed template placeholder." });
});
export type FormatProfile = z.infer<typeof profileSchema>;
export const defaultProfile: FormatProfile = {
  version: 1, name: "Frontmatter", representation: "frontmatter",
  selection: { include: ["**/*.md"], exclude: ["Dossier/**"] },
  fields: { company: "company_name", role: "job_role", status: "status", applicationDate: "application_date", postingUrl: "job_url", location: "location", deadline: "deadline", nextAction: "next_action", followUpDate: "follow_up_date", nextInterviewAt: "next_interview_at" },
  idProperty: "dossier_id", metadataHeading: "Application",
  statusAliases: Object.fromEntries(STATUSES.flatMap((s) => [[s.toLowerCase(), s], [s[0] + s.slice(1).toLowerCase(), s]])),
  dateFormat: "YYYY-MM-DD", template: "---\ncompany_name: {{company}}\njob_role: {{role}}\nstatus: {{status}}\n---\n\n# Interview\n\n",
};
export const labeledProfile: FormatProfile = { ...defaultProfile, name: "Labeled lines", representation: "labels", fields: { company: "Company:", role: "Role:", status: "Status:", applicationDate: "Applied:", postingUrl: "URL:", location: "Location:", deadline: "Deadline:", nextAction: "Next action:", followUpDate: "Follow-up:", nextInterviewAt: "Interview at:" }, template: "# Application\n\nCompany: {{company}}\nRole: {{role}}\nStatus: {{status}}\n\n# Interview\n\n" };
export function matchesFile(file: string, p: FormatProfile): boolean {
  const matches = (pattern: string): boolean => {
    const expression = pattern.split("/").map((part) => part === "**" ? ".*" : part.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join("/");
    return new RegExp(`^${expression}$`).test(file) || (pattern.startsWith("**/") && matches(pattern.slice(3)));
  };
  return p.selection.include.some(matches) && !p.selection.exclude.some(matches);
}
