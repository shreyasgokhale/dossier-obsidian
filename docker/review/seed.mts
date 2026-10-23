import { execFileSync } from "node:child_process";
import { Pool } from "pg";
const database = "dossier_markdown_e2e";
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [database])).rowCount)
    await admin.query(`CREATE DATABASE "${database}"`);
} finally { await admin.end(); }
const url = new URL(process.env.DATABASE_URL!);
url.pathname = `/${database}`;
const env = { ...process.env, DATABASE_URL: url.toString() };
execFileSync("yarn", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
const db = new Pool({ connectionString: url.toString() });
let empty: boolean;
try { empty = Number((await db.query('SELECT count(*) FROM "Application"')).rows[0].count) === 0; }
finally { await db.end(); }
execFileSync("yarn", ["prisma", "db", "seed", ...(empty ? ["--", "--demo"] : [])], { env, stdio: "inherit" });
