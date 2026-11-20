"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApplicationEvidenceKind } from "@/generated/prisma/enums";
import { EVIDENCE_LABELS, EVIDENCE_TEXT_LIMIT } from "@/lib/application-evidence-data";

export function EvidenceForm({ id, correction }: {
  id: string;
  correction?: { id: string; kind: ApplicationEvidenceKind };
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ApplicationEvidenceKind>(correction?.kind ?? ApplicationEvidenceKind.REPLY);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const path = `/applications/${encodeURIComponent(id)}/evidence`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("kind", kind);
    const file = data.get("file");
    if (file instanceof File && !file.name) data.delete("file");
    if (correction) data.set("correctsId", correction.id);
    const occurredAt = data.get("occurredAt");
    if (typeof occurredAt === "string" && occurredAt) {
      const time = new Date(occurredAt);
      if (Number.isNaN(time.getTime())) {
        setError("Enter a valid date and time.");
        return;
      }
      data.set("occurredAt", time.toISOString());
    } else {
      data.delete("occurredAt");
    }
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api${path}`, { method: "POST", body: data });
        if (!response.ok) {
          const result = await response.json();
          setError(result.error ?? "Could not save this evidence.");
          return;
        }
        form.reset();
        if (correction) router.replace(path);
        router.refresh();
      } catch {
        setError("Could not confirm whether the evidence was saved. Refresh and check the history.");
      }
    });
  }

  const recording = kind === ApplicationEvidenceKind.RECORDING;
  return (
    <form id="add-evidence" method="post" onSubmit={submit} className="flex flex-col gap-4 rounded-panel border border-line-card bg-card p-5">
      <h2 className="font-medium">{correction ? `Correct ${EVIDENCE_LABELS[kind].toLowerCase()}` : "Add follow-up evidence"}</h2>
      {!correction && (
        <label className="flex flex-col gap-1.5 text-sm">
          Evidence type
          <select className="rounded-control border border-line-input bg-input p-2" value={kind} onChange={(event) => setKind(event.target.value as ApplicationEvidenceKind)}>
            {Object.entries(EVIDENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        When it happened (optional, local time)
        <input className="rounded-control border border-line-input bg-input p-2" name="occurredAt" type="datetime-local" />
      </label>
      {recording && (
        <label className="flex flex-col gap-1.5 text-sm">
          Recording file (up to 5 MiB)
          <input className="rounded-control border border-line-input bg-input p-2" name="file" type="file" accept="audio/*,video/*" required={!correction} />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        {recording ? "Transcript or context" : correction ? "Corrected evidence text" : "Evidence text"}
        <textarea className="rounded-control border border-line-input bg-input p-2" name="text" maxLength={EVIDENCE_TEXT_LIMIT} rows={5} required={!recording} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : correction ? "Save correction" : "Save evidence"}</Button>
        {correction && <Link className="text-sm underline" href={path}>Cancel</Link>}
      </div>
    </form>
  );
}
