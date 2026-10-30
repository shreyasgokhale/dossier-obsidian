import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
await mkdir("/review/restart", { recursive: true });
const child = spawn("yarn", ["demo", "--production"], {
  detached: true,
  env: { ...process.env, TMPDIR: "/review/restart", DEMO_PORT: "3201", DEMO_AI_PORT: "3995", DEMO_DATABASE_SERVER: process.env.DATABASE_URL },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (data) => { output += String(data); process.stdout.write(data); });
child.stderr.on("data", (data) => process.stderr.write(data));
const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
let root: string | undefined;
try {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && child.exitCode === null) {
    root = output.match(/Runtime: (\S+)/)?.[1];
    if (root) {
      try { if ((await fetch("http://127.0.0.1:3201/api/health")).ok) break; } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!root || !(await fetch("http://127.0.0.1:3201/api/health")).ok) throw Error("Restart fixture demo did not start");
} finally {
  if (child.pid && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
  await exited;
}
execFileSync("yarn", ["verify:restart", root!], { stdio: "inherit", env: process.env });
