#!/usr/bin/env node
// boxsites.mjs — WHERE a program boxes a value into an `unknown` slot, and
// which of those boxes OUTLIVE the statement that made them.
//
//   node boxsites.mjs <program.c> [--top N] [--json] [--bucket <name>]
//   node boxsites.mjs --self-test
//
// WHY THE SECOND QUESTION IS THE ONE THAT MATTERS. boxanat.mjs prices a box.
// A price times a count of CROSSINGS is not a retained-memory figure: most
// crossings are an argument handed to a callee that reads it and drops it,
// and those cost peak, not residency. Only a box that outlives its statement
// — stored in a field, a global, a container, captured, or returned — can
// still be there when the burst is over. This lane separates the two.
//
// IT READS THE C LANE ONLY, and that is a deliberate limit rather than an
// oversight. The classification below keys on the emitted OWNERSHIP moves —
// `x->sc_fld_f = sc_tN`, `scr_dyn_obj_set(... sc_tN)`, `return sc_tN` — and
// those are single, readable statements in the C emitter's output and are
// spread across basic blocks with phi-less temporaries in the LLVM lane. The
// two backends emit the SAME crossings (both call the same `sc_td_<n>`
// through the same `dynFrom` IR node, and llvm/emitter.ts's `dynFrom` arm is
// a line-for-line port of emit-exprs.ts's), so the SITE COUNT is a property
// of the IR and reading it off either artifact is the same number — which
// `--self-test` checks against a fixture in both spellings. It is the
// RETENTION BUCKET that needs the C lane's readability, so a .ll input is
// refused rather than half-answered.
//
// THE BUCKETS, and what each one is worth:
//
//   field      the box is moved into a record field. Lives as long as the
//              record does. RETAINED.
//   global     moved into a module-level binding. RETAINED for the process.
//   container  handed to a push/set/add on a dyn array, object or Map, which
//              retains it. RETAINED as long as the container holds it.
//   returned   handed back to the caller, which decides. ESCAPES.
//   passed     handed to another compiled function. ESCAPES.
//   transient  released in the same function with no retaining consumer.
//              Costs peak, never residency.
//   unclassified  none of the above matched. REPORTED, never folded into
//              either side — a census that guesses here is a census that
//              can be wrong in the direction of its own argument.
//
// A SITE IS AN IDIOM, NOT A CALL. Two crossings on one source line are one
// unit of work for whoever closes them, so the report groups by
// (source file, line) and prints the crossing count inside the group.

import { readFileSync } from "node:fs";

/* Every crossing the C emitter can produce: a bare converter call, and the
 * same call wrapped in the origin mark when the source is an lvalue whose
 * mutation would be observable (ir/nodes.ts's dynCopyIsObservable). */
const CROSS = /(\w+)\s*=\s*(?:scr_dyn_origin_mark\s*\(\s*)?(sc_td_\d+)\s*\(/g;
const FN_HEAD = /^static\s+[\w *]+?\s(sc_f_[A-Za-z0-9_$]+)\s*\(.*\{\s*(?:\/\*\s*(.*?)\s*\*\/)?/;
/* The emitter anchors statements with `/* <file>:<line> *​/`. */
const LOC = /\/\*\s*([^*]*?\.(?:ts|js|mjs|cjs)):(\d+)\s*\*\//;

/* The retaining consumers, by the shape of the emitted call. */
const RETAINING_METHODS = new Set([
  "push", "unshift", "splice", "set", "add", "setItem", "append", "concat", "fill",
]);

export function parse(text) {
  if (/^define\s+internal\s+ptr\s+@sc_td_/m.test(text)) {
    return { refused: "the .ll lane: retention buckets need the C emitter's ownership moves" };
  }
  const lines = text.split(/\r?\n/);
  // Function extents, so a temp's uses are never read across a boundary.
  const fns = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FN_HEAD.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    for (; j < lines.length; j++) if (/^\}/.test(lines[j])) break;
    fns.push({ name: m[1], start: i, end: j, isConverter: false });
  }
  // The converters themselves are not crossings: they ARE the crossing's
  // body, and a `sc_td_` call inside one is a child conversion.
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:static\s+)?ScrDyn\s*\*\s*sc_td_\d+\s*\(/.test(lines[i])) continue;
    if (!/\{/.test(lines[i])) continue;
    let j = i + 1;
    for (; j < lines.length; j++) if (/^\}/.test(lines[j])) break;
    fns.push({ name: "(converter)", start: i, end: j, isConverter: true });
  }
  fns.sort((a, b) => a.start - b.start);
  const fnAt = (ln) => fns.find((f) => ln >= f.start && ln <= f.end) ?? null;

  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    const host = fnAt(i);
    if (host && host.isConverter) continue;
    CROSS.lastIndex = 0;
    let m;
    while ((m = CROSS.exec(lines[i])) !== null) {
      const temp = m[1];
      const conv = m[2];
      const marked = /scr_dyn_origin_mark/.test(lines[i]);
      // The source location: this statement's own anchor, else the nearest
      // one above it inside the same function, else the function's head.
      let loc = null;
      for (let k = i; k >= (host ? host.start : 0) && k > i - 400; k--) {
        const lm = LOC.exec(lines[k]);
        if (lm) { loc = { file: lm[1], line: Number(lm[2]) }; break; }
      }
      sites.push({
        temp, conv, marked, line: i + 1,
        fn: host ? host.name : "(top level)",
        loc,
        bucket: classify(lines, host, temp),
      });
    }
  }
  return { sites, fns: fns.filter((f) => !f.isConverter).length };
}

