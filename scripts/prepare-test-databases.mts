import "dotenv/config";
import { Pool } from "pg";
const base = new URL(
  process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/dossier",
);
const names = [
  `${base.pathname.slice(1)}_test`,
  `${base.pathname.slice(1)}_e2e`,
  "dossier_markdown_e2e",
];
base.pathname = "/postgres";
const pool = new Pool({ connectionString: base.toString() });
try {
  for (const name of names) {
    if (!/^\w+_(test|e2e)$/.test(name))
      throw new Error("Only disposable test database names are accepted.");
    if (
      (await pool.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
        .rowCount === 0
    )
      await pool.query(`CREATE DATABASE "${name}"`);
  }
} finally {
  await pool.end();
}
