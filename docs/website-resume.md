# Website résumé source

The website remains the master source. Dossier consumes a read-only snapshot of
its public Markdown collections, then presents the existing import preview in
Settings → Markdown integration. Nothing writes back to the website, publishes
application notes, or executes website TypeScript. Dossier still works with
synthetic fixtures and without a website checkout or credentials.

The adapter follows the public schemas in
[src/content/config.ts](https://gitlab.com/shreyasgokhale/shreyasgokhale.com-site/-/blob/main/src/content/config.ts)
and the collection selection in
[ResumePage.astro](https://gitlab.com/shreyasgokhale/shreyasgokhale.com-site/-/blob/main/src/components/pages/ResumePage.astro),
inspected on 2026-11-12. The rendered
[résumé](https://shreyasgokhale.com/resume/) is a presentation of those sources;
the importer does not scrape its HTML.

| Website source | Dossier source |
|---|---|
| `about/about.md`, `about/about-de.md` | Summary; name/headline from explicit configuration |
| `work/*.md` | Experience: company, role, location, start/end and literal body |
| `education/*.md` | Education: company → school, role → degree |
| `projects/*.md` | Projects: title, description/body, date, demo/repository link |
| `skills/*.md` | One skill per Markdown bullet, deduplicated by literal name, plus the source category for Portfolio |
| `languages/*.md` | Language name and an explicitly selected Dossier level |

`lang` defaults to English as on the website; German files must declare `lang: de`.
Pairs use the same filename stem (`example.md` / `example.de.md`); the about
pair follows the website's `about.md` / `about-de.md` convention. An optional
`source_id` preserves an entry's identity across future source renames. Without
it, identity follows the filename stem. Removed/renamed identities remain review
proposals; the existing importer never deletes profile content on source removal.
Blog posts, home-page copy, other folders and draft entries are excluded.
Tags remain literal source context. Dates use the website's explicit
`MM/DD/YYYY` convention or ISO `YYYY-MM-DD`; `Current` means current employment.
Invalid dates stop conversion before any snapshot is written.

## Create a snapshot

Use Node 24.19.0 and Yarn 4.18.1, after the normal immutable dependency install.
Create a local configuration file **outside the checkout**, using this synthetic
example as its shape:

```json
{
  "basics": {
    "en": { "name": "Alex Example", "headline": "Systems engineer" },
    "de": { "name": "Alex Example", "headline": "Systemingenieur" }
  },
  "languageLevels": {
    "Fluent": "C1",
    "Fließend": "C1"
  }
}
```

Replace the basics with the website's chosen name/headlines, and map each literal
proficiency label to a level **you select**: `NATIVE`, `C2`, `C1`, `B2`, `B1`,
`A2` or `A1`. The current website uses labels including `Bilingual`, `Citizen`,
`Native`, `Basic` and German variants. Citizenship and informal labels do not
establish CEFR proficiency. An unmapped label stops the command with its exact
file/label; no partial profile import occurs. Explicit CEFR/NATIVE source values
need no mapping. Name/headline configuration is explicit because the website
stores those outside the Markdown collections, in TypeScript and translations.

```sh
yarn resume:website \
  --project shreyasgokhale/shreyasgokhale.com-site \
  --ref main \
  --config /srv/dossier/website-resume.json \
  --output /srv/dossier/sources/website-NEW_REVISION
```

The parent directory must already exist, with no symlink components. Choose a
new absolute output directory outside the app checkout for every refresh. On
macOS, use `/private/tmp/...` rather than the `/tmp` symlink for disposable
snapshots. The command refuses to replace existing output, including an
incomplete earlier attempt. It creates owner-only directories/files; grant the
runtime app user read/traverse access when provisioning a mount.

The production image also bundles the same command as `resume-website`, so a
deployment host needs only Docker. With correctly owned, pre-created source
and configuration paths, stage sources using the same reviewed image:

```sh
docker run --rm \
  --mount type=bind,src=/srv/dossier/website-resume.json,dst=/website-resume.json,readonly \
  --mount type=bind,src=/srv/dossier/sources,dst=/sources \
  DOSSIER_REVIEWED_IMAGE resume-website \
  --project shreyasgokhale/shreyasgokhale.com-site \
  --config /website-resume.json --output /sources/website-NEW_REVISION
```

This short-lived staging container needs public GitLab access; the app source
mount remains read-only. It receives no database, notes, authentication or AI
provider configuration.

Only public GitLab's unauthenticated API is used. The branch resolves once to a
commit; the content archive uses that commit. Normally two requests fetch a snapshot. Requests reject
redirects, have bounded time/size/count and archive-expansion limits, and select only the résumé
allowlist. No repository clone, tokens or website build dependencies are needed.
The archive request follows GitLab's [public repository archive API](https://docs.gitlab.com/api/repositories/#retrieve-file-archive-from-a-repository).
On HTTP 429 the command stops and reports a numeric `Retry-After` when supplied;
wait that interval before another refresh. It does not retry around rate limits.
If the public project rejects the ZIP representation with HTTP 406, the command
uses its ordinary tree/raw-file API for the same pinned commit, paced at no more
than 40 requests per minute. It never uses that compatibility path to retry
HTTP 403 or 429. A completed source snapshot is still required before changing
the app source mount; a failed fetch leaves the current source/profile intact.
`manifest.json` records the commit, configuration hash, input/output hashes and
skipped entries. It is written last as the completion marker. Retain it with the
snapshot; only mount snapshots that have a complete manifest.

## Mount and import a reviewed snapshot

After verifying the completed snapshot, mount the completed snapshot at
`/resume` **read-only**, keeping the notes, database and app-data mounts intact.
Set `DOSSIER_RESUME_ROOT=/resume`. The generic
`deployment/compose.yml` already accepts an external `RESUME_ROOT` host path.
Nimbus currently uses the separately provisioned synthetic named `resume`
volume. After verifying the snapshot and read/traverse access for UID 1000,
append `deployment/compose.vps.website.yml` after the two Compose files in
`vps.json`, with `DOSSIER_WEBSITE_SNAPSHOT` set to the absolute **remote** snapshot
directory. This replaces only the app's `/resume` mount with a read-only bind;
it refuses to silently create a missing host directory. Validate with
`config --quiet`, then recreate only the app using that same ordered Compose
configuration. Persist the non-secret snapshot selection and ordered files in
the deployment settings once activated. The override is not currently enabled
in `vps.json`. Do not erase the fixture volume or change credentials to switch
sources.

In Settings → Markdown integration, select English or German, preview the source
changes, and confirm the reviewed import. Manual profile entries remain. The
stale-preview token prevents confirmation after concurrent profile/source changes;
review a fresh preview when that occurs. A second import is idempotent. Check
for duplicate synthetic demo profile entries before using the resulting profile
for applications; imported sources do not automatically remove existing entries.

Refresh by making another commit-pinned snapshot, reviewing its manifest, and
switching the read-only source mount to that new directory. Recreate only the
app as needed, then preview/confirm again. Previous snapshots permit source
rollback; profile changes still require review. No automatic background website
refresh is enabled by this command.
