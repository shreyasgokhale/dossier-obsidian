
# Dossier fork with configurable Markdown integration

## 1. Objective and implementation boundaries

Build a reliable job application tracker for daily use, preserving Dossier’s interface and features while allowing application records to be read and edited as ordinary Markdown notes in Obsidian.

**The implementation agent will have access only to the Dossier fork.** It must not require the personal vault, website repository, previous conversations, Proxmox server or real credentials.

- Retain Dossier’s Next.js, React, Prisma and PostgreSQL stack. Defer Rust to prioritize maintenance and upstream compatibility.
- Preserve existing UI, application tracking, AI workflows, document history, PDF generation and optional integrations.
- Keep upstream Git history, license and attribution. Record the starting upstream commit and document future merges.
- Implement Markdown integration as a focused module with limited hooks into existing mutation functions.
- Keep Pi/OpenCode as separate development tools.
- Store app code and synthetic examples in the repository. Supply private notes and resume content through configurable runtime mounts.
- PostgreSQL remains the operational store; defined application fields, notes and document text support bidirectional Markdown editing.

The initial AI scope is chat and explicitly requested jobs that continue after closing the browser. Autonomous activity is outside v1.

## 2. Configurable Markdown format

### Format profiles

Add a Markdown integration screen under Settings. Users must be able to define their note format without changing source code.

A named **format profile** contains:

- File-selection rules relative to a configured notes root.
- Field locations and property names.
- Status aliases.
- Date formats.
- A template for creating new notes.
- Optional headings identifying posting text and interview notes.

Allow importing and exporting profiles as versioned JSON configuration. Keep the profile schema and examples in the repository; actual filesystem paths and credentials belong to deployment configuration.

Support two deterministic field representations:

1. **YAML frontmatter**, with configurable property names.
2. **Labeled Markdown lines**, with configurable literal prefixes inside a designated metadata section.

For example, both of these must be supported:

```markdown
---
company_name: Example Energy
job_role: Controls Engineer
status: interview
application_date: 2026-10-01
follow_up_date: 2026-10-25
---

# Interview

## Intro call
My notes, tasks and impressions.
```

```markdown
# Application

Company: Example Energy
Role: Controls Engineer
Status: Interview
Applied: 2026-10-01
Follow-up: 2026-10-25

# Interview

## Intro call
My notes, tasks and impressions.
```

Do not use an LLM to interpret fields during synchronization. Do not implement arbitrary regular expressions, executable transformations or a template programming language in v1.

### Supported field mapping

Expose these application fields in the mapping editor:

| Application field | Default frontmatter property |
|---|---|
| Company | `company_name` |
| Role | `job_role` |
| Status | `status` |
| Application date | `application_date` |
| Posting URL | `job_url` |
| Location | `location` |
| Deadline | `deadline` |
| Next action | `next_action` |
| Follow-up date | `follow_up_date` |
| Next interview datetime | `next_interview_at` |

- Reuse existing upstream fields where available; add follow-up fields through ordinary Prisma migrations.
- Allow mapping status strings such as `Interview` to Dossier’s existing enum values.
- Default dates to ISO format. Allow selecting explicit supported formats; never guess ambiguous dates.
- Distinguish missing fields, empty values and invalid values.
- Preserve unknown properties and unrelated Markdown content.
- Require a stable application identifier: default to `dossier_id` in frontmatter, or an unobtrusive HTML comment for labeled-line notes.

### Templates and preview

Support literal Markdown templates with placeholders for the supported application fields. Validate placeholders when saving.

Provide a preview showing:

- Parsed application values.
- Missing or invalid mappings.
- The exact proposed file diff.
- Any fields or sections the app would create.

Changing a profile must trigger a dry-run review of affected files before synchronization resumes. Never silently rewrite all existing notes after a configuration change.

### Adopt existing notes

Allow adopting a note in place:

1. Select a file within the configured root.
2. Choose a format profile.
3. Review parsed metadata and fill missing values.
4. Confirm posting text and any section mappings.
5. Add the stable identifier and link the application.

Preserve the original filename, folder, body, tasks, wikilinks and unrelated properties. Empty frontmatter values must be supported. Do not derive application or interview dates from filenames.

Default to treating the full note body as an associated editable Dossier note. Optional heading mappings may select posting or interview sections; writing must remain limited to explicitly mapped content.

## 3. Synchronization, resume content and AI

### Bidirectional synchronization

Support edits from both the web app and Obsidian.

- Apply imported changes through existing domain functions so status history, document versions and dashboard calculations remain correct.
- Persist outbound synchronization work alongside database changes and retry filesystem failures.
- Watch files and reconcile every 15 seconds, including at startup.
- Use stable IDs, content hashes and persisted last-synchronized snapshots to detect changes.
- Suppress loops and duplicate records.
- Merge independent field changes. Conflicting edits to the same field or body must preserve both versions and require resolution.
- Show conflicts, pending changes and failures within the app.
- Treat missing files as unlinked records rather than application deletions.
- Detect renames through stable IDs.
- Reject duplicate IDs and writes outside configured roots, including symlink escapes.

