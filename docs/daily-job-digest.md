# Daily job digest

Search Preferences describes search intent, independently of Profile and the read-only career collection. Open **Daily digest → Search Preferences**, enter up to four roles and three city/country pairs, select sources, and enable the daily schedule. `preferred` remote work influences scoring; `only` and `onsite` (non-remote) require an explicit source flag. A false remote flag is displayed as Not remote, rather than assuming on-site attendance. Exclusions match phrases in company, title and description. Interests are supplied to the scorer as intent, never evidence of experience.

The digest uses the existing `agent-scan` background job and daily timer, hour/time zone, scoring cap and run limits (three runs per 24 hours; manual runs at least one hour apart). One server process must remain running. Configuring preferences switches subsequent agent scans to digest discovery. The legacy agent workflow remains available when preferences have never been configured; its previous candidates/drafts are preserved. Digest candidates are reviewed in Daily digest, separately from the legacy Agent queue. Automatic drafting settings do not apply to digest scans.

Each enabled source is queried independently. Successful results survive failures of other sources, boards or individual scores. Source status and each run are durable, independent of background-job retention. New discoveries are stored in `DailyDigest.discovered`; scored results use the existing `AgentCandidate` records with digest membership. Results beyond the scoring cap are retained in the discovery snapshot and may be scored on later runs. There is no automatic email, application submission or document generation.

Strong matches use the agent's configured minimum score (70 by default). Up to three best scores below that threshold, and at least `max(50, minimum - 20)`, are marked stretch roles. Other scored roles remain available under Lower matches. Reasons and gaps come from the existing profile scorer. Missing salary, unknown work arrangement and partial descriptions are explicitly marked. Scores are provisional assessments, not verified employer requirements.

Canonical links ignore tracking parameters; a second identity normalizes company/title, accents and common gender suffixes. All locations of the same role at one employer are deliberately treated as one opportunity. This conservative deduplication may combine genuinely different vacancies. Saved/dismissed postings, existing agent candidates and already pursued applications suppress later results, including cross-source aliases. Dismissing in the digest reuses the existing agent dismissal and posting storage. Saving uses Find jobs' Saved view. Start application uses the existing posting → New application → Create application path. Discovery and saving never create per-job Markdown files. After the user creates an application, normal Markdown/application workflows apply.

## Markdown preferences

With the existing `DOSSIER_NOTES_ROOT` and `DOSSIER_DATA_DIR` configured, the worker synchronizes **Search Preferences.md** at the notes root. This file is separate from `DOSSIER_RESUME_ROOT`. No new environment variable or private vault is required. Without a notes root, the Dossier editor works independently.

```yaml
---
roles:
  - Product Designer
locations:
  - place: Berlin
    country: de
remote: preferred
exclusions:
  - Recruitment agency
interests:
  - Climate technology
sources:
  - ARBEITNOW
  - DAILY_BERLIN
  - COMPANY_BOARDS
boards:
  - name: Your chosen employer
    provider: greenhouse
    slug: verified-board-slug
---
# Search Preferences

Keep personal planning notes here; Dossier preserves this body.
```

Use an actual board slug from the employer's official careers page. Supported providers are `greenhouse`, `lever` and `ashby`. Countries are lowercase ISO alpha-2 codes. Metadata is parsed by YAML/Zod without AI. Unknown frontmatter keys, comments and body text are retained. The worker checks at startup, on file changes, and every 15 seconds. **Sync Markdown now** retries immediately.

Synchronization reuses the integration advisory lock, guarded filesystem access, atomic writes and recovery copies. Dossier settings persist pending outbound edits before filesystem work. `SearchPreferenceSync` stores the last common snapshot, errors and both versions of conflicts. Concurrent changes to the whole preference document require review: choose Keep Dossier or Keep Markdown. Refresh synchronization if either version changes again. Missing or malformed notes are reported and preserved; restore/fix them to resume. Conflicts block new digest discovery until resolved. UI saves carry a revision and refuse stale edits. Schedule settings remain in Dossier's existing agent settings rather than the preference Markdown metadata.

Exports/backups use schema version 7 and include preferences, discovery snapshots, digest history/membership, candidate identity hashes and preference sync/conflict state. Import remains backward compatible with schemas 1–6. The upstream transient posting score cache remains omitted; persisted digest scores and explanations survive restore. Delete everything also removes digest/sync state.

## Source audit and limits

Inspected `umutyesildal/berlin-job-search` at commit `465f9ffd0c03cde62f898260d919c011c3c1d043`, particularly `skills/berlin-job-search/scripts/search.py`, `_common.py`, `references/api-sources.md`, `references/browser-search.md` and `assets/companies.json`. Its HTTP parsers and endpoint contracts are real data connectors; browser search links and coaching recipes are separate. Endpoint/filter mapping informed the new TypeScript adapters. The reference MIT notice is retained in [third-party/berlin-job-search-LICENSE](third-party/berlin-job-search-LICENSE); Dossier retains its AGPL license and history.

