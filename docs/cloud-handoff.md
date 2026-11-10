# Cloud handoff — 2026-11-03

Follow-up completed 2026-11-11: the hydration-time keyboard focus failure is
fixed and covered by slow-client regression tests. Standard ARM64 and AMD64
production images build with the original lockfile and checksum enforcement.
Fresh registry/cache checks did not reproduce the historical YN0018 errors.
All 1,802 unit/database tests, 142 browser tests and the complete Markdown
workflow pass; 29 optional live tests remain skipped. See
[implementation evidence](implementation-status.md#cloud-handoff-follow-up--2026-11-1011)
for diagnosis, additional test synchronization fixes and local image identities.
No merge, deployment or Nimbus access was performed; the existing remote runtime
was preserved. The original handoff below is retained as context.

Branch: `feat/daily-job-digest`. Fix the following without merging or deploying.
Use synthetic fixtures and fake AI; no Nimbus access or credentials are required.
Follow `AGENTS.md` and `docs/markdown-runbook.md` for isolated test setup.

1. **Keyboard focus:** `e2e/applications.spec.ts:35` fails in “moves a card from
   the keyboard”, including its retry. After focusing the card's Actions button
   and pressing Enter, the first `menuitemradio` remains inactive. Investigate
   `src/app/(app)/applications/row-menu.tsx` and
   `src/components/ui/dropdown-menu.tsx`. Reproduce with
   `yarn playwright test e2e/applications.spec.ts -g 'moves a card from the keyboard'`
   after database preparation and a production build. Fix the focus behavior
   while retaining keyboard navigation assertions, then run the full browser suite.
2. **Production image dependency integrity:** the standard Dockerfile production
   target fails `yarn install --immutable` with YN0018 checksum mismatches for
   `@prisma/streams-local@0.1.11` and `@anthropic-ai/sdk@1.3.0`. The earlier checks
   image installed successfully. Investigate registry responses/cache differences;
   do not disable checksum validation or blindly regenerate the lockfile.

Baseline: lint, typecheck, production build and 1,802 unit/database tests passed;
29 optional tests skipped; coverage thresholds passed. Browser suite: 138 passed,
1 failed. On a 2 GiB checks container, use
`NODE_OPTIONS=--max-old-space-size=1536` to avoid the default 1 GiB typecheck heap.
Re-run checks appropriate to the fixes and record evidence in
`docs/implementation-status.md`.

The synthetic LAN app is running and was explicitly authorized despite the known
browser failure. It currently packages the successful standalone build over the
verified checks image, avoiding a fresh dependency fetch. Preserve that runtime
until a normal production image passes. Local deployment settings: `vps.json`;
operations and credential **locations only**: `docs/vps-deployment.md`. Secrets
remain on Nimbus. Existing checks-container diagnostics are described in
`docs/implementation-status.md`; cloud reproduction must not depend on them.
