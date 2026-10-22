"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FIELDS, profileSchema, type FormatProfile, type Values } from "@/lib/markdown/profile";
import type { integrationView, adoptionPreview, profileReview } from "@/lib/markdown/service";
import type { resumePreview } from "@/lib/markdown/resume";
import { markdownCommand } from "./markdown-actions";
import { SettingsSectionIntro } from "./settings-screen";

type View = Awaited<ReturnType<typeof integrationView>>;
type DocumentView = { documentId: string; path: string; error: string | null; conflict: unknown; contentHash: string };
export function MarkdownSection({ initial }: { initial: View }) {
  const [view, setView] = useState(initial);
  const [profileId, setProfileId] = useState(initial.profiles[0]?.id ?? "");
  const [config, setConfig] = useState<FormatProfile>(initial.profiles[0].config);
  const [json, setJson] = useState(JSON.stringify(config, null, 2));
  const [file, setFile] = useState("");
  const [fill, setFill] = useState<Values>({ company: "", role: "", status: "DRAFT" });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof adoptionPreview>> | null>(null);
  const [review, setReview] = useState<Awaited<ReturnType<typeof profileReview>> | null>(null);
  const [resume, setResume] = useState<Awaited<ReturnType<typeof resumePreview>> | null>(null);
  const [language, setLanguage] = useState<"en" | "de">("en");
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [sample, setSample] = useState("");
  const [sampleResult, setSampleResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [choices, setChoices] = useState<Record<string, Record<string, "app" | "file">>>({});
  async function run(input: Parameters<typeof markdownCommand>[0]) {
    setBusy(true); setMessage("");
    try {
      const result = await markdownCommand(input);
      if (!result.ok) { setMessage(result.error); return; }
      const data = result.data;
      if ("view" in data && data.view) setView(data.view);
      if ("preview" in data && data.preview !== undefined) setPreview(data.preview);
      if ("review" in data && data.review !== undefined) setReview(data.review);
      if ("resume" in data && data.resume !== undefined) setResume(data.resume);
      if ("sample" in data) setSampleResult(data.sample);
      if ("documents" in data && data.documents !== undefined) setDocuments(data.documents);
      if ("adopted" in data) { setMessage(`Adopted application ${data.adopted}`); setPreview(null); }
      if ("staged" in data && data.staged !== undefined) { setProfileId(data.staged); setMessage("Profile staged. Generate and review the dry run before activation."); setReview(null); }
      if (input.command === "default-profile") setMessage("Profile selected for newly created notes.");
      if (input.command === "activate") { setReview(null); setMessage("Reviewed profile activated."); }
    } catch { setMessage("The request was interrupted. Refresh to check its saved state before retrying."); }
    finally { setBusy(false); }
  }
  function change(next: FormatProfile) { setConfig(next); setJson(JSON.stringify(next, null, 2)); setReview(null); }
  return <>
    <SettingsSectionIntro title="Markdown integration">Configure ordinary Markdown notes, review changes, and resolve synchronization problems.</SettingsSectionIntro>
    <p className="text-sm text-muted">{view.enabled ? "Notes mount connected. Files reconcile at startup and every 15 seconds." : "Set DOSSIER_NOTES_ROOT and DOSSIER_DATA_DIR in deployment configuration to enable synchronization."}</p>
    {message && <p role="status" className="text-sm">{message}</p>}{view.error && <p role="alert">{view.error}</p>}
    <div className="flex gap-3"><Button disabled={busy} onClick={() => run({ command: "refresh" })}>Refresh status</Button><Button variant="secondary" disabled={busy || !view.enabled} onClick={() => run({ command: "reconcile" })}>Reconcile now</Button></div>
    <section className="flex flex-col gap-4 rounded-card border border-line p-5">
      <h3 className="font-serif text-xl">Format profiles</h3>
      <label className="text-sm">Profile<select aria-label="Format profile" className="ml-3 rounded-control border border-line p-2" value={profileId} onChange={(e) => { const p = view.profiles.find((p) => p.id === e.target.value)!; setProfileId(p.id); change(p.draft ?? p.config); setPreview(null); }}>{view.profiles.map((p) => <option key={p.id} value={p.id}>{p.config.name}{p.paused ? " (paused for review)" : ""}</option>)}</select></label>
      <Input label="Profile name" value={config.name} onChange={(e) => change({ ...config, name: e.target.value })} />
      <label className="text-sm">Representation<select aria-label="Field representation" value={config.representation} onChange={(e) => change({ ...config, representation: e.target.value as FormatProfile["representation"] })}><option value="frontmatter">YAML frontmatter</option><option value="labels">Labeled Markdown lines</option></select></label>
      <div className="grid grid-cols-2 gap-3">{FIELDS.map((field) => <Input key={field} label={field} value={config.fields[field] ?? ""} onChange={(e) => { const fields = { ...config.fields }; if (e.target.value) fields[field] = e.target.value; else delete fields[field]; change({ ...config, fields }); }} />)}</div>
      <Input label="Metadata heading" value={config.metadataHeading} onChange={(e) => change({ ...config, metadataHeading: e.target.value })} />
      <Input label="Stable ID property" value={config.idProperty} onChange={(e) => change({ ...config, idProperty: e.target.value })} />
      <Input label="Include files (comma separated)" value={config.selection.include.join(", ")} onChange={(e) => change({ ...config, selection: { ...config.selection, include: e.target.value.split(",").map((v) => v.trim()) } })} />
      <Input label="Exclude files (comma separated)" value={config.selection.exclude.join(", ")} onChange={(e) => change({ ...config, selection: { ...config.selection, exclude: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } })} />
      <label className="text-sm">Date format<select aria-label="Mapped date format" value={config.dateFormat} onChange={(e) => change({ ...config, dateFormat: e.target.value as FormatProfile["dateFormat"] })}>{["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <Input label="Posting heading (optional)" value={config.postingHeading ?? ""} onChange={(e) => change({ ...config, postingHeading: e.target.value || undefined })} />
      <Input label="Interview notes heading (optional)" value={config.interviewHeading ?? ""} onChange={(e) => change({ ...config, interviewHeading: e.target.value || undefined })} />
      <Textarea label="New note template" value={config.template} onChange={(e) => change({ ...config, template: e.target.value })} rows={7} />
      <Textarea label="Versioned profile JSON (including status aliases)" value={json} onChange={(e) => setJson(e.target.value)} rows={10} />
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { try { const parsed = profileSchema.safeParse(JSON.parse(json)); if (!parsed.success) { setMessage(parsed.error.issues.map((issue) => issue.message).join(" ")); return; } change(parsed.data); setMessage("JSON imported into editor; save and review before activation."); } catch { setMessage("Invalid JSON. Check quotes and commas."); } }}>Import JSON into editor</Button><Button variant="secondary" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "dossier-format-profile.json"; a.click(); URL.revokeObjectURL(url); }}>Export profile JSON</Button><Button disabled={busy} onClick={() => run({ command: "stage", id: profileId, config })}>Save draft and pause sync</Button><Button disabled={busy} variant="secondary" onClick={() => run({ command: "stage", config })}>Save as new profile</Button><Button disabled={busy} variant="secondary" onClick={() => run({ command: "review", id: profileId })}>Generate dry run</Button><Button disabled={busy} variant="secondary" onClick={() => run({ command: "default-profile", id: profileId })}>Use profile for new notes</Button></div>
      {review && <div><h4>Dry-run review</h4>{review.files.length === 0 && <p>No linked files affected.</p>}{review.files.map((f) => <div key={f.file}><strong>{f.file}</strong>{f.error ? <p role="alert">{f.error}</p> : <pre className="overflow-auto whitespace-pre-wrap text-xs">{f.diff}</pre>}</div>)}<Button disabled={busy || review.files.some((f) => f.error)} onClick={() => run({ command: "activate", id: review.id, token: review.token })}>Confirm reviewed profile changes</Button></div>}
      <Textarea label="Sample Markdown for preview" value={sample} onChange={(e) => setSample(e.target.value)} rows={6} />
      <Button variant="secondary" disabled={busy} onClick={() => run({ command: "sample", config, text: sample, values: fill })}>Preview parsing, diff and template</Button>
      {sampleResult !== null && <pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(sampleResult, null, 2)}</pre>}
    </section>
    <section className="flex flex-col gap-4 rounded-card border border-line p-5"><h3 className="font-serif text-xl">Adopt an existing note in place</h3>
      <label className="text-sm">File<select aria-label="Note to adopt" className="ml-3 max-w-full border border-line p-2" value={file} onChange={(e) => { setFile(e.target.value); setPreview(null); }}><option value="">Select a note</option>{view.files.filter((f) => !view.links.some((l) => l.path === f)).map((f) => <option key={f}>{f}</option>)}</select></label>
      <p className="text-sm text-muted">Review the parsed values and section mappings in the selected profile. Fill only missing or empty fields below; nothing is written until confirmation.</p>
      <div className="grid grid-cols-2 gap-3">{FIELDS.map((field) => <Input key={field} label={`Fill ${field}`} value={fill[field] ?? ""} onChange={(e) => { setFill({ ...fill, [field]: e.target.value }); setPreview(null); }} />)}</div>
      <Button disabled={busy || !file} onClick={() => run({ command: "preview", file, profileId, fill })}>Review adoption</Button>
      {preview && <div><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ parsed: preview.parsed, proposed: preview.values, creates: preview.creates }, null, 2)}</pre><pre className="overflow-auto whitespace-pre-wrap text-xs">{preview.diff}</pre><Button disabled={busy || !!preview.parsed.errors.length} onClick={() => run({ command: "adopt", file, profileId, expected: preview.hash, profileHash: preview.profileHash, fill })}>Confirm adoption and section mappings</Button></div>}
    </section>
    <section className="flex flex-col gap-4 rounded-card border border-line p-5"><h3 className="font-serif text-xl">Synchronization</h3>
      <p className="text-sm">{view.pending.length} pending changes. Filesystem failures retain queued work for retry.</p>
      {view.pending.filter((p) => p.error).map((p) => <p key={p.applicationId} role="alert">{p.applicationId}: {p.error} ({p.attempts} attempts)</p>)}
      {view.links.map((l) => <div key={l.applicationId} className="border-t border-line pt-3 text-sm"><Link href={`/applications/${l.applicationId}`}>{l.path}</Link> · {l.state}{view.vault && <> · <a href={`obsidian://open?vault=${encodeURIComponent(view.vault)}&file=${encodeURIComponent(l.path)}`}>Open in Obsidian</a></>}{l.error && <p>{l.error}</p>}{l.conflict && <div>{l.conflict.conflicts.map((c) => <div key={c.field}><strong>{c.field}</strong><pre className="whitespace-pre-wrap text-xs">App: {c.app}\nFile: {c.file}\nBase: {c.base}</pre><label>Keep<select aria-label={`Resolve ${l.applicationId} ${c.field}`} value={choices[l.applicationId]?.[c.field] ?? ""} onChange={(e) => setChoices({ ...choices, [l.applicationId]: { ...choices[l.applicationId], [c.field]: e.target.value as "app" | "file" } })}><option value="">Choose version</option><option value="app">App version</option><option value="file">File version</option></select></label></div>)}<Button disabled={busy} onClick={() => run({ command: "resolve", id: l.applicationId, choices: choices[l.applicationId] ?? {}, expected: l.conflict!.fileHash })}>Resolve reviewed conflicts</Button></div>}</div>)}
      {documents.map((d) => <div key={d.documentId} className="text-sm"><strong>{d.path}</strong>{d.error && <p role="alert">{d.error}</p>}{d.error && <Button disabled={busy} onClick={() => run({ command: "document-repair", id: d.documentId, expected: d.contentHash })}>Repair from app (preserve damaged copy)</Button>}{!!d.conflict && <><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(d.conflict, null, 2)}</pre><Button disabled={busy} onClick={() => run({ command: "document-resolve", id: d.documentId, choice: "app", expected: d.contentHash })}>Keep app document</Button><Button disabled={busy} onClick={() => run({ command: "document-resolve", id: d.documentId, choice: "file", expected: d.contentHash })}>Keep file document</Button></>}</div>)}
    </section>
    <section className="flex flex-col gap-4 rounded-card border border-line p-5"><h3 className="font-serif text-xl">Resume source collections</h3><p className="text-sm text-muted">Read-only runtime source mount. Review additions, changes, removals and renames before importing a language variant.</p><label>Language<select aria-label="Resume source language" value={language} onChange={(e) => { setLanguage(e.target.value as "en" | "de"); setResume(null); }}><option value="en">English</option><option value="de">Deutsch</option></select></label><Button disabled={busy} onClick={() => run({ command: "resume-preview", language })}>Preview resume import</Button>{resume && <><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(resume, null, 2)}</pre><Button disabled={busy || !!resume.errors.length} onClick={() => run({ command: "resume-import", language, token: resume.token })}>Confirm reviewed resume import</Button></>}</section>
  </>;
}
