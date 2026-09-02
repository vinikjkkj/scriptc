/* CAN THE PROTOTYPE-CLASS ARM REACH THE SEED TABLE'S SHAPES?
 *
 * The table's three buckets are counted off zapo's decode bodies, and
 * bucket-origin.mjs measured where each bucket's RECEIVER comes from:
 * 641 of 641 readers are an untyped FUNCTION PARAMETER, and 641 of 641
 * message bindings are `var a = <param> || new j.waproto.X`. The arm types
 * the result of `new K(...)` and the bindings that adopt one, so on that
 * measurement it reaches neither.
 *
 * This turns that into a COMPILER measurement instead of a reading. Three
 * programs, each compiled twice (arm off / arm on), with the emitted C's
 * seed call sites counted both times:
 *
 *   PARAM   the decode shape: the reader arrives as a parameter    -> expect no change
 *   NSNEW   the message shape: `new <namespace member>()`          -> expect no change
 *   LOCAL   a POSITIVE CONTROL: the same methods, same calls, but the
 *           instance is `new`-constructed in the body that uses it  -> expect a change
 *
 * The positive control is the whole point: an instrument that reports "no
 * change" for two shapes has to be shown reporting a change for one, or the
 * zeros are the instrument's.
 *
 * usage: node_modules/.bin/tsx tests/perf/dynpath/arm-reach.mts <outRoot> [c|llvm]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "../../../packages/compiler/src/index.js";

const OUT = process.argv[2]!;
const BACKEND = (process.argv[3] ?? "c") as "c" | "llvm";

/** The reader, spelled exactly as a minifier leaves a class: a plain
 * constructor plus prototype methods. */
const READER =
  "function R(b) { this.buf = b; this.pos = 0; this.len = b.length }\n" +
  "R.prototype.tag = function () { return this.buf[this.pos++] }\n" +
  "R.prototype.uint32 = function () { return this.buf[this.pos++] }\n";

/** Twelve reads/calls on the receiver, so a seed count has room to move. */
const WORK = (recv: string): string =>
  `var s = 0\n` +
  `while (${recv}.pos < ${recv}.len) {\n` +
  `  var c = ${recv}.tag()\n` +
  `  if (c === 1) s += ${recv}.uint32()\n` +
  `  else if (c === 2) s += ${recv}.uint32() * 2\n` +
  `  else s += ${recv}.uint32() * 3\n` +
  `}\n`;

const PROGRAMS: Record<string, string> = {
  // THE DECODE SHAPE. `decode(e)` takes the reader as an untyped parameter,
  // which is what 641 of 641 of zapo's decode bodies do.
  param:
    READER +
    "function decode(e) {\n" + WORK("e") + "  return s\n}\n" +
    "console.log(String(decode(new R([1, 5, 2, 6, 3, 7]))))\n",
  // THE MESSAGE SHAPE. The construction names a NAMESPACE MEMBER, not an
  // identifier, and the binding is a `||` union with a parameter.
  nsnew:
    READER +
    "function M() { this.a = 0; this.b = 0 }\n" +
    "M.prototype.add = function (n) { this.a += n; return this }\n" +
    "var NS = { M: M }\n" +
    "function decode(e, r) {\n" +
    "  var a = r || new NS.M()\n" + WORK("e") +
    "  a.add(s)\n  return a.a\n}\n" +
    "console.log(String(decode(new R([1, 5, 2, 6, 3, 7]), null)))\n",
  // THE POSITIVE CONTROL THAT HAS TO WORK. A `const` binding takes its type
  // from the LOWERED INITIALIZER; a `var` slot is decided at HOIST, before any
  // initializer has lowered, so only this spelling can adopt the class.
  constlocal:
    READER +
    "function decode(bytes) {\n  const e = new R(bytes)\n" + WORK("e") + "  return s\n}\n" +
    "console.log(String(decode([1, 5, 2, 6, 3, 7])))\n",
  // The same body with `var`, which is what a minified bundle spells.
  local:
    READER +
    "function decode(bytes) {\n  var e = new R(bytes)\n" + WORK("e") + "  return s\n}\n" +
    "console.log(String(decode([1, 5, 2, 6, 3, 7])))\n",
};

const SEEDS: Record<string, RegExp> = {
  dynInvoke: /\bscr_dyn_invoke\s*\(/g,
  dynKeyGet: /\bscr_dyn_key_get\s*\(/g,
  dynKeySet: /\bscr_dyn_key_set\s*\(/g,
  dynCall: /\bscr_dyn_call\s*\(/g,
  dynCheck: /\bscr_dyn_check[a-z_]*\s*\(/g,
};

async function measure(name: string, src: string, arm: boolean): Promise<Record<string, number> & { bytes: number; ok: boolean; out: string }> {
  const dir = join(OUT, `${name}-${arm ? "on" : "off"}-${BACKEND}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "main.js");
  writeFileSync(file, src, "utf8");
  const prev = process.env["SCRIPTC_PROTOCLASS"];
  if (arm) process.env["SCRIPTC_PROTOCLASS"] = "1";
  else delete process.env["SCRIPTC_PROTOCLASS"];
  let res;
  try {
    res = await compile(file, { outPath: join(dir, "program.exe"), outDir: dir, backend: BACKEND });
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_PROTOCLASS"];
    else process.env["SCRIPTC_PROTOCLASS"] = prev;
  }
  const row: Record<string, number> & { bytes: number; ok: boolean; out: string } =
    { bytes: 0, ok: res.ok, out: "" } as never;
  if (!res.ok) return row;
  const files = [res.cPath!, ...(res.cPathParts ?? [])];
  let text = "";
  for (const f of files) text += readFileSync(f, "utf8");
  row.bytes = Buffer.byteLength(text, "utf8");
  for (const [k, re] of Object.entries(SEEDS)) row[k] = text.match(re)?.length ?? 0;
  row.out = execFileSync(join(dir, "program.exe"), [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return row;
}

console.log(`backend=${BACKEND}  emitted-C seed call sites, arm off vs arm ON`);
for (const [name, src] of Object.entries(PROGRAMS)) {
  const oracle = (() => {
    const dir = join(OUT, `${name}-oracle`);
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "main.js");
    writeFileSync(f, src, "utf8");
    return execFileSync(process.execPath, [f], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  })();
  const off = await measure(name, src, false);
  const on = await measure(name, src, true);
  console.log(`\n${name}  oracle ${JSON.stringify(oracle)}`);
  if (!off.ok || !on.ok) { console.log("  NOBUILD off=" + String(off.ok) + " on=" + String(on.ok)); continue; }
  console.log(`  answers: off ${JSON.stringify(off.out)}  on ${JSON.stringify(on.out)}  ` +
    `${off.out === oracle && on.out === oracle ? "BOTH MATCH node" : "*** A DIVERGENCE ***"}`);
  let toff = 0, ton = 0;
  for (const k of Object.keys(SEEDS)) {
    toff += off[k]!; ton += on[k]!;
    console.log(`  ${k.padEnd(10)} off ${String(off[k]).padStart(4)}   on ${String(on[k]).padStart(4)}   delta ${String(on[k]! - off[k]!).padStart(4)}`);
  }
  console.log(`  ${"TOTAL".padEnd(10)} off ${String(toff).padStart(4)}   on ${String(ton).padStart(4)}   delta ${String(ton - toff).padStart(4)}`);
  console.log(`  emitted C  off ${off.bytes} B   on ${on.bytes} B   delta ${on.bytes - off.bytes} B`);
}
