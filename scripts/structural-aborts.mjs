// structural-aborts.mjs - the ANATOMY of ABORT.structural in an emitted TU.
//
// tu-census.mjs counts the population; it does not say what it IS.  This
// pass answers the two questions the count cannot: what emitter planted
// each trap, and can the guard condition in front of it be reached.
//
// For every `scr_trap(...)` statement it reconstructs the STRUCTURE around
// the call, not just the message:
//
//   OOM guard          the statement must be `if (!X) { scr_trap(...) }` and
//                      the immediately preceding statement must assign X from
//                      an allocator.  A guard with no allocation behind it,
//                      or an allocation with no guard in front of it, is an
//                      ANOMALY - the first is a stray, the second an
//                      unguarded NULL dereference.
//   union-tag default  the statement must be the `default:` of a switch, and
//                      that switch's case labels must be exactly 0..k-1 with
//                      no gaps and no duplicates.  Non-contiguous or
//                      non-zero-based labels are the only shape in which the
//                      default is reachable from a tag the emitter itself
//                      can construct, so they are reported.
//   stringify arm      reported with its host; no structure claim.
//
// It also cross-checks the tag PRODUCERS: every `scr_union_new_*(N, ...)`
// literal tag in the TU and the largest one, so "no constructed tag can
// exceed an arm count" is a measurement over the file and not a claim
// about the emitter.
//
// SELF-TEST: `--selftest` runs the classifier over a planted fixture that
// carries one instance of each family plus one of each anomaly and exits
// non-zero unless every one is seen.  A sweep that measures nothing must
// not read as a clean one.
//
// usage: node scripts/structural-aborts.mjs <tu.c> [--json <out>] [--quiet]
//        node scripts/structural-aborts.mjs --selftest
import { readFileSync, writeFileSync } from "node:fs";