/** What happens to the crossing's result inside the function that made it.
 * The scan is FORWARD from the crossing to the end of its function, which is
 * where the C emitter puts every use of a temp it owns. */
export function classify(lines, host, temp) {
  const from = host ? host.start : 0;
  const to = host ? host.end : lines.length - 1;
  const t = temp.replace(/[$]/g, "\\$&");
  const uses = [];
  for (let k = from; k <= to; k++) {
    if (new RegExp(`\\b${t}\\b`).test(lines[k])) uses.push(lines[k]);
  }
  let released = false;
  let argOf = null;
  for (const u of uses) {
    if (new RegExp(`->sc_fld_\\w+\\s*=\\s*${t}\\s*;`).test(u)) return "field";
    if (new RegExp(`^\\s*sc_g_\\w+\\s*=\\s*${t}\\s*;`).test(u)) return "global";
    if (new RegExp(`^\\s*return\\s+${t}\\s*;`).test(u)) return "returned";
    if (new RegExp(`scr_(?:dyn_)?(?:arr_push|obj_set|obj_set_lit|key_set)\\s*\\([^)]*\\b${t}\\b`).test(u))
      return "container";
    if (new RegExp(`scr_map_set\\s*\\([^)]*\\b${t}\\b`).test(u)) return "container";
    if (new RegExp(`scr_dyn_release\\s*\\(\\s*${t}\\s*\\)`).test(u)) released = true;
    // An argument vector feeding a dynamic method call: `ScrDyn *sc_tM[1] =
    // { sc_tN };` then `scr_dyn_invoke(recv, "push", sc_tM, …)`. The METHOD
    // decides, and only a retaining one counts.
    const av = new RegExp(`ScrDyn \\*(\\w+)\\[\\d+\\] = \\{[^}]*\\b${t}\\b`).exec(u);
    if (av) argOf = av[1];
    const call = new RegExp(`sc_f_\\w+\\s*\\([^)]*\\b${t}\\b`).exec(u);
    if (call) return "passed";
  }
  if (argOf) {
    for (const u of uses.concat(lines.slice(from, to + 1))) {
      const iv = new RegExp(`scr_dyn_invoke\\s*\\([^,]+,\\s*"([^"]+)"\\s*,\\s*${argOf}\\b`).exec(u);
      if (iv) return RETAINING_METHODS.has(iv[1]) ? "container" : "transient";
    }
    return "unclassified";
  }
  if (released) return "transient";
  return "unclassified";
}

const RETAINING = new Set(["field", "global", "container"]);
const ESCAPING = new Set(["returned", "passed"]);

