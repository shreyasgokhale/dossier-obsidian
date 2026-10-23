# Markdown integration runbook

This fork starts at Dossier 1.8.1, upstream commit
`4fd532973be9ecbae43b55de5e0c3e681f07e493`, with its UI, AGPL license,
provider abstraction, PostgreSQL store and history retained. No private vault,
website checkout, credentials, Rust or Pi runtime is needed.

## Native development and isolated demo

Use Node **24.19.0**, Yarn **4.18.1** (packageManager), PostgreSQL **18.6**.
On a machine without Docker, install PostgreSQL natively, start its service and
create a development role with CREATEDB. These commands assume a disposable local
`postgres` role with password `postgres`; set a different connection string if needed.

```sh
corepack enable
yarn install --immutable
yarn prisma generate
yarn playwright install --with-deps --only-shell chromium
yarn build
DEMO_DATABASE_SERVER=postgresql://postgres:postgres@127.0.0.1:5432/postgres yarn demo --production
```

Open **http://localhost:3200**, password **demo-password**. The command creates a
random `dossier_demo_*` database and a temporary runtime directory containing a
writable copy of notes, a copy of career sources and private recovery files.
It prints that directory and database name; it never writes committed fixtures.
`DEMO_PORT` and `DEMO_AI_PORT` change its ports. `yarn demo` starts Next development
mode instead. The fake AI service is deterministic and needs no real credentials.
For deterministic failure/retry testing, POST `{"failures":20,"delayMs":1500}` to
`http://localhost:3996/test/control`; reset with `{"failures":0,"delayMs":300}`.
The control endpoint belongs only to the fake service, not the app.

Stop with Ctrl-C. Data is retained for inspection and recovery. Restart the same demo:

```sh
yarn demo:resume /tmp/dossier-demo-PRINTED_SUFFIX
```

To verify real restart recovery on that synthetic runtime, run
`yarn verify:restart /tmp/dossier-demo-PRINTED_SUFFIX` after a production build.
Stop the demo first: the verifier must be the only app using those notes/database.
It uses port 3300 (override with RESTART_TEST_PORT), makes independent app/file
edits while stopped, preserves an interrupted job and checks counts across two restarts.

When finished, drop only the printed `dossier_demo_*` database and remove only its
printed temporary directory. Do not use demo credentials on a public deployment.
The runtime environment file contains synthetic secrets and has mode 0600.

## Complete demo workflow

1. Open Settings → Markdown integration. Select **Frontmatter**, choose
   `frontmatter/empty-energy.md`, fill the empty application/follow-up dates,
   and review adoption. Inspect parsed values, errors, fields to create and exact
   diff; confirm adoption and the chosen section mappings.
2. Inspect the original filename, unknown YAML property/comment, tasks, attachment
   reference and wikilink. The full body is the associated editable Dossier note.
   To map only selected content, configure Posting/Interview headings before adoption.
3. In the application, expand **Application details and follow-up**, change a date
   or next action and save. Change status through Dossier's existing controls.
   Inspect the file after reconciliation (watcher or at most 15 seconds).
4. Edit status/follow-up metadata in the file. Reload Dossier after reconciliation.
   Make independent app/file edits to see them merge. Change the same body or
   field in both places, then use Settings to review and resolve both versions.
5. Rename the file: the stable ID reconnects it. Remove it: the application remains
   unlinked; restore its ID-bearing file to reconnect. Never copy stable IDs into
   a second note. Duplicate IDs block synchronization for the affected application.
6. Change a mapped property in Settings, save the draft (pauses that profile),
   generate a dry run and inspect every file diff. Only the confirmation applies
   the reviewed changes and resumes sync. Old/unknown properties remain intact.
7. Choose **Labeled lines** and adopt `labeled/application.md`. Prefixes are literal
   and only recognized inside the configured metadata heading.
8. Preview the resume source import, confirm English, repeat (no duplicate entries),
   then preview German. Both variants remain in source provenance; the existing
   Dossier profile shows the selected language. Review reported removals/renames.
9. Start a new application with the fake provider. Read the posting, create the
   documents, refine a summary, inspect history and download a PDF. Close the tab
   during an explicit job: it continues. Return to New application → **Saved AI work**
   to resume persisted input/results. Failed/interrupted work has Retry.
10. Inspect `Dossier/Dashboard.md`, `.base` views and generated companion indexes.
    Document exports use stable unit markers. Edit text inside markers; damage a
    marker to see a repair warning, then use repair/resolution controls in Settings.

The Playwright workflow automates this sequence with synthetic data:

```sh
# Create disposable databases with your local PostgreSQL tools first:
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/dossier
yarn tsx scripts/prepare-test-databases.mts
yarn lint
yarn typecheck
yarn test:coverage --maxWorkers=1
yarn build
yarn test:e2e
yarn test:e2e:markdown
yarn test:livesync
```

