import { mkdtemp, cp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/auth/password-hash.ts";
// Never use the inherited database as the app's demo database.
const root = await mkdtemp(path.join(os.tmpdir(), "dossier-demo-"));
await cp("fixtures/notes", path.join(root, "notes"), { recursive: true });
await cp("fixtures/resume", path.join(root, "resume"), { recursive: true });
await mkdir(path.join(root, "data"));
const database = `dossier_demo_${randomBytes(6).toString("hex")}`;
const base = new URL(process.env.DEMO_DATABASE_SERVER ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres");
const admin = new Pool({ connectionString: base.toString() });
try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
base.pathname = `/${database}`;
const port = Number(process.env.DEMO_PORT ?? 3200), fakePort = Number(process.env.DEMO_AI_PORT ?? 3996);
const env = { ...process.env, DATABASE_URL: base.toString(), DOSSIER_PASSWORD: await hashPassword("demo-password"), DOSSIER_SECRET: randomBytes(32).toString("hex"), DOSSIER_DATA_DIR: path.join(root, "data"), DOSSIER_NOTES_ROOT: path.join(root, "notes"), DOSSIER_RESUME_ROOT: path.join(root, "resume"), DOSSIER_OBSIDIAN_VAULT: "Dossier Demo", DOSSIER_AI_PROVIDER: "openai", DOSSIER_AI_URL: `http://127.0.0.1:${fakePort}/v1`, DOSSIER_AI_MODEL: "fake-model", DOSSIER_AI_KEY: "synthetic-demo-key", DOSSIER_TELEMETRY: "off", DOSSIER_JOBS_SOURCE: "off", DOSSIER_PUBLIC_URL: `http://localhost:${port}`, PORT: String(port), HOSTNAME: "127.0.0.1" };
await writeFile(path.join(root, "runtime.json"), JSON.stringify({ database, root, port, note: "Synthetic demo; retained on exit for inspection. Drop only this database when finished." }, null, 2));
// Secrets are stored only in the isolated temporary runtime directory for restart.
await writeFile(path.join(root, "runtime.env.json"), JSON.stringify(Object.fromEntries(Object.entries(env).filter(([k]) => /^(DOSSIER_|DATABASE_URL$|PORT$|HOSTNAME$)/.test(k))), null, 2), { mode: 0o600 });
for (const args of [["prisma", "generate"], ["prisma", "migrate", "deploy"], ["prisma", "db", "seed", "--", "--demo"]]) execFileSync("yarn", args, { env, stdio: "inherit" });
const fake = spawn(process.execPath, ["e2e/fake-ai.mts"], { env: { ...env, FAKE_AI_PORT: String(fakePort) }, stdio: "inherit" });
const app = spawn("yarn", process.argv.includes("--production") ? ["start", "-p", String(port)] : ["dev", "-p", String(port)], { env, stdio: "inherit" });
console.log(`\nDemo: http://localhost:${port}\nPassword: demo-password\nRuntime: ${root}\nDatabase: ${database}\nCommitted fixtures remain unchanged.\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { fake.kill(signal); app.kill(signal); });
app.on("exit", (code) => { fake.kill(); process.exitCode = code ?? 0; });
