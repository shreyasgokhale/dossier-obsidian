import { readFile, cp } from "node:fs/promises";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
const root = process.argv[2];
if (!root || !path.isAbsolute(root))
  throw new Error(
    "Usage: yarn demo:resume /absolute/path/to/dossier-demo-runtime",
  );
const saved = JSON.parse(
  await readFile(path.join(root, "runtime.env.json"), "utf8"),
) as Record<string, string>;
if (
  !new URL(saved.DATABASE_URL).pathname.startsWith("/dossier_demo_") ||
  saved.DOSSIER_NOTES_ROOT !== path.join(root, "notes")
)
  throw new Error("This is not an isolated Dossier demo runtime.");
const env = { ...process.env, ...saved };
execFileSync("yarn", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
await cp("public", ".next/standalone/public", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
const fake = spawn(process.execPath, ["e2e/fake-ai.mts"], {
  env: { ...env, FAKE_AI_PORT: new URL(saved.DOSSIER_AI_URL).port },
  stdio: "inherit",
});
const app = spawn(process.execPath, [".next/standalone/server.js"], {
  env,
  stdio: "inherit",
});
console.log(
  `Resuming synthetic demo at ${saved.DOSSIER_PUBLIC_URL} (password: demo-password).`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    fake.kill(signal);
    app.kill(signal);
  });
app.on("exit", (code) => {
  fake.kill();
  process.exitCode = code ?? 0;
});