The Markdown writer must make targeted edits. Avoid reserializing entire notes when only one property changes.

### Obsidian usability

Generate a dashboard note and `.base` views for active applications, upcoming interviews and follow-ups.

Include:

- Links between applications, documents and attachments.
- “Open in Obsidian” links using a configurable vault name.
- Readable chat and fit-assessment exports.
- Editable resume and cover-letter exports with stable document-unit markers.

Damaged document markers must produce a repair warning rather than destructive import. Ordinary tracking must remain usable when AI or synchronization is unavailable.

### Resume source adapter

Implement an optional deterministic importer for Markdown career collections. The agent receives synthetic examples in the fork, not the real website repository.

Support these collections:

- About/summary.
- Work experience.
- Education.
- Projects.
- Skills.
- Languages.

Provide fixtures documenting the expected frontmatter and body structure, including English/German variants. Use configurable source roots and read-only mounts.

Preview changes before updating Dossier’s profile. Repeated imports must be idempotent. Report removals and renames for review.

Keep source files unchanged. Suggestions for improving master resume content remain reviewable proposals.

### AI and public output

- Preserve Dossier’s existing provider abstraction and background jobs.
- Support an explicitly configured local model through Ollama.
- Default CPU deployments to one generation task at a time.
- Include connection testing, progress, recoverable failures and retry controls.
- Expose interrupted jobs as retryable after restart without silently duplicating changes.
- Record the model and source-profile snapshot used for drafts.
- Preserve factual checks and document history.

Do not publish data or write to a public website repository. Repairing the existing garden pipeline is outside this implementation.

## 4. Self-contained development and deployment

### Repository deliverables

Include everything necessary for an online agent or another developer to build and test the app:

- Synthetic Markdown notes in both supported formats.
- An example with empty metadata, a posting, interview notes, tasks and wikilinks.
- Synthetic resume collections.
- Default format profiles and note templates.
- A deterministic fake AI provider.
- Docker Compose for the app and PostgreSQL.
- Native development commands for environments without Docker.
- Pinned tool versions, dependency lockfiles and reproducible images.
- `AGENTS.md` describing boundaries, commands, tests and maintenance rules.

Provide a documented demo command that creates an isolated writable copy of fixtures and starts a usable app. Normal operation must never alter committed fixtures.

### Runtime configuration

Configure notes root, resume root, format profile, Obsidian vault name, model endpoint and deployment URL without hard-coded personal paths.

Keep private records, database data, credentials, model files and synchronization state outside the app’s Git repository.

The standalone checkout is the deployment source. Document optional subtree/submodule integration as a convenience only.

### LiveSync and Proxmox

Provide an optional pinned headless LiveSync sidecar for synchronizing selected folders with CouchDB.

- Direct filesystem use must work without LiveSync.
- Test LiveSync using disposable data.
- Keep its credentials and internal database outside synchronized note content.
- Do not add competing automatic Git synchronization over the same server files.

Target Docker Compose inside a Linux VM on Proxmox. Use the same application image tested in CI, configured through environment and mount settings.

Preserve authentication and support the user’s existing HTTPS proxy. Include health checks, logs, backup/restore instructions and upgrade procedures.

Actual deployment against private data and Proxmox is a later validation step; cloud-only tests must not be reported as proving it works on that server.

## 5. Delivery sequence and acceptance criteria

Implement in reviewable milestones:

1. Runnable upstream fork, preserved UI and isolated demo.
2. Format-profile editor, templates, parsing and diff previews.
3. Adoption, bidirectional synchronization and conflict handling.
4. Resume importer and complete AI/document workflow.
5. LiveSync testing, deployment packaging and maintenance documentation.

Retain upstream tests and add focused coverage for the integration.

### Required acceptance tests

- A fresh clone builds and launches without the vault, website repository, server or real AI credentials.
- Both example note formats can be configured through Settings.
- Renaming mapped properties or labels requires no code changes.
- Adoption preserves existing content and fills empty fields only after confirmation.
- Changing status or follow-up dates in either interface updates the other.
- Unknown properties, formatting, tasks and wikilinks survive repeated synchronization.
- Template creation generates valid notes in the selected format.
- Profile changes produce a dry-run diff before affecting existing records.
- Invalid YAML, duplicate labels, unsupported statuses and ambiguous dates produce actionable errors.
- Concurrent edits preserve both versions and can be resolved through the UI.
- Renames, deletions, malformed document markers and disconnections are recoverable.
- Reconciliation creates no duplicate applications, notes, versions or history events.
- Resume imports are idempotent and preserve language variants.
- AI jobs continue after browser disconnect; failures preserve user input.
- Fake-provider tests cover progress, failures and retries; a separate local-model smoke test verifies real inference.
- Backup restoration recovers records and synchronization mappings.
- Core screens retain Dossier’s visual design.
- Documentation explains upstream merges, migrations and production upgrades.

**Done means:** a tested, self-contained fork with working Markdown format configuration, a usable demo, screenshots, test results and a deployment runbook.