| Source | Implementation | Practical limits and verification |
| --- | --- | --- |
| Arbeitnow | Public `/api/job-board-api?page=1`, HTML normalized, local role/location/remote/date filtering | Germany; API `search`/`location` parameters are not trusted. One feed page. Fixture verified; live requests blocked by this environment's outbound policy. |
| Daily Berlin Jobs | Public `/api/v1/jobs`, longest role token in `q`, local full-role/location filtering | Berlin/Germany only; list page capped at 500. No detail hydration in this increment: missing descriptions/language requirements remain unknown. Fixture verified; live policy blocked. |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | Explicitly configured employer boards only; no automatic company catalog import. Fixture verified; live policy blocked. |
| Lever | `api.lever.co/v0/postings/{slug}?mode=json&limit=100` | First 100 postings; EU-hosted Lever boards are not supported. Each board failure is isolated. Fixture verified; live policy blocked. |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | Explicit board configuration; compensation is currently left unknown. Fixture verified; live policy blocked. |
| JSearch / Adzuna / FreeHire | Existing Dossier adapters and credential configuration reused | Existing quotas, attribution and source coverage preserved. Missing credentials affect only that source. Adzuna attribution component is reused on digest cards. No hosted credentials supplied here. |
| Bundesagentur für Arbeit | Existing interactive Dossier workflow retained | Excluded from automated digests, preserving upstream's explicit prohibition on agent access. |
| Reference's other ATS types | Inspected reference support for Personio, SmartRecruiters, Recruitee and Workable | Not implemented in this increment. JOIN's API was documented as unavailable in the reference; no speculative connector added. |
| LinkedIn guest, browser recipes, HiringCafe and search links | Not imported as integrations | No scraping, logged-in automation or browser recipe is presented as a working data feed. Existing JSearch results may still contain LinkedIn postings through Dossier's supported adapter. |

At most 12 role/location queries per non-board source and 10 configured boards per scan. Public feeds and company boards have no radius semantics. Local matching is textual, with no geocoding or inferred work eligibility. Pagination beyond the first page is intentionally bounded out; a digest is a selection, not exhaustive market coverage. Existing sources retain their own filtering behavior.

All five new public service hosts returned proxy CONNECT 403 (HTTP 000) in this managed environment. This is an outbound policy block, not evidence that those services are down. No policy bypass was attempted. The next live integration step is to allow the listed hosts through the supported environment configuration, rerun low-volume source probes with verified company slugs, and compare real schemas with the offline contracts. JSearch/Adzuna additionally require the user's own configured keys.

## Reproducible synthetic local preview

Use Node 24.19.0, Yarn 4.18.1 and a local PostgreSQL server accessible to `DEMO_DATABASE_SERVER` (defaults to `postgresql://postgres:postgres@127.0.0.1:5432/postgres`). The database role needs CREATE DATABASE for this isolated demo.

```bash
yarn install --immutable
yarn prisma generate
yarn build
yarn demo:digest --production
```

Open <http://localhost:3200/digest>, sign in with **demo-password**, and allow the startup scan a few seconds to finish. The preview creates a new `dossier_demo_<random>` database and `/tmp/dossier-demo-<random>` runtime each time. It never points the demo at the inherited application database. The log prints the exact runtime/database. The runtime is retained on exit for inspection; committed fixtures remain untouched. `DEMO_PORT`, `DEMO_AI_PORT` and `DEMO_JOBS_PORT` override 3200, 3996 and 3995 if occupied.

The fake AI and fake source APIs populate **four strong matches and one stretch role**, deduplicate the same Spree Tools vacancy from Arbeitnow and Daily Berlin Jobs, and simulate one failed Lever board while preserving four successful feeds/boards. Digest history and the screen label this **DEMO — synthetic results**; employers and links are made up (`jobs.example`). This makes no claim to live source availability.

Review:

1. Expand Source status and confirm the failed synthetic board alongside successful sources.
2. Inspect reasons, unknown salary/work mode and the clearly separate stretch section.
3. Save a role, open Find jobs → Saved, then dismiss a digest role and reload. Both actions persist without creating an application or per-job note.
4. Start application on another role. Review the populated posting in the existing flow; an application and normal Markdown records are created only after Create application.
5. Open Search Preferences and edit interests; inspect `<runtime>/notes/Search Preferences.md`. Edit that note externally, sync or wait 15 seconds, then reload the editor. Career history is unchanged. Concurrent edits produce a reviewable conflict.
6. Run now again after the existing one-hour cooldown, or review the automated test evidence for repeat-run suppression. The demo's startup run counts against normal limits; it is not given a special bypass.

`runtime.json` contains safe runtime selectors; `runtime.env.json` contains isolated demo runtime credentials and must remain local. Stop with Ctrl-C. To repeat from a fresh state, run the same preview command after stopping the previous process; no reset flag is needed. To remove a preview, drop only its printed `dossier_demo_<random>` database and remove only its printed temporary directory.

Verification commands follow AGENTS.md: lint, typecheck, test, production build and Playwright e2e. Focused coverage includes source isolation, duplicate suppression, scoring limits/failures, no automatic applications/drafts/Markdown, backup restore, preferences conflicts and the complete synthetic browser flow. See [implementation-status.md](implementation-status.md) for actual run results and retained evidence.