Unit/database tests share one `_test` database: run separate invocations sequentially.
The Markdown browser test uses `dossier_markdown_e2e` and an isolated temporary vault.
The image variant runs on Linux Docker with host networking so its synthetic
PostgreSQL/fake-provider services can remain bound to loopback.
Screenshots are written to `docs/screenshots`; set `DOSSIER_SCREENSHOT_DIR` to override.

## Profiles and integration semantics

Versioned JSON examples and schema are in `fixtures/profiles`. Paths/credentials
are absent from profiles. Globs support only literal names, `*`, and `**`, relative
to the notes root. Dates use one explicitly selected format; interview timestamps
require ISO 8601 plus a timezone. Unknown statuses need an explicit alias to an
existing Dossier status (including DECLINED). No AI, executable expressions,
arbitrary regular expressions or template language interprets fields.

Placeholders are `{{company}}`, `{{role}}`, the other mapped field names and `{{id}}`.
Use bare placeholders as YAML values; the renderer quotes YAML strings safely.
Preview a template before use. Missing metadata differs from empty metadata;
missing fields do not erase database values. Adoption fills only reviewed missing
or empty values. Dates are never inferred from filenames.

The writer edits scalar spans and mapped sections, preserving unrelated bytes.
For default frontmatter notes the full body is editable; for labeled notes the
metadata section is excluded from the associated body. Optional Interview heading
mapping limits body writes to that section. Posting text is imported only through
an explicit Posting heading. Changing headings can produce larger body diffs:
review those before activation. A missing mapped heading requires repair in the
note; synchronization does not guess a replacement section.

PostgreSQL snapshots, hashes and durable outbox rows track reconciliation.
Database triggers queue work in the same transaction as application/note/document/
chat mutations. Status imports reuse the existing domain transition function;
document edits use the existing optimistic writer and retain versions.
A PostgreSQL advisory transaction lock serializes integration work in this single
app instance. Independent fields merge; body conflicts preserve both complete
versions. Source files have stale-read guards, atomic replacement and pre-write
recovery copies under `$DOSSIER_DATA_DIR/markdown-recovery`.

Filesystem replacement and PostgreSQL cannot share a transaction. Committed
adoption intent is completed after restart; exports and repeated imports are
idempotent. Recovery copies retain overwritten file bytes. Avoid editors that
replace the entire mount or race renames continuously. Do not run two app instances
against one notes mount. Recovery copies are retained until an operator removes
them; include them in backup capacity planning.

Resume collection schemas/examples are documented in `fixtures/resume/README.md`.
Source mounts are read-only. Removing sources reports a proposal and retains
existing profile content. Suggestions for master content are reviewable text;
the app never writes the website repository or source collection.

## Production on a Linux VM / Proxmox

The standalone checkout is the deployment source. Build and test one image, tag
it with the feature commit, and deploy that exact image (prefer a digest). CI also
executes the full Markdown browser workflow against the built image and retains
that exact image as the `dossier-review-image` artifact (load its tarball with
`gunzip -c dossier-review-image.tar.gz | docker load`). The
Dockerfile pins Node by digest; the dependency lockfile pins application packages.
Use `deployment/compose.yml` for the app/PostgreSQL. The original development and
production Compose files are retained for upstream compatibility.

```sh
docker build --target production -t dossier-markdown:REVIEWED_COMMIT .
# Use the disposable test databases prepared above, never a production database:
DOSSIER_TEST_IMAGE=dossier-markdown:REVIEWED_COMMIT yarn test:e2e:markdown
# In this cloud environment only, add --secret id=proxy_ca,src="$CODEX_PROXY_CERT".
# Put secrets and external mount paths in /srv/dossier/deployment.env (chmod 600).
docker compose --env-file /srv/dossier/deployment.env -f deployment/compose.yml config --quiet
docker compose --env-file /srv/dossier/deployment.env -f deployment/compose.yml up -d
```

Required environment: `DOSSIER_IMAGE`, `POSTGRES_PASSWORD` (use a URL-safe password,
or also set `DATABASE_URL` with its password URL-encoded),
`DOSSIER_PASSWORD` (Argon2 hash from `yarn hash-password`), `DOSSIER_SECRET`
(stable random 32+ characters), `DOSSIER_PUBLIC_URL`, `NOTES_ROOT`, `RESUME_ROOT`.
The app's integration variables are `DOSSIER_NOTES_ROOT`, `DOSSIER_RESUME_ROOT`,
`DOSSIER_MARKDOWN_PROFILE`, `DOSSIER_OBSIDIAN_VAULT`. Keep writable roots, database,
secrets, models and recovery state outside the code checkout. Mount career sources
read-only. The container's non-root app user must have write access to notes and
runtime data. Use pre-created, correctly owned host directories. With LiveSync,
use a dedicated shared notes group (`NOTES_GID`, default 1000), add both service
users to it, and give the notes tree group read/write access with setgid directories.
The writer preserves existing file modes and creates new notes with mode 0660 and
new folders with mode 2770; recovery copies remain private mode 0600.

