// fs/promises resolve from the threadpool's completion, in the poll phase:
// the synchronous run, the nextTick queue and the promise jobs come BEFORE
// the result of an fs/promises call, whatever the order the calls were made
// in. The runtime used to hand back an already-settled promise, so the
// continuation ran in the first microtask checkpoint, ahead of ticks and
// promise jobs queued after the call. Each completion also gets its own
// checkpoint, and a rejection settles from the same station and stays
// catchable at the await. The file is a scratch path derived from argv[1]
// (the Node and native sides run side by side).
import { rmSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const file = "tmp-26074-" + tail(process.argv[1]);
const log: string[] = [];

async function main(): Promise<void> {
  const w = writeFile(file, "pool").then(() => log.push("written"));
  process.nextTick(() => log.push("tick"));
  Promise.resolve().then(() => log.push("micro"));
  log.push("sync");
  await w;
  log.push("after-write");

  const r = readFile(file, "utf8").then((t) => log.push("read " + t));
  Promise.resolve().then(() => log.push("micro2"));
  process.nextTick(() => log.push("tick2"));
  await r;

  // Two concurrent completions: each continuation gets its own checkpoint,
  // so (r1 tick micro) and (r2 tick micro) never interleave their halves.
  const one = stat(file).then(() => {
    log.push("s");
    process.nextTick(() => log.push("t"));
    Promise.resolve().then(() => log.push("m"));
  });
  const two = stat(file).then(() => {
    log.push("s");
    process.nextTick(() => log.push("t"));
    Promise.resolve().then(() => log.push("m"));
  });
  await Promise.all([one, two]);

  try {
    await readFile(file + ".missing", "utf8");
    log.push("no-throw");
  } catch (e) {
    log.push("rejected " + (e as Error & { code?: string }).code);
  }
  rmSync(file);
}

main().then(() => {
  console.log(log.join("\n"));
});
