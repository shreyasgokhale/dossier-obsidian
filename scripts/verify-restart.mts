import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { writeNote, parseNote } from "../src/lib/markdown/format.ts";
import { profileSchema } from "../src/lib/markdown/profile.ts";
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error("Usage: yarn verify:restart /absolute/demo/runtime");
const saved = JSON.parse(await readFile(path.join(root, "runtime.env.json"), "utf8")) as Record<string, string>;
if (!new URL(saved.DATABASE_URL).pathname.startsWith("/dossier_demo_") || saved.DOSSIER_NOTES_ROOT !== path.join(root, "notes")) throw new Error("Restart verification accepts only isolated synthetic demo runtimes.");
const port = Number(process.env.RESTART_TEST_PORT ?? 3300);
const env = { ...process.env, ...saved, PORT: String(port), HOSTNAME: "127.0.0.1", DOSSIER_PUBLIC_URL: `http://localhost:${port}` };
execFileSync("yarn", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
await cp("public", ".next/standalone/public", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
const pool = new Pool({ connectionString: saved.DATABASE_URL });
let app: ChildProcess | null = null;
const start = () => app = spawn(process.execPath, [".next/standalone/server.js"], { env, stdio: ["ignore", "ignore", "inherit"] });
async function stop() {
  const running = app; app = null;
  if (!running || running.exitCode !== null) return;
  await new Promise<void>((resolve) => { const timer = setTimeout(() => running.kill("SIGKILL"), 5000); running.once("exit", () => { clearTimeout(timer); resolve(); }); running.kill("SIGTERM"); });
}
async function until(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) { try { if (await check()) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); }
  throw new Error(description);
}
const healthy = () => until(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok, "Server did not recover health");
async function counts() { return (await pool.query(`SELECT (SELECT count(*) FROM "Application") AS applications, (SELECT count(*) FROM "Note") AS notes, (SELECT count(*) FROM "StatusEvent") AS events, (SELECT count(*) FROM "DocumentVersion") AS versions`)).rows[0]; }
try {
  start(); await healthy();
  await until(async () => (await pool.query(`SELECT count(*) AS count FROM "MarkdownLink"`)).rows[0].count > 0, "Initial mappings were not created");
  const row = (await pool.query(`SELECT l."applicationId",l.path,p.config FROM "MarkdownLink" l JOIN "MarkdownProfile" p ON p.id=l."profileId" ORDER BY l."applicationId" LIMIT 1`)).rows[0];
  const config = profileSchema.parse(row.config);
  const file = path.join(saved.DOSSIER_NOTES_ROOT, row.path);
  const before = await counts();
  await stop();
  await pool.query(`UPDATE "Application" SET "nextAction"='Restart fixture action',"followUpDate"='2026-11-18',"updatedAt"=now() WHERE id=$1`, [row.applicationId]);
  await writeFile(file, writeNote(await readFile(file, "utf8"), config, { location: "Restart file location" }));
  const jobId = `restart-check-${Date.now()}`;
  await pool.query(`INSERT INTO "Job" (id,type,status,input,"updatedAt") VALUES ($1,'read-posting','RUNNING',$2,now())`, [jobId, JSON.stringify({ posting: "Unfinished synthetic restart input" })]);
  start(); await healthy();
  await until(async () => {
    const application = (await pool.query(`SELECT location FROM "Application" WHERE id=$1`, [row.applicationId])).rows[0];
    const values = parseNote(await readFile(file, "utf8"), config).values;
    return application.location === "Restart file location" && values.nextAction === "Restart fixture action" && values.followUpDate === "2026-11-18";
  }, "Restart did not reconcile independent app/file edits");
  const job = (await pool.query(`SELECT status,error,input FROM "Job" WHERE id=$1`, [jobId])).rows[0];
  if (job.status !== "FAILED" || !job.error.includes("restarted") || job.input.posting !== "Unfinished synthetic restart input") throw new Error("Interrupted job was not exposed as retryable with its input");
  if (JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error("Restart duplicated application/note/history/version records");
  await stop(); start(); await healthy();
  if (JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error("Second startup was not idempotent");
  console.log(JSON.stringify({ verified: "two real process restarts", independentEditsMerged: true, unfinishedInputPreserved: true, interruptedJobRetryable: true, counts: before }));
} finally { await stop(); await pool.end(); }
