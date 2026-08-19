// real-aborts.mjs - the CAUSE histogram of ABORT.real in an emitted TU.
//
// tu-census.mjs answers "how many": 23 keyed-read helpers standing for 94
// call sites on zapo.  It does not answer "why", and the count alone is
// nearly blind: the statement count read 24 on both sides of a fix that
// took a paired zapo from crash to clean exit, while the call sites went
// 208 -> 103 -> 94.
//
// This pass reads each `sc_rkg_<n>` helper the census marks ABORT.real and
// recovers, from the emitted TU alone:
//
//   shape        the record shape the read is on (the helper's own header
//                comment, `/* r[k] on <shapeId> as <typeKey> */`)
//   result       the C result type, i.e. the width the frontend kept - the
//                thing that decides whether the miss path can answer
//                `undefined` or has to abort
//   fields       how many declared fields the helper compares before the
//                overflow map, and their names
//   callers      every emitted function that calls it, by name.  An
//                `sc_f_<name>` host is a SOURCE function and names the
//                place in the program the abort can happen; `sc_w_`/`sc_fc_`
//                are closure trampolines and are reported as such.
//
// The call-site unit is tu-census.mjs's: a call on an indented line, minus
// the prototype/definition headers at column 0.  It is reproduced here
// rather than imported so the two instruments can disagree out loud.
//
// SELF-TEST: `--selftest` runs over a planted fixture with two helpers, a
// known caller set and one caller reached only through a function pointer,
// and exits non-zero unless every planted fact is recovered.
//
// usage: node scripts/real-aborts.mjs <tu.c> [--json <out>] [--quiet]
//        node scripts/real-aborts.mjs --selftest
import { readFileSync, writeFileSync } from "node:fs";

const TRAP = /scr_trap_fmt\("scriptc: TypeError: record has no key '%\.\*s' \(typed '([^']*)'/;
const HDR = /^static\s+(.+?)\s*\*?\s*(sc_rkg_\d+)\(([^)]*)\)\s*\{\s*\/\* r\[k\] on (\S+) as (.+?) \*\//;

export function analyse(raw) {
  const lines = raw.split("\n");
  const helpers = new Map(); // name -> record
  const hostName = new Array(lines.length).fill(null);
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
        if (m && (l.includes("{") || (lines[i + 1] ?? "").startsWith("{"))) cur = m[1];
        if (cur !== null) hostName[i] = cur;
        continue;
      }
      hostName[i] = cur;
      if (l === "}") cur = null;
    }
  }

  // 1. the helpers that ABORT, with their header facts
  for (let i = 0; i < lines.length; i++) {
    const h = HDR.exec(lines[i]);
    if (h === null) continue;
    const [, cret, name, , shapeId, typeKey] = h;
    let fields = [];
    let traps = false;
    let overflow = null;
    for (let j = i + 1; j < lines.length && lines[j] !== "}"; j++) {
      const f = /\/\* ([^*]+) \*\/$/.exec(lines[j]);
      if (f && /scr_str_eq\(k,/.test(lines[j])) fields.push(f[1]);
      if (/scr_map_get_str_/.test(lines[j])) overflow = /scr_map_get_str_(\w+)/.exec(lines[j])[1];
      const t = TRAP.exec(lines[j]);
      if (t) traps = true;
    }
    helpers.set(name, {
      name,
      cret: cret.trim(),
      shapeId,
      typeKey,
      fields,
      nFields: fields.length,
      overflow,
      traps,
      line: i + 1,
      callers: new Map(),
      ptr: 0,
      declMentions: 0,
    });
  }

  // 2. the call sites, one pass over the file
  const wanted = new Set([...helpers.keys()]);
  if (wanted.size > 0) {
    const CALL = /(^|[^A-Za-z0-9_])(sc_rkg_\d+)\s*\(/g;
    const PTR = /&(sc_rkg_\d+)\b/g;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.includes("sc_rkg_")) continue;
      const isDeclLine = l.length > 0 && l[0] !== " " && l[0] !== "\t";
      CALL.lastIndex = 0;
      for (let m; (m = CALL.exec(l)) !== null; ) {
        const h = helpers.get(m[2]);
        if (!h) continue;
        if (isDeclLine) {
          h.declMentions++;
          continue;
        }
        const host = hostName[i] ?? "<file scope>";
        h.callers.set(host, (h.callers.get(host) ?? 0) + 1);
      }
      PTR.lastIndex = 0;
      for (let m; (m = PTR.exec(l)) !== null; ) {
        const h = helpers.get(m[1]);
        if (h) h.ptr++;
      }
    }
  }
  for (const h of helpers.values()) {
    h.ways = [...h.callers.values()].reduce((a, b) => a + b, 0);
    if (h.ways === 0 && h.ptr > 0) h.ways = 1;
  }
  return { helpers: [...helpers.values()] };
}

