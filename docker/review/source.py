#!/usr/bin/env python3
"""Send a reviewed source allowlist to Docker; never send the whole checkout."""
import hashlib
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile

root = pathlib.Path(__file__).resolve().parents[2]
target = sys.argv[1] if len(sys.argv) == 2 else ""
if target not in ("review", "production"):
    raise SystemExit("Usage: python3 docker/review/source.py review|production")
roots = {"src", "prisma", "public", "fixtures", "e2e", "e2e-markdown", "scripts", "docker"}
config = {"Dockerfile", ".dockerignore", ".yarnrc.yml", "package.json", "yarn.lock", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "eslint.config.mjs", "vitest.config.mts", "prisma7.config.ts", "playwright.config.ts", "playwright.markdown.config.ts", "playwright.review.config.ts", "LICENSE", "AGENTS.md"}
tracked = subprocess.check_output(["git", "ls-files", "-z", "--cached"], cwd=root).decode().split("\0")
# Include only this harness's known new files, never arbitrary untracked source.
tracked += ["playwright.review.config.ts"] + ["docker/review/" + name for name in (
    "source.py", "inspect.py", "gate.sh", "init.sh", "fakes.sh", "check.sh",
    "seed.mts", "isolation.mts", "restart.mts",
)]
files = []
for name in sorted(set(tracked) - {""}):
    path = pathlib.PurePosixPath(name)
    if name not in config and path.parts[0] not in roots and not name.startswith("deployment/tools/"):
        continue
    if any(part.startswith(".env") or part in {".git", "node_modules", ".auth", "generated"} for part in path.parts):
        continue
    source = root / name
    if any((root / pathlib.Path(*path.parts[:i])).is_symlink() for i in range(1, len(path.parts) + 1)) or not source.is_file():
        raise SystemExit(f"Refusing non-regular source: {name}")
    files.append(name)
manifest = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files}
source_hash = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
evidence = root / "work/isolated-review"
evidence.mkdir(parents=True, exist_ok=True)
(evidence / f"source-manifest-{target}.json").write_text(json.dumps({"revision": revision, "sourceSha256": source_hash, "files": manifest}, indent=2) + "\n")
print(f"Source SHA256: {source_hash}", flush=True)
print(f"Building {target} from {len(files)} explicitly allowed source files; no environment or host data.", flush=True)
with tempfile.TemporaryFile() as archive:
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        for name in files:
            tar.add(root / name, arcname=name, recursive=False)
    archive.seek(0)
    image = "dossier-isolated-review:local" if target == "review" else "dossier-isolated-demo:local"
    subprocess.run(["docker", "build", "--file", "Dockerfile", "--target", target, "--label", f"org.opencontainers.image.revision={revision}", "--label", f"org.dossier.review.source-sha256={source_hash}", "-t", image, "-"], stdin=archive, cwd=root, check=True)
