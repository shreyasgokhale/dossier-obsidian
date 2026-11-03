# Implementation status

Specification: [implementation-spec.md](implementation-spec.md). Updated 2026-11-03.
Branch: `feat/daily-job-digest`; changes remain on the feature branch.
No merge or private-data deployment. Synthetic Nimbus deployment recorded below.
Starting upstream: `4fd532973be9ecbae43b55de5e0c3e681f07e493` (Dossier 1.8.1).

## Nimbus fresh deployment — 2026-11-02

Explicit fresh setup authorized on `feat/daily-job-digest` at feature revision
`6645580bf7efedb51270c5a6f0a8f6f1dd41b4cc`. Settings are in `vps.json`; operations
are documented in [vps-deployment.md](vps-deployment.md). Target:
`nim@192.168.8.219:/home/nim/services/dossier-obsidian`, Compose project
`nimbus-dossier-obsidian`, working directory `deployment`, Compose file
`deployment/compose.vps.yml`. The planned app URL is `http://192.168.8.219:3200`.

Strict SSH checking verified hostname `nimbus`, Docker 29.9.2 and Compose
v5.7.0. Preflight found 3447 MiB available RAM, 252 GiB free disk, no conflicting
project containers or volumes, and no listener on port 3200. Existing Immich
containers remain healthy and untouched.

After an initial missing-environment validation failure, the user explicitly
authorized creating fresh configuration. Random database and login passwords,
an Argon2 login hash and a stable app secret were generated directly on Nimbus.
The remote `.env` and `login-password` files have owner-only permissions and
were not printed or downloaded. Compose validation now passes. Added nested
credential exclusions to `.dockerignore`; credentials are not source inputs.

Uploaded an inspected allowlist of 858 source/configuration files, excluding
private data, environments, Git metadata and dependency/build output. A source
manifest is retained locally at `work/vps/source-manifest.json`. Runtime uses
named volumes seeded from synthetic fixtures, a read-only resume mount and the
fake AI provider. No firewall changes, VM operations, merge or publication.

Fresh verification completed on Nimbus (2026-11-03): Node 24.19.0 / Yarn
4.18.1, Corepack, immutable install, Prisma generation, lint, typecheck and
production build passed. Node's default 1 GiB heap exhausted during the first
typecheck; explicitly allowing a 1536 MiB heap inside the unchanged 2 GiB
container limit resolved it. The Compose checks profile records that setting.

Full unit/database suite: 221 files passed, 4 skipped; 1802 tests passed,
29 optional tests skipped. Coverage passed unchanged thresholds: statements
86.27%, branches 80.05%, functions 84.79%, lines 88.45%. Unit database tests used
`dossier_test`; browser tests used their separate `_e2e` database.

Browser suite: 138 passed and 1 failed in 11.8 minutes. The failure repeated on
its configured retry: `e2e/applications.spec.ts:30`, "moves a card from the
keyboard", expects the first status menu radio item to have focus at line 35,
but it remains inactive. Route generation and production compilation passed;
this was a browser assertion failure, not an out-of-memory container exit.
Diagnostics remain in the checks container under `/tmp/vps-checks`, with browser
traces/error contexts under `/app/test-results`.

The user subsequently explicitly authorized starting the app despite the known
browser failure. A standard production-image build stopped at immutable Yarn
checksum mismatches for `@prisma/streams-local@0.1.11` and
`@anthropic-ai/sdk@1.3.0`. Integrity checks and the lockfile were preserved.
Instead, `deployment/Dockerfile.vps-runtime` packaged the successful production
standalone output, static assets and public files from the checks container,
using the existing verified checks image as its base, with build networking
disabled. Only those artifacts entered the build context; filename-only
inspection found no environment or login credential files. This runtime retains
the larger tooling image until a normal slim runtime can be rebuilt.

