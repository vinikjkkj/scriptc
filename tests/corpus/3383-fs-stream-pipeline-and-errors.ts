// pipe / pipeline / for-await over fs streams, and the failure contract:
// a missing file is an 'error' EVENT on a later turn, never a throw at the
// createReadStream call — so pipeline REJECTS instead of exploding.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") i = i - 1;
  return path.slice(i + 1);
}
function freshDir(dir: string): void {
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) rmSync(dir + "/" + name);
    rmdirSync(dir);
  }
  mkdirSync(dir);
}
const scratch = "tmp-3383-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
const viaPipe = scratch + "/pipe.bin";
const viaPipeline = scratch + "/pipeline.bin";

const payload = Buffer.alloc(90000);
for (let i = 0; i < payload.length; i = i + 1) payload[i] = (i * 131 + 7) % 256;
writeFileSync(src, payload);

// pipe()
await new Promise<void>((res) => {
  const dst = createWriteStream(viaPipe);
  dst.on("close", () => res());
  createReadStream(src).pipe(dst);
});
console.log("pipe equal", Buffer.compare(readFileSync(src), readFileSync(viaPipe)) === 0);

// pipeline()
await pipeline(createReadStream(src), createWriteStream(viaPipeline));
console.log("pipeline equal", Buffer.compare(readFileSync(src), readFileSync(viaPipeline)) === 0);

// for await
let seen = 0;
let chunks = 0;
for await (const c of createReadStream(src)) {
  seen = seen + (c as Buffer).length;
  chunks = chunks + 1;
}
console.log("for-await", seen, chunks);

// A missing source: the event, not a throw.
const missing = scratch + "/nope.bin";
let threw = false;
let msg = "";
try {
  const bad = createReadStream(missing);
  bad.on("error", (e: Error) => { msg = e.message.split(":")[0] ?? "?"; });
  await new Promise<void>((res) => { bad.on("close", () => res()); });
} catch {
  threw = true;
}
console.log("missing threw", threw, "event", msg);

// ... and the pipeline over it rejects with the same error.
let rejected = "";
try {
  await pipeline(createReadStream(missing), createWriteStream(scratch + "/never.bin"));
} catch (e) {
  rejected = e instanceof Error ? (e.message.split(":")[0] ?? "?") : "?";
}
console.log("pipeline rejected", rejected);

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
