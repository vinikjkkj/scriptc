/* ladder-storearms.mjs — rung 2 of the messaging-bench ladder.
 *
 * `_store-factory.ts` reads ZAPO_BENCH_STORE and DEFAULTS TO 'memory'.
 * Every scenario bench takes that default, so at RUN TIME none of them
 * opens a database. At COMPILE time all five non-default arms are in the
 * program anyway, because each is an `await import('@zapo-js/store-…')`
 * inside an untaken branch of a statically-imported module — and those
 * five imports drag mongodb's, pg's, mysql2's and ioredis's whole source
 * in behind them.
 *
 * This rewrites FOUR function bodies in a COPY of zapo's tree — postgres,
 * mysql, redis, mongo — to a throw. It keeps sqlite, which is already in
 * the static lane. zapo itself is never modified; this is a measurement
 * rung, and the number it produces is labelled as one. What it answers is
 * the question the preflight wall has been hiding: with the four arms out,
 * what does the bench ITSELF refuse?
 *
 *   argv[2]  the bench directory to patch IN PLACE
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (dir === undefined) {
  console.error("usage: ladder-storearms.mjs <bench-dir>");
  process.exit(2);
}
const file = join(dir, "_store-factory.ts");
const text = readFileSync(file, "utf8");
if (text.includes("\r")) {
  console.error("ladder-storearms.mjs: CRLF in _store-factory.ts; refusing to rewrite line endings");
  process.exit(3);
}
const lines = text.split("\n");

const ARMS = (process.env.LADDER_ARMS ?? "Postgres,Mysql,Redis,Mongo").split(",");
let patched = 0;
for (const arm of ARMS) {
  const head = `async function build${arm}Store(): Promise<BenchStoreFixture> {`;
  const start = lines.findIndex((l) => l === head);
  if (start < 0) {
    console.error(`ladder-storearms.mjs: no ${head}`);
    process.exit(4);
  }
  // The closing brace of a top-level function is the next line that is
  // exactly "}" in column 0.
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === "}") {
      end = i;
      break;
    }
  }
  if (end < 0) {
    console.error(`ladder-storearms.mjs: no terminator for ${arm}`);
    process.exit(5);
  }
  lines.splice(start, end - start + 1, head, `    throw new Error('${arm} arm removed for the static-lane ladder')`, "}");
  patched++;
}
if (patched !== ARMS.length) {
  console.error("ladder-storearms.mjs: patched " + patched + " of " + ARMS.length);
  process.exit(6);
}
const out = lines.join("\n");
// Self-test: the four dynamic specifiers the arms carried must be GONE,
// and sqlite's must remain. A patch that reports success without changing
// the program is the failure mode this whole fleet keeps paying for.
const SPECS = { Postgres: ["@zapo-js/store-postgres", "'pg'"], Mysql: ["@zapo-js/store-mysql", "mysql2/promise"], Redis: ["@zapo-js/store-redis", "'ioredis'"], Mongo: ["@zapo-js/store-mongo", "'mongodb'"] };
for (const spec of ARMS.flatMap((a) => SPECS[a])) {
  if (out.includes(spec)) {
    console.error(`ladder-storearms.mjs: ${spec} still present after patch`);
    process.exit(7);
  }
}
if (!out.includes("@zapo-js/store-sqlite")) {
  console.error("ladder-storearms.mjs: sqlite arm was removed too; that is not this rung");
  process.exit(8);
}
if (out.length >= text.length) {
  console.error("ladder-storearms.mjs: file did not shrink; nothing was removed");
  process.exit(9);
}
writeFileSync(file, out);
console.log(
  `patched ${patched} arms in ${file}: ${text.split("\n").length} lines -> ${lines.length} lines`,
);
