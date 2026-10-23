import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const image = process.env.DOSSIER_TEST_IMAGE;
if (!image)
  throw new Error("Set DOSSIER_TEST_IMAGE to the image being verified.");
const database = new URL(process.env.DATABASE_URL!);
if (!database.pathname.endsWith("_e2e"))
  throw new Error("Image tests require an isolated _e2e database.");
if (["localhost", "127.0.0.1"].includes(database.hostname))
  database.hostname = "host.docker.internal";
const temp = await mkdtemp(path.join(os.tmpdir(), "dossier-image-test-"));
const envFile = path.join(temp, "runtime.env");
const fakeUrl = new URL(process.env.DOSSIER_AI_URL!);
fakeUrl.hostname = "host.docker.internal";
const values = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("DOSSIER_")),
  ),
  DATABASE_URL: database.toString(),
  DOSSIER_AI_URL: fakeUrl.toString(),
  DOSSIER_NOTES_ROOT: "/notes",
  DOSSIER_RESUME_ROOT: "/resume",
  DOSSIER_DATA_DIR: "/data",
  PORT: "3000",
  HOSTNAME: "0.0.0.0",
};
await writeFile(
  envFile,
  Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n"),
  { mode: 0o600 },
);
const name = `dossier-image-test-${process.pid}`;
const args = [
  "run",
  "--rm",
  "--user",
  `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
  "--name",
  name,
  "--add-host",
  "host.docker.internal:host-gateway",
  "-p",
  "127.0.0.1:3100:3000",
  "--env-file",
  envFile,
  "--mount",
  `type=bind,src=${process.env.DOSSIER_DATA_DIR},dst=/data`,
  "--mount",
  `type=bind,src=${process.env.DOSSIER_NOTES_ROOT},dst=/notes`,
  "--mount",
  `type=bind,src=${process.env.DOSSIER_RESUME_ROOT},dst=/resume,readonly`,
  image,
];
const child = spawn("docker", args, { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    spawn("docker", ["stop", name], { stdio: "ignore" });
  });
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
