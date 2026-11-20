"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { SUBMISSION_DETAILS_LIMIT } from "@/lib/submission-data";

export function SubmissionForm({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const sentAt = new Date(String(data.get("submittedAt")));
    if (Number.isNaN(sentAt.getTime())) {
      setError("Enter the date and time you submitted the application.");
      return;
    }
    data.set("submittedAt", sentAt.toISOString());
    const files = data.getAll("files");
    data.delete("files");
    for (const file of files) {
      if (file instanceof File && file.name) data.append("files", file);
    }
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/applications/${encodeURIComponent(id)}/submission`, { method: "POST", body: data });
        const result = await response.json();
        if (!response.ok) {
          setError(result.error ?? "Could not record this submission.");
          return;
        }
        router.refresh();
      } catch {
        setError("Could not confirm whether Dossier saved this submission. Refresh to check, or try again.");
      }
    });
  }

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-muted">Record this after applying. Upload the exact files you sent, if any.</p>
      <label className="flex flex-col gap-1.5 text-sm">
        Submitted at (local time)
        <input className="rounded-control border border-line-input bg-input p-2" name="submittedAt" type="datetime-local" required />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Submitted files (up to 5 MiB total)
        <input className="rounded-control border border-line-input bg-input p-2" name="files" type="file" multiple />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Submitted text
        <textarea className="rounded-control border border-line-input bg-input p-2" name="submittedText" maxLength={SUBMISSION_DETAILS_LIMIT} rows={5} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="noDocuments" type="checkbox" />
        I applied without submitting files or document text
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Confirmation or receipt
        <textarea className="rounded-control border border-line-input bg-input p-2" name="details" maxLength={SUBMISSION_DETAILS_LIMIT} rows={5} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Confirm submission"}</Button>
    </form>
  );
}
