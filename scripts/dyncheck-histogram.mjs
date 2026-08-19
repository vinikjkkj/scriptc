// dyncheck-histogram.mjs — classify EVERY `scr_dyn_check_fail` statement in an
// emitted scriptc C translation unit by the emitter line that planted it.
//
// WHY this instrument and not a grep: the census (scripts/tu-census.mjs)
// reports one number, DYNCHECK, and that number has been read as "N places in
// the program where the compiler planted a trap".  It is not.  Every one of
// those statements lives inside an INTERNED per-target-type validator,
// `static T sc_dc_<n>(const ScrDyn *d, const ScrDynPath *path)`, minted once
// per distinct dynCheck TARGET TYPE by emit-walkers.ts `dynCheckHelper`.  A
// record target with 40 fields contributes 41 statements on its own, and the
// program may call it from one place or from a thousand.  So the population
// has TWO units and they are not proportional:
//
//   STATEMENTS   what the census counts.  Driven by the SET of interned
//                target types and by their field/arm widths.
//   CALL SITES   `sc_dc_<n>(` appearing OUTSIDE any walker body.  Driven by
//                how often the program crosses the dyn->static boundary.
//
// This script reports both, plus the shape histogram, and it self-tests:
// every `scr_dyn_check_fail` occurrence must land in exactly one bucket and
// inside exactly one known helper, or the process exits 3.
//
// usage: node scripts/dyncheck-histogram.mjs <tu.c> [--json <out>] [--quiet]
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args[0];
if (!file || file.startsWith("-")) {
  console.error("usage: node scripts/dyncheck-histogram.mjs <tu.c> [--json <out>] [--quiet]");
  process.exit(2);
}
const jsonOut = (() => { const i = args.indexOf("--json"); return i >= 0 ? args[i + 1] : null; })();
const quiet = args.includes("--quiet");

// latin1: bytes, never re-encoded — the emitted TU mixes escaped and raw UTF-8.
const raw = readFileSync(file, "latin1");
const lines = raw.split("\n");

let exitCode = 0;
const problems = [];
const fail = (why) => { problems.push(why); exitCode = 3; };

// ---------------------------------------------------------------- 1. helpers
// `static <ctype> sc_dc_<n>(const ScrDyn *d, const ScrDynPath *path) { /* check <key> */`
// The DEFINITION carries `{` on the same line; the PROTOTYPE ends in `;`.
const HELPER_DEF = /^static\s+.*?\bsc_dc_(\d+)\(const ScrDyn \*d, const ScrDynPath \*path\)\s*\{\s*\/\* check (.*) \*\/\s*$/;
const helpers = new Map();          // name -> { key, first, last, stmts: [] }
const ownerOfLine = new Array(lines.length).fill(null);
{
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (cur === null) {
      const m = HELPER_DEF.exec(l);
      if (m) {
        cur = `sc_dc_${m[1]}`;
        helpers.set(cur, { key: m[2], first: i, last: -1, stmts: [] });
        ownerOfLine[i] = cur;
      }
      continue;
    }
    ownerOfLine[i] = cur;
    if (l === "}") { helpers.get(cur).last = i; cur = null; }
  }
  if (cur !== null) fail(`helper ${cur} never closed`);
}

