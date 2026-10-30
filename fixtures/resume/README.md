# Synthetic career collections

Copy these fixtures into an isolated runtime directory; mount real career sources read-only.
The importer reads Markdown files with frontmatter `source_id`, `collection` and
`language` (`en` or `de`). The body is literal summary/bullets/notes text.
This README is documentation, not an import source: place source files in collection
subfolders (the importer skips root README.md).

- `about`: name, headline; body becomes summary. One source per language.
- `experience`: role, company, location, start, end, current; body becomes bullets.
- `education`: degree, school, start, end, current; body becomes notes.
- `projects`: name, link, start, end, current; body becomes bullets.
- `skills`: name; body is preserved as source context.
- `languages`: name, explicit NATIVE/C2/C1/B2/B1/A2/A1 level.

Dates are quoted YYYY or YYYY-MM, never inferred from filenames. `source_id` and
collection identify an entry across renames; `language` identifies its variant.
Both variants remain in PostgreSQL; confirming an import updates only the selected
language in Dossier's existing single-language profile editor. Switching language
updates the same imported target IDs. Manual entries are retained. Removals are
reported for review and do not delete profile content. No source file is written.
