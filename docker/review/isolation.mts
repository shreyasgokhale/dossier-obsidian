import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
async function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
assert.equal(process.getuid?.(), 1000);
for (const location of ["/Users", "/host", "/var/run/docker.sock", "/run/docker.sock", "/app/.env", "/app/.git"])
  assert.equal(existsSync(location), false, `Unexpected host/private path: ${location}`);
const status = readFileSync("/proc/self/status", "utf8");
assert.match(status, /CapEff:\s+0+\n/);
assert.match(status, /CapBnd:\s+0+\n/);
assert.match(status, /NoNewPrivs:\s+1/);
assert.equal(await connects("127.0.0.1", 5432), true, "Synthetic database unavailable");
// Literal IPs avoid relying on DNS failure as evidence of blocked networking.
for (const host of ["1.1.1.1", "192.168.1.1", "10.0.0.1", "169.254.169.254"])
  assert.equal(await connects(host, 443), false, `Outbound access allowed: ${host}`);
for (const line of readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1)) {
  const fields = line.trim().split(/\s+/);
  const gateway = fields[2];
  if (gateway && gateway !== "00000000") {
    const host = gateway.match(/../g)!.reverse().map(v => parseInt(v, 16)).join(".");
    assert.equal(await connects(host, 443), false, "Host gateway reachable");
  }
}
console.log("PASS: non-root, zero capabilities, no host/private paths, synthetic DB accessible, outbound host/LAN/internet blocked.");
