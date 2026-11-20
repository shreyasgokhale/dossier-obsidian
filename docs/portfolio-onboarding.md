# Portfolio résumé and career onboarding

The **Portfolio** theme adapts the public résumé's A4 print typography,
margins, section order, and company and role headings. The base résumé and
tailored CV use the same component for the editor preview and PDF. The cover
letter uses the same typography and header rule. Portfolio is the base
default when no theme has been saved. Select **Portfolio** under **Base resume →
Themes** to switch a saved preference. New applications inherit that choice.
An existing draft has its own theme selector.

The reference is the public Astro résumé and its print stylesheet, reviewed
2026-11-19. Portfolio uses the same contact and location alignment, section
order, organization and role rows, and project title and date rows. A refreshed
website snapshot carries skill categories into the base résumé. Tailored skill
text follows its edited unit, and language levels follow the profile's reviewed
CEFR options. Existing snapshots without categories can still be imported.
Use a representative tailored CV and cover letter to check wrapping and page
breaks.

## Apply the private onboarding data

1. Sign in via the existing private Dossier ingress. Use the owner's browser
   or another approved private management path.
2. In **Search Preferences**, apply the validated private input. Preserve the
   selected discovery sources, company boards and schedule unless the owner
   requests a change. Put salary, seniority, work authorisation and the broader
   locations in the scoring interests. Dossier permits up to four active role
   queries and three locations, so the scoring interests can cover more
   locations than the scheduled discovery queries. Avoid using broad company
   or description exclusions for nuanced preferences. Save, reload, and
   verify the values and Markdown sync status.
3. Review the commit-pinned public website résumé snapshot and mount it
   read-only at the configured résumé root. In **Settings → Markdown
   integration**, preview and confirm the import. Check for seeded demo
   entries before generating an application. Add the owner's supplied
   experience details in **Profile → Facts about me**. Keep career goals
   and compensation in search preferences.
4. Select Portfolio and export a PDF from both the base résumé and a draft.
   Confirm that editing a unit refreshes the PDF and leaves the source
   record intact. Review the package before submitting anything externally.

The Dossier-owned notes projection may store the search preferences. Keep
the authoring vault and public website outside all writable destinations.
Keep actual preferences, career evidence, instance addresses, backups,
deployment inventory and credentials outside Git.

## Verification on 2026-11-19

Typechecking, targeted lint, and the Node and DOM suites passed with 1,344
tests passing and 29 optional skips. A synthetic Chromium check confirmed
the 18-point A4 title, the reference section order, and PDF generation. The
public website converter validated 128 résumé entries in a pinned snapshot.

Nimbus's readiness API and scoped SSH status passed. Signed-in browser checks
verified saved search preferences, six supplemental career facts, profile
basics, seven experience entries, three education entries, seven projects,
41 skills and five languages after reload. The website entries were entered
through Dossier’s normal profile editor using the validated public Markdown.

The current read-only résumé mount yielded 12 source entries. The reviewed
website snapshot contains 64 English and 64 German entries. The manually
entered role, education and project rows have their own identifiers. Before
confirming a snapshot import, review the target mapping and link equivalent
profile entries so a later refresh preserves their identifiers and existing
application drafts. Portfolio deployment and live PDF comparison remain
pending.
