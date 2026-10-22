# Implementation status

Specification: docs/implementation-spec.md. Started 2026-10-23.
Branch: feature/configurable-markdown.
Upstream starting commit: 4fd532973be9ecbae43b55de5e0c3e681f07e493 (Dossier 1.8.1).

## Milestones and acceptance checklist

- [x] M1 Runnable preserved upstream and isolated demo: fresh checkout, pinned tooling, fake AI, synthetic notes/resume, baseline lint/types/tests/build.
- [x] M2 Configurable profiles: both representations, mapped names/status/date formats, literal templates, actionable parse errors, exact diffs, Settings editor and dry-run activation.
- [x] M3 Adoption and synchronization: confirm preview, preserve bytes outside mappings, transactional outbox, startup/watch/15s reconcile, three-way merge, conflict UI, rename/unlink/duplicate and root safety, restart recovery, document markers, Obsidian exports.
- [ ] M4 Resume and AI/document workflow: deterministic read-only importer, language variants and idempotency/removal review, fake progress/failure/retry/disconnect, draft provenance, local inference smoke test.
- [ ] M5 Packaging and maintenance: optional pinned LiveSync tested with disposable data, Compose/native runbook, auth/health/logs, backup/restore including mappings, upstream/upgrade instructions, screenshots and PR description.

## Architecture decisions

PostgreSQL remains authoritative for operations. Integration is a focused optional module.
Use persisted normalized snapshots for three-way comparisons, content hashes for stale
preview checks, and a transactional outbox for filesystem retries. All paths are
relative to runtime roots; sources and synthetic fixtures remain separate.
No private infrastructure is available; actual Proxmox/HTTPS/private vault deployment
will be documented as unverified.

## Baseline

Clean checkout; no repository AGENTS.md was present. Environment has Node 24.19.0,
preinstalled dependencies and managed PostgreSQL tooling. Yarn is provided by
`source /workspace/.setup/activate.sh` in this environment (not on initial PATH).
After generating Prisma, starting the managed PostgreSQL container and creating disposable test databases, the broad run passed 1,490 tests with 26 optional live tests skipped. One navigation assertion failed because this implementation adds the requested Markdown Settings section; its expected list has been updated. Initial failures were environment setup (Yarn PATH, Prisma generation, database startup), not verified upstream defects. Initial build launched without network permission stalled; it was terminated and rerun with the environment network grant. Logs are in ignored work/.

## Verified implementation (2026-10-23)

- Profile schema and frontmatter/labeled parsers, targeted writers and three-way merge: 22 tests pass.
- Settings editor, JSON import/export, template/sample preview, staged dry-run activation and adoption confirmation are implemented. Browser verification is pending.
- Real PostgreSQL/filesystem integration: 11 tests pass (33 integration-module tests total): both formats, preservation, bidirectional follow-up/status/body edits, idempotency, conflicts/resolution, rename/duplicate/delete/restore, disconnected mounts/retries, profile rename review, root/symlink rejection, document versions/marker repair, resume variants/idempotency.
- Transactional outbox triggers cover upstream application, note, document and chat mutations. Status and document imports reuse shared transactional domain functions.
- Adoption intent is committed before writing IDs; startup reconciliation can complete interrupted adoption. Existing source filenames and folders are retained.
- Startup watcher and 15-second reconciliation, generated dashboard/Base indexes, readable companion exports and document unit editing are implemented.
- Deterministic read-only resume imports retain both language variants and report removals/renames; removed source entries do not silently delete profile content.
- AI attempt context now captures the actual source profile and configured provider/model without keys. Mutation checkpoints are being verified for retry after interruption.
- Export schema 5 adds follow-up fields, integration mappings/snapshots/outbox and resume provenance; versions 1–4 remain readable. Restore test pending.

## Current validation and blockers

Lint and typecheck pass for application code. Full coverage and production build are running.
Scratch third-party LiveSync checkout is excluded from TypeScript/ESLint/Docker contexts (it is not app code).
The optional LiveSync sidecar is pinned to bridge commit fc0e028d33b3a12ddee1322951375e05107edc55, Deno 2.9.7. Its locked image builds and all 6 real CouchDB integration tests pass. Path/CLI compatibility adapters remove the extra JSR registry dependency; the replication algorithm remains upstream.
The model registry registry.ollama.ai returns HTTP 403 under this environment policy. A real pretrained local-model inference smoke test is currently blocked by model download access; no claim of real inference is made.
No production deployment has been attempted.

## Continuation checkpoint

Feature branch has specification/demo and profile-parser commits. Integration services, UI,
resume importer, migrations and AI provenance/checkpoints are implemented but not yet committed.
Completed since checkpoint: backup restore test passes; 65 targeted tests passed. Added a
restart checkpoint test and fixed job startup/provenance and email optimistic-lock issues;
11 focused job tests now pass. Added 10 filesystem/worker/Settings UI tests, all passing.
Native production build passes. The isolated demo runs on port 3200 with runtime
/tmp/dossier-demo-Filr6h and synthetic database dossier_demo_695fca79090e.
Browser scenario has verified adoption, bidirectional editing, conflict UI, profile
review and both resume import flows; it exposed missing cross-tab recovery, now implemented
as New application → Saved AI work. Rebuild/rerun that scenario before claiming completion.
Screenshots captured so far: dashboard, adoption, conflict and resume import.

Current running checks: full coverage (work/coverage.log), exact upstream worktree baseline
(work/upstream-baseline.log), final native build/typecheck, and production image build.
Earlier full run: 1,525 passed, 26 skipped, one email CAS regression (fixed).
Next: finish the ongoing checks, resolve any coverage gaps without changing thresholds,
rerun browser workflow including disconnect/recovery/PDF on the final image, run all upstream
Playwright tests, complete CI/runbook/PR summary and final commits. Local-model inference
remains externally blocked by the model registry's 403. No production deployment or merge.