const FIXTURE = [
  "static ScrStr *sc_rkg_0(sc_rs_r1 *r, ScrStr *k); /* r[k] on r1 as string */",
  "static ScrStr *sc_rkg_0(sc_rs_r1 *r, ScrStr *k) { /* r[k] on r1 as string */",
  "  if (scr_str_eq(k, (ScrStr *)&sc_s_1)) { /* from */",
  "    return scr_str_retain(r->sc_m_from);",
  "  }",
  "  ScrStr * hit = (ScrStr *)scr_map_get_str_ref(r->sc_ovf, k);",
  "  if (hit) {",
  "    return hit; /* get returned +1 */",
  "  }",
  '  scr_trap_fmt("scriptc: TypeError: record has no key \'%.*s\' (typed \'string\' - no undefined is representable)\\n", (int)k->len, k->data);',
  "}",
  "static double sc_rkg_1(sc_rs_r2 *r, ScrStr *k) { /* r[k] on r2 as f64 */",
  "  double hit;",
  "  if (scr_map_get_str_f64(r->sc_ovf, k, &hit)) {",
  "    return hit;",
  "  }",
  '  scr_trap_fmt("scriptc: TypeError: record has no key \'%.*s\' (typed \'number\' - no undefined is representable)\\n", (int)k->len, k->data);',
  "}",
  "static sc_rs_r9 *sc_rkg_2(sc_rs_r3 *r, ScrStr *k) { /* r[k] on r3 as record:r9 */",
  "  sc_rs_r9 * hit = (sc_rs_r9 *)scr_map_get_str_ref(r->sc_ovf, k);",
  "  if (hit) {",
  "    return hit; /* get returned +1 */",
  "  }",
  '  scr_trap_fmt("scriptc: TypeError: record has no key \'%.*s\' (typed \'{ a: string }\' - no undefined is representable)\\n", (int)k->len, k->data);',
  "}",
  "static void sc_f_parse(void) {",
  "  ScrStr * a = sc_rkg_0(n, k1);",
  "  ScrStr * b = sc_rkg_0(n, k2);",
  "}",
  "static void sc_f_other(void) {",
  "  double d = sc_rkg_1(m, k3);",
  "  sc_rs_r9 * z = sc_rkg_2(q, k4);",
  "}",
  "static void sc_f_ptruser(void) {",
  "  f = &sc_rkg_0;",
  "}",
  "",
].join("\n");