Runtime image: `nimbus-dossier-obsidian:6645580bf7ef`, manifest list digest
`sha256:f51aa48e6bda5b183c8a054449813a039fd34de1986a1e1b2e710c73e71f668d`.
Compose validation and `up -d --wait --wait-timeout 120 app` passed. App,
PostgreSQL and fake AI are healthy; the fixture initializer completed
successfully. From the client LAN, both `/api/health` and `/login` returned HTTP
200 at **http://192.168.8.219:3200**. The port binds only to Nimbus's LAN IP.
Verified persistent app-data/notes mounts are writable and resume is read-only.
The remote environment and login password files retain mode 0600. Immich's four
containers remain healthy and unchanged. The idle checks container is retained
with its diagnostics. No secrets were printed or downloaded; no private data,
firewall or VM changes, merge or publication occurred.

Next concrete step: fix the reproducible keyboard-focus failure and verify the
registry checksum discrepancy before replacing this runtime with the standard
production image. Preserve the existing remote credentials and named volumes.
The short cloud-agent brief is [cloud-handoff.md](cloud-handoff.md); committed
`vps.json` and [vps-deployment.md](vps-deployment.md) retain local deployment
settings and the verified runtime snapshot without credential values.

## Container-only review — 2026-10-23

Fresh verification on the feature branch used only synthetic fixtures and fake AI.
No Obsidian process, private vault, real credentials or external provider was used.

| Check | Result |
|---|---|
| Node / Yarn | 24.19.0 / 4.18.1; Corepack enabled; immutable install and Prisma generation passed |
| Lint / typecheck / production build | Passed inside Docker |
| Full tests with unchanged coverage thresholds | 1,552 passed; 26 pre-existing optional live tests skipped; 189 passed files, 4 skipped |
| Coverage | Statements 87.20%, branches 81.22%, functions 86.00%, lines 89.46%; all thresholds passed |
| Upstream browser suite | All 123 passed in one run (2.4m) |
| Complete Markdown workflow in review container | Passed (45.6s scenario / 47.5s total) |
| Same complete workflow against production image | Passed (47.6s scenario / 48.0s total) |
| Real process restart recovery | Two restarts passed; independent edits merged; interrupted input retained and retryable; record counts unchanged |
| Committed fixtures | Checksums unchanged after all checks |
| Final preview after network correction | Login, dashboard, connected Markdown settings, generated document and valid PDF passed |
| Isolation | Only named volumes; no host binds/socket or host namespaces; non-root workloads, zero capabilities and no privilege escalation; host/LAN/internet probes blocked |
| Production source protection | Resume source writes fail with EROFS; app root filesystem read only |

Production image: `dossier-isolated-demo:local`, Linux arm64, image ID
`sha256:3ef8179d2bb080f8f08c9315675b0b617f25905f9bc2e8ef316f0007f6980dde`.
Base revision: `3dc5d79709162984432c56e06a2feae815885145` plus the review harness.
The image's recorded source SHA256 is
`62aea59012e2734923979efd6ba20d55cbc9d1152e99806da575c72259fc7dcd`;
the full allowlist/checksum manifest is in `work/isolated-review`.
The review runner was image `sha256:5e29fe9346c845aeeda5fbb93d574d10b14cf16b430a04ea7af1e4d6df7fb419`.
Host-side source-packager/inspection refinements are included in the review tooling.

The first fully internal Docker network suppressed localhost port publication.
The final configuration uses a bridge with IPv4/IPv6 outbound-deny firewall rules.
The trusted bootstrap drops root and all capabilities; only loopback service
connections and replies to inbound preview requests are permitted. Final host
HTTP, browser, capability, mount and outbound-connectivity checks passed after
recreating the network. Only `127.0.0.1:3200` is published.

