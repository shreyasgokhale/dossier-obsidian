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
const base = new URL(
  process.env.DEMO_DATABASE_SERVER ??
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
);
const admin = new Pool({ connectionString: base.toString() });
try {
  await admin.query(`CREATE DATABASE "${database}"`);
} finally {
  await admin.end();
}
base.pathname = `/${database}`;
const digestMode = process.argv.includes("--digest");
const jobsPort = Number(process.env.DEMO_JOBS_PORT ?? 3995);
const port = Number(process.env.DEMO_PORT ?? 3200),
  fakePort = Number(process.env.DEMO_AI_PORT ?? 3996);
const env = {
  ...process.env,
  DATABASE_URL: base.toString(),
  DOSSIER_PASSWORD: await hashPassword("demo-password"),
  DOSSIER_SECRET: randomBytes(32).toString("hex"),
  DOSSIER_DATA_DIR: path.join(root, "data"),
  DOSSIER_NOTES_ROOT: path.join(root, "notes"),
  DOSSIER_RESUME_ROOT: path.join(root, "resume"),
  DOSSIER_OBSIDIAN_VAULT: "Dossier Demo",
  DOSSIER_AI_PROVIDER: "openai",
  DOSSIER_AI_URL: `http://127.0.0.1:${fakePort}/v1`,
  DOSSIER_AI_MODEL: "fake-model",
  DOSSIER_AI_KEY: "synthetic-demo-key",
  DOSSIER_TELEMETRY: "off",
  DOSSIER_JOBS_SOURCE: "off",
  ...(digestMode
    ? {
        DOSSIER_JOBS_TEST_BASE_URL: `http://127.0.0.1:${jobsPort}`,
        DOSSIER_UPDATES_TEST_BASE_URL: `http://127.0.0.1:${jobsPort}/github`,
      }
    : {}),
  DOSSIER_PUBLIC_URL: `http://localhost:${port}`,
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
};
await writeFile(
  path.join(root, "runtime.json"),
  JSON.stringify(
    {
      database,
      root,
      port,
      note: "Synthetic demo; retained on exit for inspection. Drop only this database when finished.",
    },
    null,
    2,
  ),
);
// Secrets are stored only in the isolated temporary runtime directory for restart.
await writeFile(
  path.join(root, "runtime.env.json"),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(env).filter(([k]) =>
        /^(DOSSIER_|DATABASE_URL$|PORT$|HOSTNAME$)/.test(k),
      ),
    ),
    null,
    2,
  ),
  { mode: 0o600 },
);
for (const args of [
  ["prisma", "generate"],
  ["prisma", "migrate", "deploy"],
  ["prisma", "db", "seed", "--", "--demo"],
])
  execFileSync("yarn", args, { env, stdio: "inherit" });
if (digestMode) {
  const pool = new Pool({ connectionString: base.toString() });
  const preferences = {
    roles: ["Product Designer"],
    locations: [{ place: "Berlin", country: "de" }],
    remote: "any",
    exclusions: [],
    interests: ["Design systems", "Climate technology"],
    sources: ["ARBEITNOW", "DAILY_BERLIN", "COMPANY_BOARDS"],
    boards: [
      { name: "Demo Greenhouse Studio", provider: "greenhouse", slug: "demo" },
      { name: "Demo Ashby Tools", provider: "ashby", slug: "demo" },
      {
        name: "Demo unavailable board",
        provider: "lever",
        slug: "unavailable",
      },
    ],
  };
  try {
    for (const [key, value] of Object.entries({
      searchPreferences: JSON.stringify(preferences),
      agentEnabled: "true",
      agentHour: "0",
      agentAutoDraft: "false",
      browserTimeZone: "Europe/Berlin",
    }))
      await pool.query(
        'INSERT INTO "Setting" (key,value,"updatedAt") VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        [key, value],
      );
  } finally {
    await pool.end();
  }
}
const jobs = digestMode
  ? spawn(process.execPath, ["e2e/fake-jobs.mts"], {
      env: { ...env, FAKE_JOBS_PORT: String(jobsPort) },
      stdio: "inherit",
    })
  : null;
const fake = spawn(process.execPath, ["e2e/fake-ai.mts"], {
  env: { ...env, FAKE_AI_PORT: String(fakePort) },
  stdio: "inherit",
});
if (process.argv.includes("--production")) {
  await cp("public", ".next/standalone/public", { recursive: true });
  await cp(".next/static", ".next/standalone/.next/static", {
    recursive: true,
  });
}
const app = process.argv.includes("--production")
  ? spawn(process.execPath, [".next/standalone/server.js"], {
      env,
      stdio: "inherit",
    })
  : spawn("yarn", ["dev", "-p", String(port)], { env, stdio: "inherit" });
console.log(
  `\nDemo: http://localhost:${port}\nPassword: demo-password\nRuntime: ${root}\nDatabase: ${database}\nCommitted fixtures remain unchanged.\n`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    fake.kill(signal);
    jobs?.kill(signal);
    app.kill(signal);
  });
app.on("exit", (code) => {
  fake.kill();
  jobs?.kill();
  process.exitCode = code ?? 0;
});