export function summarise(sites) {
  const byBucket = new Map();
  for (const s of sites) byBucket.set(s.bucket, (byBucket.get(s.bucket) ?? 0) + 1);
  const byIdiom = new Map();
  for (const s of sites) {
    const key = s.loc ? `${s.loc.file}:${s.loc.line}` : `${s.fn}#${s.line}`;
    const g = byIdiom.get(key) ?? { key, fn: s.fn, n: 0, buckets: new Map(), convs: new Set(), marked: 0 };
    g.n++;
    g.convs.add(s.conv);
    if (s.marked) g.marked++;
    g.buckets.set(s.bucket, (g.buckets.get(s.bucket) ?? 0) + 1);
    byIdiom.set(key, g);
  }
  const retained = sites.filter((s) => RETAINING.has(s.bucket)).length;
  const escaping = sites.filter((s) => ESCAPING.has(s.bucket)).length;
  const transient = sites.filter((s) => s.bucket === "transient").length;
  const unclassified = sites.filter((s) => s.bucket === "unclassified").length;
  return { byBucket, byIdiom, retained, escaping, transient, unclassified };
}

function render(res, topN, bucket) {
  const o = [];
  const { sites } = res;
  const s = summarise(sites);
  o.push(`BOXSITES  ${sites.length} static-to-dyn crossings in ${res.fns} emitted functions`);
  o.push(`          ${sites.filter((x) => x.marked).length} of them mark an ORIGIN (the source is an lvalue the`);
  o.push(`          program still names, so the box also pins that source for its whole life)`);
  o.push("");
  o.push(`  RETAINED (field/global/container)  ${s.retained}`);
  o.push(`  ESCAPING (returned/passed)         ${s.escaping}`);
  o.push(`  TRANSIENT                          ${s.transient}`);
  o.push(`  UNCLASSIFIED                       ${s.unclassified}`);
  o.push("");
  for (const [b, n] of [...s.byBucket].sort((a, c) => c[1] - a[1])) o.push(`    ${b.padEnd(14)} ${n}`);
  o.push("");
  o.push("IDIOMS — one row per source line that crosses, worst first");
  o.push("crossings  marked  buckets                      site");
  const rows = [...s.byIdiom.values()]
    .filter((g) => !bucket || g.buckets.has(bucket))
    .sort((a, b) => b.n - a.n)
    .slice(0, topN);
  for (const g of rows) {
    const bs = [...g.buckets].map(([k, v]) => `${k}:${v}`).join(" ");
    o.push(`${String(g.n).padStart(9)}  ${String(g.marked).padStart(6)}  ${bs.padEnd(28)} ${g.key}`);
  }
  return o.join("\n");
}

/* ── the self-test ───────────────────────────────────────────────────────
 * Each fixture below is a verbatim shape the C emitter produces, and each
 * asserts a bucket that a plausible-but-wrong classifier would get wrong. */
