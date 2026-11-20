import { stringify } from "yaml";
import type { WebsiteResumeConfig } from "../lib/markdown/website-resume";

export const websiteConfig: WebsiteResumeConfig = {
  basics: {
    en: { name: "Alex Example", headline: "Systems engineer" },
    de: { name: "Alex Example", headline: "Systemingenieur" },
  },
  languageLevels: { Fluent: "C1", Fließend: "C1" },
};
export const source = (path: string, fields: Record<string, unknown>, body = "Literal source text.") => ({
  path, text: `---\n${stringify(fields)}---\n${body}\n`,
});
