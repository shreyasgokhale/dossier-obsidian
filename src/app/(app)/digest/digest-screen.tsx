"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";
import { ScoreBadge } from "@/components/score-badge";
import { SourceAttribution } from "@/components/source-attribution";
import { toast, toastResult } from "@/components/toast";
import { useJob } from "@/hooks/use-job";
import type { DigestView } from "@/lib/digest/view";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { dismissAgentCandidate, runAgentNow } from "../agent/actions";
import { savePostingForLater } from "../jobs/actions";
import { useStartApplication } from "../jobs/use-start-application";
export function DigestScreen({
  view,
  configured,
  enabled,
  runJobId,
}: {
  view: DigestView;
  configured: boolean;
  enabled: boolean;
  runJobId: string | null;
}) {
  const router = useRouter(),
    [pending, start] = useTransition(),
    [jobId, setJobId] = useState(runJobId),
    [below, setBelow] = useState(false);
  const application = useStartApplication();
  const job = useJob<{ message: string }>(jobId, 0, (j) => {
    if (j.status === "DONE" || j.status === "FAILED") {
      setJobId(null);
      toast(j.result?.message ?? j.error ?? "Digest completed.");
      router.refresh();
    }
  });
  const digest = view.digest;
  const items =
    digest?.items.filter(
      (i) => !i.dismissed && !i.state.dismissed && !i.state.applicationId,
    ) ?? [];
  return (
    <>
      <PageHeader
        title="Daily job digest"
        description="New opportunities matched to your profile and search intent. Review strong matches and a few stretch roles."
        actions={
          <div className="flex gap-4">
            <Link
              href="/search-preferences"
              className={buttonClassName("secondary", "sm")}
            >
              Search Preferences
            </Link>
            <Button
              disabled={pending || !!jobId || !configured || !enabled}
              onClick={() =>
                start(async () => {
                  const r = toastResult(await runAgentNow({}));
                  if (r.ok) setJobId(r.data.jobId);
                })
              }
            >
              {jobId ? "Running…" : "Run now"}
            </Button>
          </div>
        }
      />
      <div className="flex flex-col gap-6 px-10 pb-20">
        {(!configured || !enabled) && (
          <p className="rounded-card bg-warning-surface p-4 text-sm text-warning">
            {!configured
              ? "Set up Search Preferences to build your digest."
              : "Daily discovery is paused. Enable it in Search Preferences to run again."}{" "}
            <Link href="/search-preferences" className="underline">
              Edit preferences
            </Link>
          </p>
        )}
        {jobId && <p role="status">{job?.step ?? "Starting discovery…"}</p>}
        {view.history.length > 0 && (
          <label className="text-sm">
            Digest history{" "}
            <select
              className="ml-3 rounded border border-line p-2"
              value={digest?.id ?? ""}
              onChange={(e) =>
                router.push(`/digest?id=${encodeURIComponent(e.target.value)}`)
              }
            >
              {view.history.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                  {h.demo ? " · DEMO" : " · Source results"}
                </option>
              ))}
            </select>
          </label>
        )}
        {!digest ? (
          <Card>
            <h2 className="font-serif text-section">Your first digest</h2>
            <p className="text-sm text-muted">
              Configure your roles, locations and sources, then run discovery.
              Saved jobs and dismissals stay in Dossier.
            </p>
          </Card>
        ) : (
          <>
            <Card className="flex flex-col gap-3">
              <h2 className="font-serif text-section">
                {digest.demo ? "DEMO — synthetic results" : "Source results"}
              </h2>
              {digest.demo && (
                <p role="note" className="text-sm text-warning">
                  These postings and AI scores are synthetic fixtures for
                  review. They are not live vacancies.
                </p>
              )}
              <p className="text-sm">
                {digest.message ||
                  "This run has not finished. Completed results are preserved."}
              </p>
              <details>
                <summary className="cursor-pointer text-sm">
                  Source status
                </summary>
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {digest.sources.map((s) => (
                    <li key={s.source}>
                      <strong>{s.source}</strong>: {s.status} · {s.count}{" "}
                      {s.count === 1 ? "result" : "results"}{" "}
                      {s.message && (
                        <span className="text-warning">— {s.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
            {(["strong", "stretch", "below"] as const).map((kind) => {
              const group = items.filter((i) => i.kind === kind);
              if (kind === "below" && !below)
                return (
                  <Button
                    key={kind}
                    variant="secondary"
                    onClick={() => setBelow(true)}
                  >
                    Show {group.length} lower matches
                  </Button>
                );
              return (
                <section
                  key={kind}
                  className="flex flex-col gap-3"
                  aria-label={
                    kind === "strong"
                      ? "Strong matches"
                      : kind === "stretch"
                        ? "Stretch roles"
                        : "Lower matches"
                  }
                >
                  <h2 className="font-serif text-section">
                    {kind === "strong"
                      ? "Strong matches"
                      : kind === "stretch"
                        ? "Stretch roles · meaningful gaps to review"
                        : "Lower matches"}{" "}
                    <span className="text-sm text-muted">({group.length})</span>
                  </h2>
                  {group.length === 0 && (
                    <p className="text-sm text-muted">
                      {kind === "strong"
                        ? "No new strong matches in this digest. Check source status or adjust your preferences."
                        : "None in this digest."}
                    </p>
                  )}
                  {group.map((item) => (
                    <Card key={item.id} className="flex flex-col gap-3">
                      <div className="flex justify-between gap-4">
                        <div>
                          <h3 className="font-serif text-[22px]">
                            {item.posting.title}
                          </h3>
                          <p>{item.posting.company}</p>
                          <p className="text-sm text-muted">
                            {[
                              item.posting.place,
                              item.posting.remote === true
                                ? "Remote"
                                : item.posting.remote === false
                                  ? "Not remote"
                                  : "Work arrangement unknown",
                              item.posting.salary,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <p className="text-xs text-muted">
                            {SOURCE_INFO[item.posting.source].name}
                            {item.posting.via ? ` · ${item.posting.via}` : ""}
                          </p>
                        </div>
                        <ScoreBadge score={item.score} />
                      </div>
                      <div>
                        <h4 className="text-sm font-medium">Why it fits</h4>
                        <ul className="list-disc pl-5 text-sm text-muted">
                          {item.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-card bg-warning-surface p-3 text-sm text-warning">
                        <h4 className="font-medium">Gaps and unknowns</h4>
                        <ul className="list-disc pl-5">
                          {item.gaps.length ? (
                            item.gaps.map((r, i) => <li key={i}>{r}</li>)
                          ) : (
                            <li>
                              No specific gaps reported. Verify requirements on
                              the source posting.
                            </li>
                          )}
                        </ul>
                      </div>
                      <SourceAttribution
                        source={item.posting.source}
                        url={item.posting.url}
                      />
                      <div className="flex flex-wrap gap-3 border-t border-line pt-3">
                        <Button
                          size="sm"
                          disabled={pending || application.starting !== null}
                          onClick={() =>
                            void application.start(item.posting, item.id)
                          }
                        >
                          Start application
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending || item.state.saved}
                          onClick={() =>
                            start(async () => {
                              toastResult(
                                await savePostingForLater({
                                  posting: item.posting,
                                }),
                              );
                              router.refresh();
                            })
                          }
                        >
                          {item.state.saved ? "Saved" : "Save"}
                        </Button>
                        {item.posting.url && (
                          <a
                            href={item.posting.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonClassName("secondary", "sm")}
                          >
                            Open source
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="danger-text"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              if (
                                toastResult(
                                  await dismissAgentCandidate({
                                    candidateId: item.id,
                                  }),
                                ).ok
                              )
                                router.refresh();
                            })
                          }
                        >
                          Dismiss
                        </Button>
                      </div>
                    </Card>
                  ))}
                </section>
              );
            })}
          </>
        )}
        <p className="text-xs text-muted">
          Discovery creates no per-job Markdown files. Start application opens
          Dossier’s existing application workflow; Markdown sync begins when you
          create the application.{" "}
          <Link href="/jobs?view=saved" className="underline">
            Saved jobs
          </Link>
        </p>
      </div>
    </>
  );
}