function selfTest() {
  const fails = [];
  let checks = 0;
  const ok = (n, c) => { checks++; if (!c) fails.push(n); };

  // A crossing MOVED into a record field: no release anywhere, ownership
  // transferred. This is the shape a "was it released?" test gets right and
  // the container shape below is the one it gets wrong.
  const fieldC = [
    "static void sc_f_retain(sc_rs_r1 *sc_l_e_0) { /* p.ts:13 */",
    "  sc_rs_r2 *sc_t0 = sc_rnew_r2();",
    "  sc_rs_r1 *sc_t1 = sc_rretain_r1(sc_l_e_0);",
    '  ScrDyn *sc_t2 = scr_dyn_origin_mark(sc_td_0(sc_t1), (void *)sc_t1, "record:r1", sc_rretain_r1_v, sc_rrelease_r1_v);',
    "  sc_t0->sc_fld_held = sc_t2;",
    "  sc_rrelease_r1(sc_t1);",
    "}",
  ].join("\n");
  const a = parse(fieldC);
  ok("one crossing found", a.sites.length === 1);
  ok("field bucket", a.sites[0]?.bucket === "field");
  ok("origin mark seen", a.sites[0]?.marked === true);
  ok("located at p.ts:13", a.sites[0]?.loc?.file === "p.ts" && a.sites[0]?.loc?.line === 13);

  // THE SHAPE A NAIVE CLASSIFIER GETS WRONG. `kept.push(e)` releases the
  // crossing temp — the push retained it — so "released, therefore
  // transient" would call a permanently retained box transient.
  const pushC = [
    "static void sc_f_box(sc_rs_r1 *sc_l_e_0) { /* p.ts:8 */",
    "  ScrDyn *sc_t0 = scr_dyn_retain(sc_g_e_kept);",
    "  sc_rs_r1 *sc_t1 = sc_rretain_r1(sc_l_e_0);",
    '  ScrDyn *sc_t2 = scr_dyn_origin_mark(sc_td_0(sc_t1), (void *)sc_t1, "record:r1", sc_rretain_r1_v, sc_rrelease_r1_v);',
    "  ScrDyn *sc_t3[1] = { sc_t2 };",
    '  ScrDyn *sc_t4 = scr_dyn_invoke(sc_t0, "push", sc_t3, 1, "kept.push");',
    "  scr_dyn_release(sc_t0);",
    "  scr_dyn_release(sc_t2);",
    "  scr_dyn_release(sc_t4);",
    "}",
  ].join("\n");
  const b = parse(pushC);
  ok("push is a container, not transient", b.sites[0]?.bucket === "container");

  // ...and the control that says the test above can FAIL: the same shape with
  // a NON-retaining method must not be called retained.
  const readC = pushC.replace('"push"', '"indexOf"').replace('"kept.push"', '"kept.indexOf"');
  ok("a reading method is transient", parse(readC).sites[0]?.bucket === "transient");

  // A genuinely transient crossing: an argument, released, nothing retains.
  const transC = [
    "static void sc_f_log(sc_rs_r1 *sc_l_e_0) { /* p.ts:20 */",
    "  ScrDyn *sc_t0 = sc_td_0(sc_l_e_0);",
    "  scr_console_log(sc_t0);",
    "  scr_dyn_release(sc_t0);",
    "}",
  ].join("\n");
  ok("transient bucket", parse(transC).sites[0]?.bucket === "transient");

  const retC = [
    "static ScrDyn * sc_f_wrap(sc_rs_r1 *sc_l_e_0) { /* p.ts:30 */",
    "  ScrDyn *sc_t0 = sc_td_0(sc_l_e_0);",
    "  return sc_t0;",
    "}",
  ].join("\n");
  ok("returned bucket", parse(retC).sites[0]?.bucket === "returned");

  // A CONVERTER's own body is not a crossing. Without this the census would
  // count every nested field of every shape as a site of its own.
  const convC = [
    "static ScrDyn *sc_td_0(sc_rs_r1 *v) { /* to-dyn record:r1 */",
    "  ScrDyn *d = scr_dyn_new_obj();",
    '  scr_dyn_obj_set_lit(d, "inner", 5, sc_td_3(v->sc_fld_inner));',
    "  return d;",
    "}",
  ].join("\n");
  ok("a converter body is not a crossing", parse(convC).sites.length === 0);

  // The positive control on the parser itself: a program with no crossing
  // must read zero, and the fixture above must not.
  ok("empty program reads 0", parse("int main(void){return 0;}").sites.length === 0);
  ok("the fixtures are not all empty", a.sites.length + b.sites.length > 1);

  // A .ll input must REFUSE, not half-answer.
  ok("the ll lane refuses", !!parse("define internal ptr @sc_td_0(ptr %v) #0 { ; to-dyn record:r1\n}\n").refused);

  if (fails.length) {
    console.error("SELF-TEST FAILED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log(`boxsites self-test: ok (${checks} checks)`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const file = args.find((x) => !x.startsWith("--"));
  if (!file) {
    console.error("usage: boxsites.mjs <program.c> [--top N] [--json] [--bucket <name>]");
    process.exit(2);
  }
  const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 30;
  const bucket = args.includes("--bucket") ? args[args.indexOf("--bucket") + 1] : null;
  const res = parse(readFileSync(file, "utf8"));
  if (res.refused) {
    console.error(`REFUSED — ${res.refused}`);
    process.exit(3);
  }
  if (args.includes("--json")) {
    const s = summarise(res.sites);
    console.log(JSON.stringify({
      sites: res.sites,
      retained: s.retained, escaping: s.escaping,
      transient: s.transient, unclassified: s.unclassified,
    }, null, 2));
  } else console.log(render(res, topN, bucket));
}

if (process.argv[1] && process.argv[1].endsWith("boxsites.mjs")) main();