// ------------------------------------------------------- 2. the shape table
// Each entry is one emitter line in emit-walkers.ts `dynCheckHelper`, matched
// on the exact text that line writes.  `needs` narrows by the helper's target
// kind where two emitter lines write identical text (the union fall-through
// and the non-adaptable func arm).
const kindOfKey = (key) => {
  const head = key.split(/[:<({[|]/)[0].trim();
  if (head === "") return "?";
  return head;
};

const SHAPES = [
  { id: "prim.f64", why: "target f64 — kind must be SCR_DYN_NUM", re: /^\s*if \(d->kind != SCR_DYN_NUM\) \{ scr_dyn_check_fail\(path, / },
  { id: "prim.bool", why: "target bool — kind must be SCR_DYN_BOOL", re: /^\s*if \(d->kind != SCR_DYN_BOOL\) \{ scr_dyn_check_fail\(path, / },
  { id: "prim.string", why: "target string — kind must be SCR_DYN_STR", re: /^\s*if \(d->kind != SCR_DYN_STR\) \{ scr_dyn_check_fail\(path, / },
  { id: "prim.bytes", why: "target Uint8Array-family — kind must be SCR_DYN_BYTES", re: /^\s*if \(d->kind != SCR_DYN_BYTES\) \{ scr_dyn_check_fail\(path, / },
  { id: "class.Error", why: 'target %Error — the "%error" marker must be present', re: /^\s*if \(d->kind != SCR_DYN_OBJ \|\| !scr_dyn_obj_get\(d, "%error", 6\)\) \{ scr_dyn_check_fail\(path, / },
  { id: "func.kind", why: "target function — kind must be SCR_DYN_FUNC", re: /^\s*if \(d->kind != SCR_DYN_FUNC\) \{ scr_dyn_check_fail\(path, / },
  { id: "tuple.arity", why: "tuple target — array length must equal the arity", re: /^\s*if \(d->v\.arr\.len != \d+\) \{ scr_dyn_check_fail\(path, / },
  { id: "array.kind", why: "array/tuple target — kind must be SCR_DYN_ARR", re: /^\s*if \(d->kind != SCR_DYN_ARR\) \{ scr_dyn_check_fail\(path, / },
  { id: "record.kind", why: "record target — kind must be SCR_DYN_OBJ", re: /^\s*if \(d->kind != SCR_DYN_OBJ\) \{ scr_dyn_check_fail\(path, / },
  { id: "record.field", why: "record target — a REQUIRED declared key is absent", re: /^\s*if \(!m\) \{ scr_dyn_check_fail\(&p, / },
  { id: "union.nomatch", why: "union target — no arm matched", needs: "union", re: /^\s*scr_dyn_check_fail\(path, .*\);\s*$/ },
  { id: "func.noadapt", why: "function target with no adapter — only an exact signature unwraps", needs: "func", re: /^\s*scr_dyn_check_fail\(path, .*\);\s*$/ },
];

// ------------------------------------------------------------ 3. classify
const OCC = /scr_dyn_check_fail\s*\(/g;
let occTotal = 0;
const byShape = new Map();
const byHelperKind = new Map();
const shapeByHelperKind = new Map();
const unclassified = [];
const outsideHelper = [];

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.includes("scr_dyn_check_fail")) continue;
  OCC.lastIndex = 0;
  let n = 0;
  while (OCC.exec(l)) n++;
  if (n === 0) continue;
  occTotal += n;
  if (n > 1) fail(`line ${i + 1}: ${n} scr_dyn_check_fail on ONE line — the shape table assumes one`);
  const owner = ownerOfLine[i];
  if (owner === null) { outsideHelper.push(i + 1); continue; }
  const h = helpers.get(owner);
  const hk = kindOfKey(h.key);
  let hit = null;
  for (const s of SHAPES) {
    if (s.needs && s.needs !== hk) continue;
    if (s.re.test(l)) { hit = s; break; }
  }
  if (!hit) { unclassified.push({ line: i + 1, owner, key: h.key, text: l.trim().slice(0, 140) }); continue; }
  byShape.set(hit.id, (byShape.get(hit.id) ?? 0) + 1);
  byHelperKind.set(hk, (byHelperKind.get(hk) ?? 0) + 1);
  const ck = `${hk} ${hit.id}`;
  shapeByHelperKind.set(ck, (shapeByHelperKind.get(ck) ?? 0) + 1);
  h.stmts.push(hit.id);
}

if (unclassified.length) fail(`${unclassified.length} scr_dyn_check_fail statements matched NO shape`);
if (outsideHelper.length) fail(`${outsideHelper.length} scr_dyn_check_fail statements sit OUTSIDE any sc_dc_ helper`);
const classified = [...byShape.values()].reduce((a, b) => a + b, 0);
if (classified + unclassified.length + outsideHelper.length !== occTotal) {
  fail(`accounting: ${classified} + ${unclassified.length} + ${outsideHelper.length} != ${occTotal}`);
}

// ------------------------------------------------------------ 4. call sites
// A call to sc_dc_<n> from OUTSIDE every walker body is a place the PROGRAM
// crosses the boundary.  Calls from inside a walker are the recursive descent
// (a record field, an array element, a union arm) and are counted apart.
const CALL = /\bsc_dc_(\d+)\s*\(/g;
const PROTO = /^static\s.*\bsc_dc_\d+\(const ScrDyn \*d, const ScrDynPath \*path\)\s*[;{]/;
const callsOutside = new Map();
const callsInside = new Map();
// enclosing top-level definition, so a call site can be attributed to a module
// through the `sc_g_m<i>_` globals its body names (the imagesize block's rule A).
const defOfLine = new Array(lines.length).fill(null);
{
  const DEF = /^(?:static\s)?[A-Za-z_][^;=]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*$/;
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (cur === null) {
      if (l.length === 0 || l[0] === " " || l[0] === "\t" || l[0] === "}") continue;
      if (l.endsWith(";")) continue;
      if (!l.includes("(")) continue;
      const m = DEF.exec(l);
      if (m && (l.includes("{") || (lines[i + 1] ?? "").startsWith("{"))) { cur = m[1]; defOfLine[i] = cur; }
      continue;
    }
    defOfLine[i] = cur;
    if (l === "}") cur = null;
  }
}
const modOfDef = new Map();      // def name -> Set of module tags its body names
{
  const MOD = /\bsc_g_m(\d+)_/g;
  for (let i = 0; i < lines.length; i++) {
    const d = defOfLine[i];
    if (d === null) continue;
    if (!lines[i].includes("sc_g_m")) continue;
    MOD.lastIndex = 0;
    let m;
    while ((m = MOD.exec(lines[i]))) {
      let s = modOfDef.get(d);
      if (!s) modOfDef.set(d, (s = new Set()));
      s.add(m[1]);
    }
  }
}
const callSiteByMod = new Map();
const callSiteByDef = new Map();
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.includes("sc_dc_")) continue;
  if (PROTO.test(l)) continue;
  CALL.lastIndex = 0;
  let m;
  while ((m = CALL.exec(l))) {
    const name = `sc_dc_${m[1]}`;
    if (!helpers.has(name)) { fail(`line ${i + 1}: call to ${name} with no definition`); continue; }
    if (ownerOfLine[i] !== null) { callsInside.set(name, (callsInside.get(name) ?? 0) + 1); continue; }
    callsOutside.set(name, (callsOutside.get(name) ?? 0) + 1);
    const d = defOfLine[i];
    callSiteByDef.set(d, (callSiteByDef.get(d) ?? 0) + 1);
    const mods = modOfDef.get(d);
    const tag = mods && mods.size ? (mods.size === 1 ? `m${[...mods][0]}` : `multi(${[...mods].sort().join("+")})`) : "untagged";
    callSiteByMod.set(tag, (callSiteByMod.get(tag) ?? 0) + 1);
  }
}

// ------------------------------------------------------------ 5. report
const say = (s) => { if (!quiet) console.log(s); };
const pad = (s, n) => String(s).padEnd(n);
const num = (n) => String(n).padStart(7);
const outsideTotal = [...callsOutside.values()].reduce((a, b) => a + b, 0);
const insideTotal = [...callsInside.values()].reduce((a, b) => a + b, 0);

say(`file ${file}   ${raw.length} bytes   ${lines.length} lines`);
say("");
say(`scr_dyn_check_fail STATEMENTS   ${occTotal}   (this is the census's DYNCHECK)`);
say(`interned sc_dc_ helpers         ${helpers.size}`);
say(`program CALL SITES (outside)    ${outsideTotal}`);
say(`recursive calls (inside)        ${insideTotal}`);
say("");
say("BY EMITTER SHAPE — the emission decision that planted the statement");
for (const s of SHAPES) {
  const n = byShape.get(s.id) ?? 0;
  if (n === 0) continue;
  say(`  ${pad(s.id, 16)} ${num(n)}   ${(100 * n / occTotal).toFixed(2).padStart(6)}%   ${s.why}`);
}
const zero = SHAPES.filter((s) => (byShape.get(s.id) ?? 0) === 0).map((s) => s.id);
if (zero.length) say(`  (0 statements: ${zero.join(", ")})`);
say("");
say("BY TARGET-TYPE KIND of the helper the statement lives in");
for (const [k, n] of [...byHelperKind].sort((a, b) => b[1] - a[1])) {
  say(`  ${pad(k, 16)} ${num(n)}   ${(100 * n / occTotal).toFixed(2).padStart(6)}%`);
}
say("");
say("HELPERS by statement count (top 25)");
const hs = [...helpers].map(([n, h]) => [n, h.stmts.length, h.key, callsOutside.get(n) ?? 0, callsInside.get(n) ?? 0])
  .sort((a, b) => b[1] - a[1]);
for (const [n, c, k, co, ci] of hs.slice(0, 25)) {
  say(`  ${pad(n, 10)} stmts ${num(c)}  callsites ${num(co)}  recursive ${num(ci)}  ${k.slice(0, 90)}`);
}
say("");
const orphan = hs.filter((h) => h[3] === 0);
say(`helpers with ZERO program call sites (reached only recursively): ${orphan.length} of ${helpers.size}`);
say(`  their statements: ${orphan.reduce((a, h) => a + h[1], 0)}`);
const dead = hs.filter((h) => h[3] === 0 && h[4] === 0);
say(`helpers with NO call at all (dead — interned and never used): ${dead.length}, statements ${dead.reduce((a, h) => a + h[1], 0)}`);
for (const d of dead.slice(0, 20)) say(`    ${pad(d[0], 10)} stmts ${num(d[1])}  ${d[2].slice(0, 90)}`);
say("");
say("PROGRAM CALL SITES by module tag of the enclosing definition");
for (const [t, n] of [...callSiteByMod].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  say(`  ${pad(t, 16)} ${num(n)}   ${(100 * n / Math.max(1, outsideTotal)).toFixed(2).padStart(6)}%`);
}

if (problems.length) {
  console.error("");
  for (const p of problems) console.error(`PROBLEM: ${p}`);
  for (const u of unclassified.slice(0, 20)) console.error(`  unclassified ${u.owner} [${u.key}] line ${u.line}: ${u.text}`);
  for (const o of outsideHelper.slice(0, 20)) console.error(`  outside-helper line ${o}: ${lines[o - 1].trim().slice(0, 140)}`);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    file, bytes: raw.length, statements: occTotal, helpers: helpers.size,
    callSitesOutside: outsideTotal, callsInside: insideTotal,
    byShape: Object.fromEntries(byShape),
    byHelperKind: Object.fromEntries(byHelperKind),
    shapeByHelperKind: Object.fromEntries([...shapeByHelperKind].map(([k, v]) => [k.replace(" ", "/"), v])),
    callSiteByMod: Object.fromEntries(callSiteByMod),
    callSiteByDef: Object.fromEntries([...callSiteByDef].sort((a, b) => b[1] - a[1]).slice(0, 200)),
    helperRows: hs.map(([n, c, k, co, ci]) => ({ name: n, stmts: c, key: k, callsites: co, recursive: ci })),
  }, null, 2));
}
process.exit(exitCode);
