# Dossier Markdown fork

Preserve Next.js/React/Prisma/PostgreSQL, upstream UI, AGPL license and history.
Do not require private vaults, website repositories, credentials, Rust or Pi.
Use synthetic fixtures and the fake AI service. Never publish or deploy private data.

Use Node 24.19.0 and Yarn 4.18.1 (packageManager). Run `corepack enable`,
`yarn install --immutable`, `yarn prisma generate`, `yarn lint`,
`yarn typecheck`, `yarn test`, `yarn build`, `yarn test:e2e`.
Database tests require a disposable PostgreSQL database ending in `_test`.
See DEVELOPMENT.md for upstream commands and docs/markdown-runbook.md for integration commands.

Keep Markdown parsing, targeted edits, filesystem safety and synchronization in
src/lib/markdown. Never use AI to parse metadata. Persist conflicts and outbound
work; never overwrite concurrent changes. Do not modify committed fixtures at runtime.
Use ordinary additive migrations. Preserve upstream checks and coverage thresholds.
Record implementation evidence and the next concrete step in docs/implementation-status.md.
Keep changes on a feature branch; do not merge or deploy.
