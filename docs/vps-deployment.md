# Nimbus deployment

`vps.json` identifies the dedicated Compose project and remote checkout. The
fresh setup uses `deployment/compose.vps.yml`, synthetic fixtures, and the fake
AI service. Port 3200 is bound only to Nimbus's LAN address. Immich is a separate
project and must remain untouched.

Deployment snapshot (2026-11-03): feature revision
`6645580bf7efedb51270c5a6f0a8f6f1dd41b4cc`, image
`nimbus-dossier-obsidian:6645580bf7ef`, runtime manifest list digest
`sha256:f51aa48e6bda5b183c8a054449813a039fd34de1986a1e1b2e710c73e71f668d`.
App, PostgreSQL and fake AI were healthy; LAN `/api/health` and `/login` both
returned HTTP 200. The image contains the application at this revision; subsequent
deployment documentation commits do not change the running application.
See [cloud-handoff.md](cloud-handoff.md) for the short failure handoff.

Runtime secrets are generated once on Nimbus by `deployment/provision-vps.mjs`,
using Node 24.19.0. Run it with the remote deployment directory mounted at
`/provision` and the twelve-character feature commit as its argument. It refuses
to replace either existing credential file. Both `.env` and `login-password`
have mode 0600; neither belongs in source control or transfer archives. Retrieve
the sign-in password directly on Nimbus from
`/home/nim/services/dossier-obsidian/deployment/login-password`.

All Compose operations use this prefix on Nimbus:

```sh
sudo -n docker compose \
  --project-directory /home/nim/services/dossier-obsidian/deployment \
  -p nimbus-dossier-obsidian \
  -f /home/nim/services/dossier-obsidian/deployment/compose.vps.yml
```

Validate with `config --quiet`, never expanded `config`. Use `ps` to inspect
service status. The app exposes `/api/health` and `/login` at
`http://192.168.8.219:3200`. Named volumes retain database, notes, resume and app
data. The one-shot init copies committed fixtures only into fresh runtime
volumes; the app mounts resume data read-only. Never use `down -v` or prune.

Build the existing Dockerfile's `review` and `production` targets from an
inspected source allowlist. Tag both with the feature revision, and retain the
source manifest. Run checks serially within the checks service to bound RAM use.
The checks service allows a 1536 MiB Node heap within a 2 GiB container limit;
Node's default 1 GiB heap was insufficient for typechecking on this host.
Database unit tests use `dossier_test`; browser tests use their own `_e2e`
databases. Never run either suite against the app database. Tests and builds
must pass before starting the app. Preserve the generated `.env`, credential
file and named volumes on subsequent deployments; update only image references
when deploying a new revision, without printing the environment.

The initial startup was explicitly authorized with the known keyboard-focus
browser failure recorded in `implementation-status.md`. A subsequent immutable
dependency fetch reported checksum mismatches. Do not bypass checksum checking
or change the lockfile to make deployment pass. For this initial startup,
`deployment/Dockerfile.vps-runtime` packages the successful production build
retained in the checks container, using the already-verified checks image as its
base. Its context contains only `.next/standalone` as `standalone/`,
`.next/static` as `static/`, and `public/`, plus the Dockerfile. Build with
`--network none` and an explicit `CHECKS_IMAGE`; no runtime environment files,
credentials, test reports or authentication artifacts enter this context.
This retains the larger checks image as the base until a normal production
image can be rebuilt with verified registry archives.
