# Add configurable Markdown tracking to the Dossier fork

Dossier application records can now be adopted from existing Markdown notes or
exported into configurable notes, while PostgreSQL remains the operational store.
Settings provides named YAML-frontmatter and literal-label profiles, field/status/
date mappings, templates, JSON import/export, previews and reviewed activation.
Adoption preserves the original path and unrelated content. App/file edits use
persisted snapshots and a transactional outbox; independent fields merge and
conflicting versions require review. Stable IDs reconnect renames, missing files
leave records intact, and duplicate IDs or unsafe paths block writes.

The change adds editable document-unit exports, Obsidian dashboard/Base companion
views, deterministic read-only career imports with English/German provenance,
AI attempt provenance and transactional retry checkpoints. Saved AI work can be
resumed after its tab closes. Existing status/document domain writers, UI features,
provider abstraction, authentication and AGPL attribution are retained.

Development is self-contained: synthetic notes/career collections, a deterministic
fake provider, isolated demo commands, native PostgreSQL instructions, pinned
container/tool dependencies, an optional headless LiveSync bridge, and a deployment/
backup/restore/upgrade/upstream-merge runbook. No real vault, website or server is
required. No Rust or Pi integration, merge, production deployment or publication
of user data is included.

Validation and exact commands are recorded in docs/implementation-status.md and
docs/markdown-runbook.md. Screenshots use synthetic data in docs/screenshots.

- Full unit/database/UI suite: 1,552 passed, 26 optional live tests skipped; all
  original coverage thresholds passed. Final cleanup/export regression: 9 passed.
- Lint, typecheck and native production build passed.
- Native complete Markdown browser workflow passed, including fake AI failure,
  retry after browser disconnect, accepted-draft provenance retention and PDF.
- Real two-process restart recovery passed, preserving unfinished input and
  independently edited fields without duplicate applications/notes/history.
- Upstream browser cases: 117 initially passed; affected consent/backup cases
  pass after making test telemetry independent of the local .env. History restore
  also passed. All 123 distinct upstream cases are verified across those runs; the
  initial aggregate attempt was interrupted after the environment-related failures.
- Pinned LiveSync bridge: all six real CouchDB integration cases passed.
- Production image built successfully; the same complete browser workflow passed
  against that exact non-root image, including packaged migrations/seed and PDF.
  Image ID and runtime revision are recorded in implementation-status.md.

The exact upstream baseline had 1,490 passing tests, 26 optional skips and one
Google-inbox timing timeout; its unchanged focused retry passed all four cases.
No tests, timeouts or coverage thresholds were disabled or reduced.

Incomplete external validation: real pretrained-model inference is blocked by
HTTP 403 responses from model download registries. The live smoke command is in
the runbook. Actual Proxmox, private-vault and production HTTPS checks require the
user's deployment host; cloud tests do not establish those integrations. Remote
GitHub Actions have not been run from this workspace. No merge or deployment.
