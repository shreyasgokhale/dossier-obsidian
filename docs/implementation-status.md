# Implementation status

Specification: [implementation-spec.md](implementation-spec.md). Updated 2026-10-23.
Branch: `feature/configurable-markdown`; no push, merge or production deployment.
Starting upstream: `4fd532973be9ecbae43b55de5e0c3e681f07e493` (Dossier 1.8.1).

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