Eight fresh production screenshots are in [screenshots/isolated-review](screenshots/isolated-review).
Detailed logs, final isolation inspections, firewall rules, image metadata,
fixture hashes and a synthetic PDF are in ignored `work/isolated-review`.
Reproduction and project-scoped cleanup commands are in
[markdown-runbook.md](markdown-runbook.md#container-only-synthetic-review).

The synthetic demo remains at **http://localhost:3200**, password **e2e-password**.
Next concrete step: review the screens and try adopting `frontmatter/try-it.md`
or `labeled/try-it.md` in Settings → Markdown integration. These are writable
fixture copies in Docker storage. Real-model quality and real Obsidian integration
remain outside this review. No merge, publication or private deployment occurred.

## Milestones and acceptance checklist

- [x] M1 Runnable preserved fork: upstream history/license/UI retained, synthetic fixtures, fake AI, pinned tools and isolated native/production demo.
- [x] M2 Format configuration: both representations, configurable names/labels/status aliases/dates, versioned JSON/schema, templates, actionable errors, exact previews and reviewed profile activation.
- [x] M3 Adoption/synchronization: adoption in place, durable outbox, startup/watch/15s reconciliation, independent merges, persisted conflicts and UI resolution, stale guards, rename/unlink/duplicate/root/symlink checks, document repair and Obsidian exports.
- [ ] M4 Resume/AI: all implemented workflows verified with synthetic sources/fake AI, including browser disconnect and real process restart. The separate real pretrained-model inference acceptance test remains externally blocked by model-download HTTP 403 responses.
- [x] M5 Packaging/maintenance: production image built and browser-tested, LiveSync tested with disposable CouchDB, Compose/runbook/backup/upgrade/upstream-merge procedures and CI definitions supplied. Private deployment is a later validation step.

## Decisions and preserved behavior

PostgreSQL remains the operational store. Integration is concentrated in
src/lib/markdown with limited shared status/document/job hooks. Database triggers
persist outbound work with existing application/note/document/chat mutations.
The parser uses no AI. Targeted scalar/section edits preserve unknown YAML,
comments, formatting, tasks and wikilinks. Full bodies are associated notes by
default; explicit heading mappings limit writes. Profile changes pause sync until
the exact affected-file dry run is confirmed.

Application date is explicit and separate from native sentAt, preserving upstream
transition timestamps. Imported statuses and document edits use the shared domain
writers. Independent edits merge; conflicts retain both versions and need review.
Missing files unlink rather than delete records. Stable IDs reconnect renames.

Adoption intent commits before writing its ID so startup can finish it. PostgreSQL
and filesystem changes cannot share a transaction: writes use stale-read guards,
atomic replacement, recovery copies and durable retry work. Recovery stays outside
synchronized content. New notes/directories support a shared LiveSync group;
existing file modes survive. Operate one app instance per notes mount.

Career imports are deterministic/read-only, idempotent, retain language variants
and report removals without deleting manual profile content. AI attempts capture
one provider/model/profile context without persisting API keys. Mutation checkpoints
commit with document writes. Accepted applications retain attempt provenance after
job cleanup, including in JSON backups. Saved drafts retain posting URLs/source IDs.

JSON backup schema 5 restores records and integration mappings/snapshots/conflicts/
work/resume provenance while accepting schemas 1–4. Upstream job/credential export
policy remains; full pg_dump includes jobs. Delete everything also clears integration
snapshots/custom profiles/work and managed recovery copies, preserving external
notes and career source files. Its confirmation explains that boundary.

The production image normalizes packaged read permissions and entrypoint execution,
so restrictive checkout permissions do not prevent its non-root startup. Image E2E
uses Linux host networking for loopback-only synthetic PostgreSQL/fake services.
Production Compose uses its ordinary app/database network. Playwright uses
graceful shutdown to remove its disposable container; final teardown was verified.

## Validation results

| Check | Verified result |
|---|---|
| Exact unmodified upstream baseline | 1,490 passed, 26 optional skips, one 5,000 ms timeout at src/lib/google/google.db.test.ts:125 |
| Unchanged upstream inbox retry | All 4 passed (4.57s); no timeout change |
| Fork lint / typecheck | Passed; final delivery rerun includes the image harness |
| Full fork suite with original coverage thresholds | 1,552 passed, 26 optional live tests skipped; 189 passed files, 4 skipped |
| Coverage | Statements 87.22%, branches 81.22%, functions 86.03%, lines 89.47%; all global/library/AI thresholds passed |
| Focused durability / backup | 44 passed |
| Final cleanup / export regression | 9 passed after the full-suite run; then lint/typecheck/build passed |
| Native production build | Passed |
| Native complete Markdown browser workflow | Passed (1.3m), including adoption, conflicts, profile review, resume import, closed-tab AI retry, refinement, PDF, retained provenance and rename |
| Upstream browser cases | All 123 distinct cases verified across runs: 117 initially, 5 additional consent/backup cases, 1 additional history case; setup repeats excluded from the total |
| Actual restart recovery | Two real process restarts passed; independent edits merged, unfinished input retained, interrupted job retryable; unchanged counts: 9 applications, 9 notes, 19 events, 0 document versions |
| LiveSync real CouchDB integration | All 6 passed, pinned bridge and disposable encrypted/recovery/filesystem cases |
| Combined app / LiveSync Compose configuration | Passed config validation with synthetic values |
| Production Docker build | Passed without app credentials/private .env files |
| Non-root image sanity | Entrypoint/config readable, entrypoint executable, private environment files absent |
| Same complete workflow against production image | Passed (58.9s scenario / 1.6m including graceful teardown), including packaged migrations, seed, server and Chromium PDF renderer |
| Synthetic demo | Launched with healthy login/app; resume and actual restart verifier passed |

No tests, timeouts or coverage thresholds were disabled or reduced. The initial
full upstream browser attempt was interrupted after a local `.env` forced telemetry
off, hiding the consent dialog required by two cases. Explicit test configuration
now leaves consent unset and routes pings to the fake service. The data/consent
rerun passed 6 cases including setup; the history rerun passed 2 including setup.
This is evidence across runs, not a claim of a single green aggregate browser run.

An earlier concurrent build exhausted the 32GB vfs filesystem and produced unrelated
failures. Those runs are not final evidence. Heavy checks were subsequently run
sequentially and disposable build caches cleared. The coverage provider's existing
fonts/README non-code warning and pg query deprecation warning remain visible.

Tested local image: `dossier-markdown:review`, runtime revision
`6eb45ffecb34b2d6a0f0498dd909c60050aaaddc`, image ID
`sha256:2e268efdb67f863eada1ea4921a52c621cfabdc3f6e763f1dececca0d1427c0b`.
The Linux test-harness networking adjustment is a subsequent host-side tooling
change; the image above is the exact image that passed the browser workflow.
Five screenshots in docs/screenshots were captured against that image.

Authoritative ignored work/ logs: upstream-baseline.log,
upstream-google-retry.log, final-coverage-verified.log, provenance-focused.log,
cleanup-focused.log, cleanup-build.log, upstream-browser-retry.log,
browser-versions-final.log, markdown-browser-final.log, restart-final.log,
livesync-test.log, app-image-final.log, app-image-labeled.log,
image-sanity.log and browser-image-cleanup.log. Delivery includes copies of key evidence.

## Acceptance evidence map

| Acceptance criterion | Evidence |
|---|---|
| Fresh build/launch without private sources | Secretless production image build, container browser workflow, isolated demo |
| Both formats and configurable property/label names | Settings browser workflow; format.test.ts configured names/labels/aliases/dates |
| Adoption and confirmed empty fills preserve content/path | Browser byte comparison before confirm; integration.db.test.ts adoption/stale preview cases |
| Bidirectional status/follow-up changes | Browser round trip; database labeled follow-up/status-history cases |
| Unknown properties/formatting/tasks/wikilinks survive | format.test.ts span/CRLF/comment cases; repeated database reconciliation |
| Valid templates and selected defaults | Format validation; database new/default profile template cases |
| Profile dry run before mutation | Browser staged rename; database stale token and section-rebinding cases |
| Invalid YAML/labels/statuses/dates yield errors | Format invalid-value cases; database malformed YAML recovery |
| Conflicts preserve versions and resolve in UI | Browser body conflict; database field/body/document conflict/stale guards |
| Rename/delete/marker/mount recovery | Database rename/duplicate/delete/restore, retry and repair; browser rename |
| Idempotency and restart recovery | Database sync/version assertions; real restart verifier; jobs/runner.db.test.ts committed checkpoint replay |
| Resume idempotency and variants | Career import/rename/removal database cases; reviewed browser import |
| AI progress/failure/retry/disconnect | Browser fake failure and closed-tab completion; runner/checkpoint/provenance cases |
| Real local-model inference | BLOCKED: model downloads return HTTP 403; host smoke command in runbook |
| Backup restoration | Schema-5 database round trip and reconciliation; older upstream schemas retained |
| Visual design | Upstream browser/accessibility cases and five synthetic screenshots |
| Maintenance and upgrades | Runbook, additive migrations, AGENTS.md and pinned CI/image tooling |

Unprefixed test files above are under src/lib/markdown.

## Remaining limitations and continuation checkpoint

All independent implementation, synthetic verification and packaging work is
complete. Real pretrained-model inference remains unverified: both the Ollama
registry retry and an alternate public model source returned HTTP 403. Fake AI
checks establish workflow behavior, not real inference or model quality.

Actual private vault/website inputs, production HTTPS and Proxmox are intentionally
not accessed or deployed. Full pg_dump/pg_restore and production upgrade commands
are operator instructions; the verified restore here is the schema-5 JSON round
trip. GitHub Actions definitions are supplied but remote CI was not triggered.

Next concrete step on a host with model access: follow docs/markdown-runbook.md,
configure Ollama and an explicit model, then run its AI_LIVE=ollama smoke command
and record the result. After that, validate a restored disposable deployment on the
user's Linux VM/HTTPS setup before any private-data migration. No merge or deployment
has been performed. The branch and delivery artifacts preserve the implementation
and all reviewable commits for that continuation.

### PR #1 rebase onto Dossier 1.10.0 — 2026-10-30

Rebased all 14 feature commits onto main at a1ab921. Conflict resolutions retain
upstream dependency versions, Claude handoff, Startups, publications/profile photo,
and export schema version 6, alongside Markdown integration and durable recovery.
Settings navigation and reset tests cover both sets of features; the integration
export assertion now expects version 6.

Validation on the rebased branch: immutable Yarn install, Prisma generation,
lint, typecheck, and production build pass. Full Vitest run with one worker:
1,771 passed, 29 skipped (213 files passed, 4 skipped). Playwright against fake
services and a separate dossier_e2e database: all 138 passed. Database tests used
only dossier_test. No private vaults, external AI, merge, or deployment used.
Next step: review and merge PR #1 after GitHub CI completes.

### PR #1 Codex review fixes

Document synchronization now locks each Document row and rereads its current units
before computing the three-way merge. The lock remains held through the domain
writer, file update and snapshot update, preserving app/AI edits committed after
the initial scan. Conflict resolution uses the active profile configuration even
while a draft pauses reconciliation, allowing existing conflicts to be cleared
before reviewing and activating the draft.

Two PostgreSQL/filesystem regression tests reproduce the reported failures: an
app edit committed between the initial scan and merge, and an existing conflict
resolved while a property-renaming draft is paused. Both fail against the prior
implementation and pass with these fixes. All 18 Markdown integration tests,
immutable Yarn install, Prisma generation, lint, typecheck and production build
pass. Full Vitest validation: 1,773 passed, 29 skipped (213 files passed,
4 skipped). All 138 standard Playwright tests and the complete synthetic
Markdown/resume/AI browser workflow pass. Tests use synthetic fixtures, fake
services and disposable dossier_codex_test, dossier_codex_e2e and
dossier_markdown_e2e databases.

Next step: inspect GitHub CI on the updated PR #1. No merge or deployment
performed.

## Daily job digest — implementation and review handoff

The newest work is on `feat/daily-job-digest`, based on `main` after checkout and
successful `git pull --ff-only` at `23b9062` (Feature/configurable markdown #1).
Implementation commit: `07c762c`. The initial implementation remained local; the
feature branch was subsequently pushed to GitHub with user approval for review.
No merge or app deployment was performed. The initial sandbox
connection failure was resolved using the permitted execution path; pulling is
not an outstanding blocker. AGENTS.md and the existing search/agent/profile,
Markdown filesystem/merge worker, application and export workflows were inspected
before implementation.

Implemented:

- Search Preferences in Dossier and `Search Preferences.md`, separate from
  career history. Roles, city/country pairs, remote intent, exclusions, interests,
  enabled sources and configurable employer boards have deterministic schemas.
  Synchronization reuses guarded paths, atomic writes/recovery and the existing
  advisory lock; durable snapshots/errors/conflicts preserve concurrent versions.
- Multi-source discovery through existing JSearch, Adzuna and FreeHire adapters,
  plus Arbeitnow, Daily Berlin Jobs and configured Greenhouse/Lever/Ashby boards.
  Source/board failures and individual scoring failures preserve successful
  results. Connection testing makes real board requests; no configured board is
  reported connected without an HTTP check. BA remains interactive only, as
  upstream explicitly requires.
- Durable daily digests, discovery snapshots, profile-based fit reasons, missing
  information/gaps, strong matches and at most three best stretch roles. The
  existing agent job runner, timer, time zone, scoring cap and run limits are used.
  Interrupted runs recover at startup. Digest discovery never enqueues drafts.
- Canonical URL and normalized company/title identity suppression across sources,
  saved/dismissed results and pursued applications. Dismissal/save use existing
  Dossier storage. Start application enters the existing review/create workflow;
  per-job Markdown starts only when an application exists.
- Backup schema 7 includes digests, membership, discovery snapshots and identity/
  preferences sync state; schemas 1–6 remain importable. Delete everything removes
  the added state. The upstream transient score cache remains excluded, while
  digest scores/reasons survive restore.
- `yarn demo:digest --production` creates a new isolated synthetic database and
  writable notes runtime, starts fake AI/source services, and populates four
  strong matches plus a stretch role. Demo labels are visible in the digest and
  history. The same vacancy from Arbeitnow/DBJ appears once; a simulated failed
  Lever board leaves the other results intact. Existing upstream UI is retained.

The reference repository was inspected at
`umutyesildal/berlin-job-search@465f9ffd0c03cde62f898260d919c011c3c1d043`.
Actual connector functions and API contracts were distinguished from browser
recipes/search links. The MIT notice for endpoint/parser adaptation is retained
in `docs/third-party/berlin-job-search-LICENSE`. No newsletter, automatic application,
reference coaching workflow or document drafting was imported.

### Verification evidence

Node **24.19.0**, Yarn **4.18.1** (cached executable SHA-512 matches packageManager).
Corepack enable was run using a workspace-writable install directory because the
system binary directory is not writable. Immutable installation and Prisma Client
generation passed. Additive migrations apply to empty disposable databases.

- `yarn install --immutable`: passed; lockfile unchanged (existing peer warnings).
- `yarn prisma generate`: passed, Prisma Client 7.10.1.
- `yarn lint`: passed with no warnings.
- `yarn typecheck`: passed, including generated Next.js route types.
- `yarn test`: 1,799 passed / 29 opt-in-live tests skipped on the earlier full run.
- Latest full `yarn test:coverage --maxWorkers=2`: **1,802 passed / 29 skipped**
  (221 files passed / 4 skipped). All existing coverage thresholds are unchanged
  and pass: global lines 88.45%, statements 86.27%, functions 84.79%, branches
  80.05%; `src/lib` lines 95.15% (minimum 94%). A tooling warning skips the
  non-code bundled-font README during coverage; the command exits successfully.
- `yarn build`: passed, standalone Next.js production bundle.
- `yarn test:e2e`: first full run 136 passed / 3 failed. The failures were in
  existing keyboard-focus and publication-autosave tests (plus the dependent
  publication test). Their files were not changed. Isolated rerun of both whole
  files plus the digest flow: **9 passed**. Final full rerun on the stable production bundle: **139 passed** (5.3 minutes), including all original workflows and the new digest flow.
- `yarn test:e2e:markdown`: **1 passed**, complete synthetic Markdown/resume/AI workflow.
- `git diff --check`: passed.

The isolated preview was verified with real Chromium and axe on both new screens:
no accessibility violations and no browser errors. Five digest items were created
while the nine seeded applications and nine associated Markdown notes remained
nine, and there were zero automatic draft jobs. Screenshots are retained at
`docs/screenshots/digest/daily-digest.png` and
`docs/screenshots/digest/search-preferences.png`.

The following URL is **cloud-workspace-local**, not accessible through a
reviewer's computer's localhost:
`http://localhost:3200/digest?id=cmvvlqj13000166plpo3aem08`, password **demo-password**.
This environment exposes no browser port-forwarding capability. The original chat
handoff incorrectly presented this as a directly usable review link. For
interactive review on your own computer, obtain `feat/daily-job-digest` and follow
the local setup commands in `docs/daily-job-digest.md`.
An earlier review-branch push was blocked pending explicit publishing permission;
that rejected command did not execute. On 1 November 2026, the user approved
publishing the review branch. `feat/daily-job-digest` was then successfully pushed
to `shreyasgokhale/dossier-obsidian`. The source and synthetic screenshots are
available on GitHub; the app remains undeployed. Review the [feature branch](https://github.com/shreyasgokhale/dossier-obsidian/tree/feat/daily-job-digest)
and [digest screenshot](https://github.com/shreyasgokhale/dossier-obsidian/blob/feat/daily-job-digest/docs/screenshots/digest/daily-digest.png).
The query pins the populated initial digest even if a later scheduled scan finds
no new jobs. The preview remains running locally on port 3200 with fake AI on
3996 and fake job sources on 3995. Runtime: `/tmp/dossier-demo-TfHREk`;
database: `dossier_demo_a6f25ab63ba6`. Recreate a fresh isolated preview with
`cd /workspace/dossier-obsidian && yarn demo:digest --production` after stopping
the running preview. The complete build/setup command sequence is in the runbook.

Both new screens also passed axe in dark mode. The running filesystem worker
imported a synthetic preference-note edit, restored its original value, and left
career history unchanged. Sanitized evidence is committed in
`docs/evidence/daily-digest-preview.json` and live probe outcomes in
`docs/evidence/daily-digest-source-probes.txt`.

Exact source audit, feature behavior, limitations, reproduction and step-by-step
review instructions are in `docs/daily-job-digest.md`. Raw command logs are in the
ignored `work/` directory in this workspace.

### Remaining limits and next concrete step

Live probes to Arbeitnow, Daily Berlin Jobs, Greenhouse, Lever and Ashby all
returned proxy CONNECT **403**, HTTP **000**. The managed outbound policy does
not allow these hosts. These are **fixture-verified implementations**, not claims
of successful live data retrieval; no real-source digest was generated. No bypass
was attempted. JSearch/Adzuna also need the user's own configured credentials.

Scanning is bounded to first pages (Arbeitnow one page, DBJ up to 500 rows,
Lever up to 100; up to 10 employer boards and 12 role/location queries per source).
DBJ detail hydration and additional reference ATS types are not implemented.
Company boards must be configured from verified official board slugs. Locations
are textual, with no distance/geocoding or inferred work eligibility. Dedupe
conservatively treats one company/title across locations as one opportunity.
The app must remain running as one instance for daily scheduling.

Next concrete step: review the populated synthetic preview and feature-branch
diff, then allow the public API hosts via the supported environment configuration
and verify low-volume real requests with official employer slugs and any desired
paid-source keys. Do not merge or deploy as part of this task.