// Both spellings of every family: the historical INLINE `scr_trap("...")`
// and the shared helper the C emitter plants today (`sc_oom()`,
// `sc_bad_tag()`, `sc_stringify_undef()` — the shape the LLVM emitter has
// always had).  One instrument has to read a base TU and a branch TU, or a
// before/after comparison is two instruments and no comparison.
const OOM = /^\s*if\s*\(!([A-Za-z_][A-Za-z0-9_]*)(?:->[A-Za-z0-9_]+)?\)\s*\{?\s*(?:scr_trap\("scriptc: out of memory|sc_oom\(\))/;
// RAW allocators only.  `scr_cyc_alloc` and friends carry their own OOM
// abort inside the runtime (scr_cycle.c: `h = calloc(1, phys); if (!h)
// scr_cyc_oom();`), so an emitted call to one of them needs no guard in
// front of it and counting it as unguarded is a false positive.  The first
// version of this pass did exactly that and reported two on a corpus
// program (my own wrong measurements, section 9).
const ALLOC = /\b(calloc|malloc|realloc)\s*\(/;
const SELF_GUARDED_ALLOC = /\b(scr_cyc_alloc|scr_alloc|scr_pool_take)\s*\(/;
const TAGDEF = /^\s*default:\s*(?:scr_trap\("scriptc: internal error: invalid union tag|sc_bad_tag\(\))/;
const STRINGIFY = /(?:scr_trap\("scriptc: internal error: stringify reached an undefined arm|\bsc_stringify_undef\(\))/;
const ANYTRAP = /\b(?:scr_trap(?:_fmt)?|sc_oom|sc_bad_tag|sc_stringify_undef)\s*\(/;
// The shared helpers’ OWN definition and body are not guard sites: their
// three lines are the ONE trap statement each family now has, and counting
// them as an unclassified trap would report an anomaly on every TU.
const SHARED_TRAP_HOST = /^(?:sc_oom|sc_bad_tag|sc_stringify_undef)$/;

export function analyse(raw) {
  const lines = raw.split("\n");
  // host reconstruction, identical rule to tu-census.mjs
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
  // The emitted definition header names the UNION the helper is for, in its
  // own trailing comment: `/* ToBoolean u12 */`, `/* strict equality u6 */`,
  // `/* to-dyn union:u45 */`, `/* ToString u1 */`.  The helper NUMBER is a
  // per-family counter and says nothing about which union it serves - an
  // earlier version of this pass grouped on it and reported 150 unions whose
  // helpers "disagreed" on the arm count, every one of them two different
  // unions that happened to share a helper index (my own wrong measurements).
  const hostUnion = new Map();
  {
    const U = /\bu(?:nion:u)?(\d+)\b/;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.length === 0 || l[0] === " " || l[0] === "\t" || !l.includes("/*")) continue;
      const c = l.slice(l.indexOf("/*"));
      const m = U.exec(c);
      if (m && hostName[i] !== null && !hostUnion.has(hostName[i])) hostUnion.set(hostName[i], "u" + m[1]);
    }
  }

  const rows = [];
  const anomalies = [];
  let allocLines = 0;
  let allocGuarded = 0;
  let selfGuardedAllocs = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (SELF_GUARDED_ALLOC.test(l) && !ANYTRAP.test(l)) {
      selfGuardedAllocs++;
      continue;
    }
    if (ALLOC.test(l) && !ANYTRAP.test(l)) {
      allocLines++;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const g = OOM.exec(lines[j] ?? "");
      if (g && l.includes(g[1])) allocGuarded++;
      else {
        anomalies.push({
          kind: "alloc-unguarded",
          line: i + 1,
          host: hostName[i],
          text: l.trim().slice(0, 160),
        });
      }
      continue;
    }
    if (!ANYTRAP.test(l)) continue;
    if (hostName[i] !== null && SHARED_TRAP_HOST.test(hostName[i])) continue;

    if (OOM.test(l)) {
      const v = OOM.exec(l)[1];
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j--;
      const prev = lines[j] ?? "";
      const ok = ALLOC.test(prev) && prev.includes(v);
      rows.push({
        family: "OOM",
        line: i + 1,
        host: hostName[i],
        guardVar: v,
        backedByAlloc: ok,
        prev: prev.trim().slice(0, 120),
      });
      if (!ok) {
        anomalies.push({
          kind: "oom-guard-no-alloc",
          line: i + 1,
          host: hostName[i],
          prev: prev.trim().slice(0, 160),
        });
      }
      continue;
    }

    if (TAGDEF.test(l)) {
      const ind = l.length - l.replace(/^\s*/, "").length;
      const labels = [];
      let sw = null;
      for (let j = i - 1; j >= 0 && i - j < 200000; j--) {
        const t = lines[j];
        const ti = t.length - t.replace(/^\s*/, "").length;
        const c = /^\s*case\s+(\d+):/.exec(t);
        if (c && ti === ind) {
          labels.push(Number(c[1]));
          continue;
        }
        if (/^\s*switch\s*\(/.test(t) && ti <= ind) {
          sw = t.trim();
          break;
        }
      }
      labels.sort((a, b) => a - b);
      const k = labels.length;
      const contiguous = k > 0 && labels.every((x, n) => x === n);
      const dup = new Set(labels).size !== k;
      rows.push({ family: "UNIONTAG", line: i + 1, host: hostName[i], cases: k, contiguous, dup, sw, unionId: hostUnion.get(hostName[i]) ?? null });
      if (!contiguous || dup || sw === null) {
        anomalies.push({
          kind: "uniontag-not-total",
          line: i + 1,
          host: hostName[i],
          labels: labels.slice(0, 40),
          sw,
        });
      }
      continue;
    }

    if (STRINGIFY.test(l)) {
      rows.push({ family: "STRINGIFY", line: i + 1, host: hostName[i] });
      continue;
    }

    if (/record has no key/.test(l)) {
      rows.push({ family: "REAL", line: i + 1, host: hostName[i] });
      continue;
    }
    rows.push({ family: "UNKNOWN", line: i + 1, host: hostName[i], text: l.trim().slice(0, 160) });
    anomalies.push({ kind: "unknown-trap", line: i + 1, host: hostName[i], text: l.trim().slice(0, 160) });
  }

  // The UNIT-ARM instances: `static ScrUnion sc_unit_7 = { .rc = SIZE_MAX,
  // .tag = 1 }; /* u3 unit arm */`.  These are the one tag producer the
  // emitted C attributes to a union by name, so they are the one family
  // whose tag can be checked against that union's own arm count.
  const units = [];
  {
    const UNIT = /^static (?:const )?ScrUnion (sc_unit_\d+) = \{[^}]*\.tag = (\d+)[^}]*\}; \/\* u(\d+) unit arm \*\/$/;
    for (const l of lines) {
      const m = UNIT.exec(l);
      if (m) units.push({ sym: m[1], tag: Number(m[2]), unionId: 'u' + m[3] });
    }
  }
  const tags = [];
  const NEW = /\bscr_union_new_(?:f64|bool|ref)\s*\(\s*(\d+)\s*,/g;
  for (let m; (m = NEW.exec(raw)) !== null; ) tags.push(Number(m[1]));
  const maxTag = tags.length ? Math.max(...tags) : -1;
  const NONLIT = /\bscr_union_new_(?:f64|bool|ref)\s*\(\s*(?![0-9])/g;
  let nonLiteralTags = 0;
  for (let m; (m = NONLIT.exec(raw)) !== null; ) nonLiteralTags++;
  const cases = rows.filter((r) => r.family === "UNIONTAG").map((r) => r.cases);

  return {
    rows,
    anomalies,
    allocLines,
    allocGuarded,
    selfGuardedAllocs,
    hostUnion: Object.fromEntries(hostUnion),
    units,
    nonLiteralTags,
    tagProducers: tags.length,
    maxTag,
    maxCases: cases.length ? Math.max(...cases) : 0,
  };
}

const FIXTURE = [
  "static void sc_ok_1(void) {",
  "  Shape *o = calloc(1, sizeof *o);",
  '  if (!o) { scr_trap("scriptc: out of memory\\n"); }',
  "  o->rc = 1;",
  "}",
  "static void sc_self_guard(void) {",
  "  Shape *s = scr_cyc_alloc(sizeof *s, &t, &f);",
  "  s->rc = 1;",
  "}",
  "static void sc_bad_alloc(void) {",
  "  Shape *p = malloc(8);",
  "  p->rc = 1;",
  "}",
  "static void sc_bad_guard(void) {",
  "  int q = 0;",
  '  if (!q) { scr_trap("scriptc: out of memory\\n"); }',
  "}",
  "static bool sc_ut_77(ScrUnion *v) { /* ToBoolean u77 */",
  "  switch (v->tag) {",
  "  case 0: return false;",
  "  case 1: return true;",
  '  default: scr_trap("scriptc: internal error: invalid union tag\\n");',
  "  }",
  "}",
  "static bool sc_u_ok(ScrUnion *v) {",
  "  switch (v->tag) {",
  "  case 0: return false;",
  "  case 1: return true;",
  '  default: scr_trap("scriptc: internal error: invalid union tag\\n");',
  "  }",
  "}",
  "static bool sc_u_gap(ScrUnion *v) {",
  "  switch (v->tag) {",
  "  case 0: return false;",
  "  case 2: return true;",
  '  default: scr_trap("scriptc: internal error: invalid union tag\\n");',
  "  }",
  "}",
  "static void sc_str_arm(void) {",
  '    scr_trap("scriptc: internal error: stringify reached an undefined arm\\n");',
  "}",
  "static void sc_novel(void) {",
  '  scr_trap("scriptc: brand new message nobody classified\\n");',
  "}",
  // ---- the SHARED-HELPER spelling of every family, planted as its own twin.
  // The definitions themselves must produce NO row and NO anomaly (they are
  // the one trap statement per family, not a guard site); each call site must
  // be classified exactly as its inline twin above.
  "static _Noreturn void sc_oom(void) {",
  '  scr_trap("scriptc: out of memory\\n");',
  "}",
  "static _Noreturn void sc_bad_tag(void) {",
  '  scr_trap("scriptc: internal error: invalid union tag\\n");',
  "}",
  "static _Noreturn void sc_stringify_undef(void) {",
  '  scr_trap("scriptc: internal error: stringify reached an undefined arm\\n");',
  "}",
  "static void sc_ok_2(void) {",
  "  Shape *o = calloc(1, sizeof *o);",
  "  if (!o) { sc_oom(); }",
  "  o->rc = 1;",
  "}",
  "static bool sc_ut_78(ScrUnion *v) { /* ToBoolean u78 */",
  "  switch (v->tag) {",
  "  case 0: return false;",
  "  case 1: return true;",
  "  default: sc_bad_tag();",
  "  }",
  "}",
  "static bool sc_u_gap2(ScrUnion *v) {",
  "  switch (v->tag) {",
  "  case 0: return false;",
  "  case 3: return true;",
  "  default: sc_bad_tag();",
  "  }",
  "}",
  "static void sc_str_arm2(void) {",
  "    sc_stringify_undef();",
  "}",
  "static ScrUnion sc_unit_0 = { .rc = SIZE_MAX, .tag = 1 }; /* u77 unit arm */",
  "static ScrUnion sc_unit_1 = { .rc = SIZE_MAX, .tag = 9 }; /* u77 unit arm */",
  "static void sc_prod(void) {",
  "  a = scr_union_new_ref(3, x, &r, &f, NULL);",
  "}",
  "",
].join("\n");

if (process.argv.includes("--selftest")) {
  const a = analyse(FIXTURE);
  const need = [
    ["OOM rows == 3 (2 inline + 1 shared-helper)", a.rows.filter((r) => r.family === "OOM").length === 3],
    ["two OOM guards backed by an alloc", a.rows.filter((r) => r.family === "OOM" && r.backedByAlloc).length === 2],
    ["UNIONTAG rows == 5 (3 inline + 2 shared-helper)", a.rows.filter((r) => r.family === "UNIONTAG").length === 5],
    ["three total union switches", a.rows.filter((r) => r.family === "UNIONTAG" && r.contiguous).length === 3],
    ["STRINGIFY rows == 2 (inline + shared-helper)", a.rows.filter((r) => r.family === "STRINGIFY").length === 2],
    ["UNKNOWN row seen, and ONLY the one planted", a.rows.filter((r) => r.family === "UNKNOWN").length === 1],
    ["anomaly alloc-unguarded seen", a.anomalies.some((x) => x.kind === "alloc-unguarded")],
    ["anomaly oom-guard-no-alloc seen", a.anomalies.some((x) => x.kind === "oom-guard-no-alloc")],
    ["anomaly uniontag-not-total seen, BOTH spellings", a.anomalies.filter((x) => x.kind === "uniontag-not-total").length === 2],
    ["anomaly unknown-trap seen", a.anomalies.some((x) => x.kind === "unknown-trap")],
    ["the shared-helper CALL SITES are attributed to their own host",
      a.rows.some((r) => r.family === "OOM" && r.host === "sc_ok_2") &&
      a.rows.some((r) => r.family === "UNIONTAG" && r.host === "sc_ut_78") &&
      a.rows.some((r) => r.family === "STRINGIFY" && r.host === "sc_str_arm2")],
    ["the helper DEFINITIONS produce no row and no anomaly",
      !a.rows.some((r) => r.host === "sc_oom" || r.host === "sc_bad_tag" || r.host === "sc_stringify_undef") &&
      !a.anomalies.some((x) => x.host === "sc_oom" || x.host === "sc_bad_tag" || x.host === "sc_stringify_undef")],
    ["tag producer seen, max tag 3", a.tagProducers === 1 && a.maxTag === 3],
    ["unit instances parsed with their union", a.units.length === 2 && a.units[1].unionId === "u77" && a.units[1].tag === 9],
    ["self-guarding allocator not counted as an anomaly", a.selfGuardedAllocs === 1 && a.anomalies.filter((x) => x.kind === "alloc-unguarded").length === 1],
  ];
  let bad = 0;
  for (const [n, ok] of need) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n}`);
    if (!ok) bad++;
  }
  console.log(
    bad === 0
      ? "SELFTEST OK - every planted family and every planted anomaly was seen"
      : `SELFTEST FAILED - ${bad} planted case(s) invisible`,
  );
  process.exit(bad === 0 ? 0 : 4);
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/structural-aborts.mjs <tu.c> [--json out] [--quiet]");
  process.exit(2);
}
const raw = readFileSync(file, "latin1");
// ------------------------------------------------------------ 0. the lane
// The release default is the LLVM lane (index.ts emits the .ll first and
// falls back to C only on an LlvmUnsupportedError tier refusal), so a C-only
// reader can be aimed at an .ll by accident.  Say so, loudly, instead of
// running the C tables over IR and exiting through this tool's own failure
// path with a pile of unclassified rows -- that reads exactly like a
// compiler regression and is really a wrong-lane instrument.
if ((raw.match(/^(?:declare|define) /gm) ?? []).length > 0 && (raw.match(/^#include /gm) ?? []).length === 0) {
  console.error(`structural-aborts: ${file} is an LLVM translation unit (the default lane's .ll), and this reader is C-only.`);
  console.error("  It requires `if (!X) { scr_trap(...) }` with the allocation on the PREVIOUS line, and a `default:`\n  switch arm with contiguous case labels.  The .ll calls ONE shared @sc_oom / @sc_bad_tag and the\n  allocation and the switch are several instructions away, so the anatomy this pass checks is not\n  present in the IR in that form.");
  console.error("  scripts/tu-census.mjs reads BOTH lanes; use it for the category counts.");
  process.exit(4);
}

const a = analyse(raw);
const byFam = new Map();
for (const r of a.rows) byFam.set(r.family, (byFam.get(r.family) ?? 0) + 1);
const byHostFam = new Map();
for (const r of a.rows) {
  const h = (r.host ?? "<file scope>").replace(/\d+/g, "N");
  const k = `${r.family}  host=${h}`;
  byHostFam.set(k, (byHostFam.get(k) ?? 0) + 1);
}
const out = [];
out.push(`FILE ${file}  ${raw.length} bytes`);
out.push("");
out.push("=== TRAP STATEMENTS BY FAMILY ==================================");
for (const [f, n] of [...byFam].sort((x, y) => y[1] - x[1])) out.push(`  ${String(n).padStart(6)}  ${f}`);
out.push("");
out.push("=== BY EMITTED HOST TEMPLATE (digits folded to N) ==============");
for (const [k, n] of [...byHostFam].sort((x, y) => y[1] - x[1]).slice(0, 30)) out.push(`  ${String(n).padStart(6)}  ${k}`);
out.push("");
const oom = a.rows.filter((r) => r.family === "OOM");
out.push("=== OOM GUARDS =================================================");
out.push(`  guards ${oom.length}   backed by an allocation on the previous statement ${oom.filter((r) => r.backedByAlloc).length}`);
out.push(`  raw calloc/malloc/realloc statements ${a.allocLines}   guarded ${a.allocGuarded}   unguarded ${a.allocLines - a.allocGuarded}`);
out.push(`  self-guarding runtime allocators (scr_cyc_alloc et al, OOM abort lives inside) ${a.selfGuardedAllocs}`);
out.push("");
const ut = a.rows.filter((r) => r.family === "UNIONTAG");
const bad = ut.filter((r) => !r.contiguous || r.dup);
out.push("=== UNION-TAG DEFAULTS =========================================");
out.push(`  defaults ${ut.length}   case labels exactly 0..k-1 ${ut.length - bad.length}   NOT total ${bad.length}`);
const kHist = new Map();
for (const r of ut) kHist.set(r.cases, (kHist.get(r.cases) ?? 0) + 1);
out.push(`  arm-count histogram: ${[...kHist].sort((x, y) => x[0] - y[0]).map(([k, n]) => `${k}:${n}`).join(" ")}`);
out.push(`  largest enumerated arm index ${a.maxCases - 1}`);
// PER-UNION CONSISTENCY.  Every union helper family is named `sc_<kind><N>`
// where N is the union's index, so all the switches over ONE union must
// enumerate the same number of arms.  A union whose helpers disagree would
// mean one of them stopped short of the definition, which is the shape in
// which a `default:` becomes reachable.
const perUnion = new Map();
let noUnionId = 0;
for (const r of ut) {
  if (r.unionId === null || r.unionId === undefined) { noUnionId++; continue; }
  if (!perUnion.has(r.unionId)) perUnion.set(r.unionId, new Set());
  perUnion.get(r.unionId).add(r.cases);
}
const inconsistent = [...perUnion].filter(([, s]) => s.size > 1);
out.push(`  interned union helpers attributed to a union id ${ut.length - noUnionId}   distinct unions ${perUnion.size}   whose helpers DISAGREE on the arm count ${inconsistent.length}`);
out.push(`  defaults with no union id in their header (inline per-EXPRESSION switches: unionDisc / unionKeyGet) ${noUnionId}`);
for (const [u, s] of inconsistent.slice(0, 10)) out.push(`     union ${u}: arm counts ${[...s].join(",")}`);
out.push("");
out.push("=== TAG PRODUCERS ==============================================");
out.push(`  scr_union_new_* with a literal tag: ${a.tagProducers}   largest literal tag ${a.maxTag}`);
out.push(`  scr_union_new_* with a NON-literal tag: ${a.nonLiteralTags}   (a tag that is not a compile-time constant)`);
// The largest literal tag and the largest enumerated arm index are NOT
// comparable: they belong to different unions.  A union-to-superset RETAG
// helper is emitted as an if-chain on `->tag ==` rather than a switch, so a
// union with 131 arms can construct tag 130 while the largest union that
// owns a switch has 85 arms.  An earlier version of this pass printed the
// two side by side as if one bounded the other (my own wrong measurements).
// The check that IS per-union is the unit instances, which name their union.
const kOf = new Map();
for (const r of ut) if (r.unionId) kOf.set(r.unionId, Math.max(kOf.get(r.unionId) ?? 0, r.cases));
let uChecked = 0;
const uBad = [];
for (const u of a.units) {
  const k = kOf.get(u.unionId);
  if (k === undefined) continue;
  uChecked++;
  if (u.tag >= k) uBad.push(u);
}
out.push(`  unit-arm instances ${a.units.length}   checkable against their union's own arm count ${uChecked}   OUT OF RANGE ${uBad.length}`);
for (const u of uBad.slice(0, 10)) out.push(`     ${u.sym} tag ${u.tag} on ${u.unionId} whose switches enumerate ${kOf.get(u.unionId)} arms`);
out.push("");
out.push("=== ANOMALIES ==================================================");
if (a.anomalies.length === 0) out.push("  (none)");
const anomByKind = new Map();
for (const x of a.anomalies) anomByKind.set(x.kind, (anomByKind.get(x.kind) ?? 0) + 1);
for (const [k, n] of [...anomByKind].sort((x, y) => y[1] - x[1])) out.push(`  ${String(n).padStart(6)}  ${k}`);
for (const x of a.anomalies.slice(0, 25)) out.push(`     line ${x.line} host ${x.host} ${JSON.stringify(x).slice(0, 200)}`);
const text = out.join("\n");
if (!process.argv.includes("--quiet")) console.log(text);
const ji = process.argv.indexOf("--json");
if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify(a, null, 1));