if (process.argv.includes("--selftest")) {
  const a = analyse(FIXTURE);
  const h0 = a.helpers.find((h) => h.name === "sc_rkg_0");
  const h1 = a.helpers.find((h) => h.name === "sc_rkg_1");
  const need = [
    ["three helpers found", a.helpers.length === 3],
    ["a POINTER result type parses (no space before the name)", a.helpers.some((h) => h.name === "sc_rkg_0")],
    ["a RECORD result type parses", a.helpers.find((h) => h.name === "sc_rkg_2")?.typeKey === "record:r9"],
    ["a multi-word typed quote parses", a.helpers.find((h) => h.name === "sc_rkg_2")?.traps === true],
    ["both trap", a.helpers.every((h) => h.traps)],
    ["shape recovered", h0?.shapeId === "r1" && h1?.shapeId === "r2"],
    ["result type recovered", h0?.typeKey === "string" && h1?.typeKey === "f64"],
    ["declared field recovered", h0?.nFields === 1 && h0.fields[0] === "from"],
    ["a signature-only helper has zero declared fields", h1?.nFields === 0],
    ["overflow accessor recovered", h0?.overflow === "ref" && h1?.overflow === "f64"],
    ["call sites counted, prototype line excluded", h0?.ways === 2],
    ["caller host named", h0?.callers.get("sc_f_parse") === 2],
    ["second helper one caller", h1?.ways === 1 && h1.callers.get("sc_f_other") === 1],
    ["record-result helper one caller", a.helpers.find((h) => h.name === "sc_rkg_2")?.ways === 1],
    ["function-pointer mention counted separately", h0?.ptr === 1],
    ["prototype mention counted", h0?.declMentions === 2],
  ];
  let bad = 0;
  for (const [n, ok] of need) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}`);
    if (!ok) bad++;
  }
  console.log(bad === 0 ? "SELFTEST OK - every planted fact recovered" : `SELFTEST FAILED - ${bad}`);
  process.exit(bad === 0 ? 0 : 4);
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/real-aborts.mjs <tu.c> [--json out] [--quiet]");
  process.exit(2);
}
const raw = readFileSync(file, "latin1");
const a = analyse(raw);
const abort = a.helpers.filter((h) => h.traps);
const safe = a.helpers.filter((h) => !h.traps);
const out = [];
out.push(`FILE ${file}  ${raw.length} bytes`);
out.push("");
out.push(`keyed-read helpers ${a.helpers.length}   of which ABORT on a miss ${abort.length}   answer undefined ${safe.length}`);
out.push(`ABORTABLE CALL SITES ${abort.reduce((s, h) => s + h.ways, 0)}`);
out.push("");
out.push("=== ABORTABLE HELPERS, BY RESULT TYPE (the cause: this width cannot say undefined) ===");
const byType = new Map();
for (const h of abort) {
  const e = byType.get(h.typeKey) ?? { stmts: 0, ways: 0 };
  e.stmts++;
  e.ways += h.ways;
  byType.set(h.typeKey, e);
}
for (const [t, e] of [...byType].sort((x, y) => y[1].ways - x[1].ways)) {
  out.push(`  ways ${String(e.ways).padStart(4)}   helpers ${String(e.stmts).padStart(3)}   result ${t}`);
}
out.push("");
out.push("=== ABORTABLE HELPERS, BY SHAPE ================================");
const byShape = new Map();
for (const h of abort) {
  const e = byShape.get(h.shapeId) ?? { stmts: 0, ways: 0, fields: h.nFields, ovf: h.overflow };
  e.stmts++;
  e.ways += h.ways;
  byShape.set(h.shapeId, e);
}
for (const [s, e] of [...byShape].sort((x, y) => y[1].ways - x[1].ways)) {
  out.push(`  ways ${String(e.ways).padStart(4)}   helpers ${String(e.stmts).padStart(3)}   shape ${s}  declaredFields=${e.fields} overflow=${e.ovf}`);
}
out.push("");
out.push("=== EVERY ABORTABLE HELPER =====================================");
for (const h of [...abort].sort((x, y) => y.ways - x.ways)) {
  out.push(`  ${h.name}  ways=${h.ways}  shape=${h.shapeId}  result=${h.typeKey}  fields=${h.nFields}  overflow=${h.overflow}  line=${h.line}`);
  const cs = [...h.callers].sort((x, y) => y[1] - x[1]);
  out.push(`     callers: ${cs.map(([k, v]) => `${k}x${v}`).join("  ") || "(none - pointer only)"}`);
  if (h.nFields > 0) out.push(`     declared: ${h.fields.slice(0, 12).join(", ")}${h.nFields > 12 ? " ..." : ""}`);
}
out.push("");
out.push("=== CALLERS, RANKED (a source function is a place the abort can happen) ===");
const byCaller = new Map();
for (const h of abort) for (const [c, n] of h.callers) byCaller.set(c, (byCaller.get(c) ?? 0) + n);
for (const [c, n] of [...byCaller].sort((x, y) => y[1] - x[1])) out.push(`  ${String(n).padStart(4)}  ${c}`);
const text = out.join("\n");
if (!process.argv.includes("--quiet")) console.log(text);
const ji = process.argv.indexOf("--json");
if (ji > 0) {
  writeFileSync(
    process.argv[ji + 1],
    JSON.stringify(a.helpers.map((h) => ({ ...h, callers: Object.fromEntries(h.callers) })), null, 1),
  );
}
