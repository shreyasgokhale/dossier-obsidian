# Implementation status

Specification: docs/implementation-spec.md. Started 2026-10-23.
Branch: feature/configurable-markdown.
Upstream starting commit: 4fd532973be9ecbae43b55de5e0c3e681f07e493 (Dossier 1.8.1).

## Milestones and acceptance checklist

- [ ] M1 Runnable preserved upstream and isolated demo: fresh checkout, pinned tooling, fake AI, synthetic notes/resume, baseline lint/types/tests/build.
- [ ] M2 Configurable profiles: both representations, mapped names/status/date formats, literal templates, actionable parse errors, exact diffs, Settings editor and dry-run activation.
- [ ] M3 Adoption and synchronization: confirm preview, preserve bytes outside mappings, transactional outbox, startup/watch/15s reconcile, three-way merge, conflict UI, rename/unlink/duplicate and root safety, restart recovery, document markers, Obsidian exports.
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
Baseline checks are running; logs in ignored work/.

## Continuation checkpoint

Read the complete specification and upstream status/document/job/settings architecture.
Next: finish baseline checks, add isolated demo, then implement profile parser/writer
and persistence migration. No integration behavior is implemented yet.
