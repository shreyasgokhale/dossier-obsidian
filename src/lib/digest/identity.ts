import { createHash } from "node:crypto";
import { linkKey, type FoundPosting } from "@/lib/job-search/search";
const normal = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\(?\b(?:m\/w\/d|f\/m\/d|all genders)\b\)?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function identityKeys(
  p: Pick<
    FoundPosting,
    "source" | "externalId" | "url" | "company" | "title" | "place"
  >,
): string[] {
  const link = linkKey(p.url);
  // Company and title survive dismissal trimming. Conservative: locations of
  // the same role at one employer form one opportunity for this single user.
  const facts =
    p.company.trim() && p.title.trim()
      ? `${normal(p.company)}|${normal(p.title)}`
      : "";
  return [
    `id:${p.source}:${p.externalId}`,
    ...(link ? [`url:${link}`] : []),
    ...(facts ? [`role:${facts}`] : []),
  ].map((s) => createHash("sha256").update(s).digest("hex"));
}
