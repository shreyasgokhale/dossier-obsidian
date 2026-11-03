// Run once inside the checks image with the remote deployment directory mounted
// at /provision. Generated credentials never pass through stdout or the client.
import { argon2, randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const tag = process.argv[2];
if (!/^[a-f0-9]{12}$/.test(tag ?? "")) throw new Error("Expected feature commit tag");
for (const name of [".env", "login-password"]) {
  try {
    await access(`/provision/${name}`);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  throw new Error(`Refusing to replace existing ${name}`);
}
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16);
const hash = await promisify(argon2)("argon2id", {
  message: password, nonce: salt, memory: 19456, passes: 2,
  parallelism: 1, tagLength: 32,
});
const values = {
  DOSSIER_IMAGE: `nimbus-dossier-obsidian:${tag}`,
  DOSSIER_CHECKS_IMAGE: `nimbus-dossier-obsidian-checks:${tag}`,
  POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
  DOSSIER_PASSWORD: `argon2id:m=19456,t=2,p=1:${salt.toString("base64url")}:${hash.toString("base64url")}`,
  DOSSIER_SECRET: randomBytes(32).toString("hex"),
};
await writeFile("/provision/login-password", `${password}\n`, { flag: "wx", mode: 0o600 });
await writeFile("/provision/.env", Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(""), {
  flag: "wx", mode: 0o600,
});
console.log("Fresh runtime configuration created; credentials remain on Nimbus.");
