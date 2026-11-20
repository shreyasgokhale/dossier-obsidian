"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast, toastResult } from "@/components/toast";
import {
  DEFAULT_PREFERENCES,
  DIGEST_SOURCES,
  searchPreferencesSchema,
} from "@/lib/digest/preferences";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import type { preferenceView } from "@/lib/markdown/search-preferences";
import {
  savePreferences,
  resolvePreferences,
  reconcilePreferences,
} from "./actions";
type View = Awaited<ReturnType<typeof preferenceView>>;
const list = (s: string) =>
  s
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
export function PreferencesEditor({ view }: { view: View }) {
  const router = useRouter(),
    [pending, start] = useTransition();
  const initial = view.preferences ?? DEFAULT_PREFERENCES;
  const [roles, setRoles] = useState(initial.roles.join("\n")),
    [locations, setLocations] = useState(
      initial.locations.map((l) => `${l.place} | ${l.country}`).join("\n"),
    );
  const [remote, setRemote] = useState(initial.remote),
    [exclusions, setExclusions] = useState(initial.exclusions.join("\n")),
    [interests, setInterests] = useState(initial.interests.join("\n"));
  const [sources, setSources] = useState(initial.sources),
    [boards, setBoards] = useState(
      initial.boards
        .map((b) => `${b.name} | ${b.provider} | ${b.slug}`)
        .join("\n"),
    );
  const [enabled, setEnabled] = useState(view.enabled),
    [hour, setHour] = useState(view.hour);
  const save = () =>
    start(async () => {
      const result = searchPreferencesSchema.safeParse({
        roles: list(roles),
        locations: list(locations).map((line) => {
          const [place, country] = line.split("|").map((s) => s.trim());
          return { place, country };
        }),
        remote,
        exclusions: list(exclusions),
        interests: list(interests),
        sources,
        boards: list(boards).map((line) => {
          const [name, provider, slug] = line.split("|").map((s) => s.trim());
          return { name, provider, slug };
        }),
      });
      if (!result.success) return toast(result.error.issues[0].message);
      if (
        toastResult(
          await savePreferences({
            preferences: result.data,
            expected: view.revision,
            enabled,
            hour,
          }),
        ).ok
      ) {
        toast("Search Preferences saved.");
        router.refresh();
      }
    });
  return (
    <>
      <PageHeader
        title="Search Preferences"
        description="What you want next, separate from your career history."
        actions={<Link href="/digest">Daily digest →</Link>}
      />
      <div className="flex max-w-5xl flex-col gap-6 px-10 pb-20">
        <Card>
          <p className="text-sm text-muted">
            The daily digest uses the existing job agent schedule and scoring
            limit. It discovers and scores jobs; starting an application remains
            your choice.
          </p>
        </Card>
        {view.markdown && (
          <Card>
            <p>
              Edit <strong>Search Preferences.md</strong> in your configured
              notes directory or edit here. Changes synchronize automatically,
              with recovery copies and conflicts preserved.
            </p>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  toastResult(await reconcilePreferences({}));
                  router.refresh();
                })
              }
            >
              Sync Markdown now
            </Button>
          </Card>
        )}
        {view.error && (
          <p
            role="alert"
            className="rounded-card bg-warning-surface p-4 text-warning"
          >
            {view.error}
          </p>
        )}
        {view.conflict && (
          <Card>
            <h2 className="font-serif text-section">Review concurrent edits</h2>
            <div className="grid grid-cols-2 gap-4">
              {(["app", "file"] as const).map((choice) => (
                <div key={choice}>
                  <h3>{choice === "app" ? "Dossier" : "Markdown"}</h3>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">
                    {JSON.stringify(view.conflict![choice], null, 2)}
                  </pre>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        if (
                          toastResult(
                            await resolvePreferences({
                              choice,
                              expected: view.conflictToken!,
                            }),
                          ).ok
                        )
                          router.refresh();
                      })
                    }
                  >
                    Keep {choice === "app" ? "Dossier" : "Markdown"}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-col gap-6"
        >
          <Card className="flex flex-col gap-4">
            <label className="text-sm">
              Target roles (one per line, up to 4)
              <Textarea
                value={roles}
                onChange={(e) => setRoles(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Locations (City | country code, one per line, up to 3)
              <Textarea
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Remote preference
              <select
                className="ml-3 rounded border border-line p-2"
                value={remote}
                onChange={(e) => setRemote(e.target.value as typeof remote)}
              >
                <option value="any">Any arrangement</option>
                <option value="preferred">Prefer remote</option>
                <option value="only">Remote only (confirmed)</option>
                <option value="onsite">Non-remote only (confirmed)</option>
              </select>
            </label>
            <label className="text-sm">
              Exclusions (company names or phrases, one per line)
              <Textarea
                value={exclusions}
                onChange={(e) => setExclusions(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Interests (one per line)
              <Textarea
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
              />
            </label>
          </Card>
          <Card className="flex flex-col gap-4">
            <h2 className="font-serif text-section">Enabled sources</h2>
            {DIGEST_SOURCES.map((source) => (
              <label key={source} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={sources.includes(source)}
                  onChange={(e) =>
                    setSources(
                      e.target.checked
                        ? [...sources, source]
                        : sources.filter((s) => s !== source),
                    )
                  }
                />
                {SOURCE_INFO[source].name}
                <span className="text-muted">
                  {source === "JSEARCH" || source === "ADZUNA"
                    ? "Uses credentials in Settings → Job search"
                    : "Public API"}
                </span>
              </label>
            ))}
            <label className="text-sm">
              Company boards (Name | greenhouse, lever or ashby | board slug)
              <Textarea
                value={boards}
                onChange={(e) => setBoards(e.target.value)}
                placeholder="Example Company | greenhouse | verified-board-slug"
              />
            </label>
            <p className="text-xs text-muted">
              Use a slug from the employer’s official careers page. Up to 10
              boards; first page only. Arbeitnow and Daily Berlin Jobs cover
              Germany; location matching is textual.
            </p>
          </Card>
          <Card className="flex flex-col gap-4">
            <h2 className="font-serif text-section">Daily schedule</h2>
            <label className="flex gap-3 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enable daily digest
            </label>
            <label className="text-sm">
              Hour in your Dossier time zone
              <Input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
              />
            </label>
            <p className="text-xs text-muted">
              The app must be running. Uses Job agent’s time zone, daily limits,
              and maximum postings scored. Existing automatic draft settings do
              not apply to this digest.
            </p>
          </Card>
          <Button type="submit" disabled={pending || !!view.conflict}>
            {pending ? "Saving…" : "Save Search Preferences"}
          </Button>
        </form>
      </div>
    </>
  );
}
