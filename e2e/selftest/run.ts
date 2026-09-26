/**
 * pnpm e2e:selftest — boots the fake stack on 5001–5003, runs the real E2E suite
 * against it N times, and shuts it down. Green here means the TESTS are sound; only
 * then does a red run against the real services mean a service bug.
 */
import { spawn, spawnSync } from "node:child_process";

const runs = Number(process.argv[2] ?? 1);
const fake = spawn("tsx", ["selftest/fake-stack.ts"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((resolve, reject) => {
  fake.stdout.on("data", (d: Buffer) => d.toString().includes("fake stack up") && resolve());
  fake.on("exit", (c) => reject(new Error(`fake stack exited (${c})`)));
});
const env = { ...process.env, VOICE_URL: "http://localhost:5001", MONEY_URL: "http://localhost:5002", FAMILY_URL: "http://localhost:5003" };
let code = 0;
for (let i = 1; i <= runs && code === 0; i++) {
  console.log(`\n━━━ selftest run ${i}/${runs} ━━━`);
  code = spawnSync("vitest", ["run"], { stdio: "inherit", env }).status ?? 1;
}
fake.kill();
process.exit(code);