Keep Dossier authentication enabled. The app binds only to VM loopback; route the
existing HTTPS proxy to it, preserving Host/X-Forwarded-Proto and streaming for job
progress. Do not expose PostgreSQL. `/api/health` checks database connectivity and
reveals no records. Inspect `docker compose ... ps` and `logs --tail=100 app db`;
Settings shows synchronization conflicts and queued failures. Core tracking
continues when the model or notes mount is unavailable.

For a CPU model, configure `DOSSIER_AI_PROVIDER=local`, an explicitly selected
`DOSSIER_AI_MODEL` and `DOSSIER_AI_URL` pointing at Ollama. Dossier's local provider
runs one task at a time and retains connection tests, progress and Retry. Model/
profile provenance is recorded per AI attempt without API keys. Accepted drafts
retain it on the application after task cleanup; JSON backups include it. Mutating document
jobs save a result checkpoint with their database writes, so retry after restart
can finish without applying changes twice. The development fake is not a model
quality evaluation. Run a separate real-inference check on the deployment host:

```sh
OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:3b \
  AI_LIVE=ollama yarn vitest run src/lib/ai/providers.live.test.ts src/lib/ai/tasks/tasks.live.test.ts
```

Private vaults, real models and the actual Proxmox/HTTPS setup require later local
validation. Cloud tests do not prove those private integrations work.

## Optional headless LiveSync

Direct filesystem mode is complete without LiveSync. The optional image pins
`vrtmrz/livesync-bridge` at `fc0e028d33b3a12ddee1322951375e05107edc55`, Deno 2.9.7,
and a reviewed dependency lockfile. Small path/CLI adapters use Node-compatible
builtins, removing the additional JSR registry dependency. They do not alter the
bridge replication algorithm. `yarn test:livesync` builds that image and exercises
real encrypted CouchDB exchange, compatibility/recovery cases and filesystem
removal propagation with disposable data. No vault is mounted by those tests.

Copy `deployment/livesync/config.example.json` to an external private file, edit
remote database, credentials, passphrases and the selected remote folder, and set
`LIVESYNC_CONFIG` to its absolute host path. Mount only the selected application
folder as `NOTES_ROOT`, not an entire unrelated vault. Add
`-f deployment/compose.livesync.yml --profile livesync` to Compose commands.
The config is read-only at `/app/dat/config.json`; internal database/checkpoints
live in the `livesync-state` volume, separate from synchronized `/app/data`.
Back up that state and keep it when recreating the sidecar. In proxied environments
add the local CouchDB hostname to NO_PROXY while preserving external proxy settings.
Do not add competing automatic Git synchronization over the same server files.

## Backup, restore and upgrades

For a consistent full backup, stop app and LiveSync writers, then capture:

- `pg_dump -Fc "$DATABASE_URL" > dossier.dump` (all application, mapping, job and
  synchronization tables), notes, app-data recovery files and LiveSync state.
- External profile JSON and deployment environment/secrets stored separately with
  restrictive permissions; source career collections through their own backups.
- The tested app image digest and Git commit.

Restore into a fresh database:

```sh
pg_restore --no-owner --dbname="$RESTORE_URL" dossier.dump
```

Restore the notes/state directories and the same DOSSIER_SECRET,
then start the same image. Inspect health, pending work and conflicts before
resuming normal editing. Never restore a production dump into the test databases.
The application's JSON export schema 5 also restores follow-up fields, format
profiles, stable mappings, snapshots, conflicts, work and resume source provenance;
it continues reading upstream export schemas 1–4. JSON exports retain upstream's
policy of excluding background jobs and installation credentials. Back up the
filesystem separately. The database integration tests verify JSON restoration
followed by idempotent reconciliation. Delete everything clears integration
snapshots, custom profiles and managed recovery copies along with application
data. External Markdown notes and career source files remain on their mounts.

Before upgrading, back up, test migrations on a restored disposable database,
run the full suite, and build/test the exact image to be deployed. Startup runs
`prisma migrate deploy` and the idempotent built-in seed. Never edit an applied
migration. Rollback of an incompatible schema requires restoring its matching
backup plus the previous image; do not attempt automatic destructive down-migrations.

For upstream maintenance, retain history/license and add the official upstream
remote if desired. Fetch a selected release, merge it into a maintenance feature
branch, inspect status/document/job/settings changes and rerun every check.
Keep the trigger migration and shared transactional domain hooks intact. Resolve
export-version collisions explicitly before importing newer upstream formats.
Review new upstream fields for mappings instead of copying personal configuration
into source. Optional subtree/submodule integration is a convenience only; it is
not required for build, tests or deployment.
