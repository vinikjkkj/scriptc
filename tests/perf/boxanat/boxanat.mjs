#!/usr/bin/env node
// boxanat.mjs — what a value COSTS once it is boxed into an `unknown` slot.
//
//   node boxanat.mjs <program.c|program.ll> [--top N] [--json] [--names] [--type <key>]
//   node boxanat.mjs --self-test
//
// WHY THIS EXISTS. "2,794 bytes per retained value" is a MEASUREMENT off one
// workload. It says the boxes are expensive; it does not say where the bytes
// go, and a representation change cannot be priced from a single scalar. This
// lane reads the ANATOMY off the artifact the compiler actually emitted.
//
// WHAT IT READS. Both backends emit the SAME converter, function for
// function: emit-walkers.ts's `toDynHelper` and llvm/dyn.ts's port of it each
// emit one `sc_td_<n>` per static type, and each of those calls the same
// runtime constructors. So the cost is a property of the RUNTIME and the
// SHAPE, not of the backend — which this file checks rather than assumes:
// given the .c and the .ll of one program it must produce identical numbers,
// and --self-test includes that check on a fixture in both spellings.
//
// THE COST MODEL, and every constant in it is measured, not read off a
// header:
//
//   a dyn node   16 (ScrCycHdr) + 48 (ScrDyn) = 64 B, at pool grain 8.
//   an OBJ table cap * 24 B (ScrDynEntry), cap = 1 for one member and the
//                next power of two above that (SCR_DYN_OBJ_FIRST_CAP is 1
//                and the growth doubles), as an ordinary malloc block.
//   an ARR items cap * 8 B, same capacity rule (SCR_DYN_ARR_FIRST_CAP 1).
//   a malloc blk (n + 8 header) rounded up to 16 — tests/perf/dyncensus's
//                measured grain for x86_64-windows-gnu (mallocgrain.c).
//   the origin   32 B (ScrDynOriginEnt) in a power-of-two table kept under
//                a 0.7 load factor, so 45.7 B/entry at the fullest and
//                91.4 B just after a grow. ROOT ONLY: scr_dyn_origin_mark
//                records the crossing's root and nothing below it.
//
// THE HEADLINE THE MODEL EXISTS TO STATE. The crossing is TRANSITIVE and it
// is PER LEAF. A record is a flat C struct — one machine word per field —
// and its dyn image is one 64-byte heap node per SCALAR anywhere in the
// reachable tree, plus a table per composite. A wrapper whose payload
// "lives elsewhere" does not box as a wrapper: it boxes as the whole
// subtree.
//
// WHAT SHARES AND WHAT COPIES. Strings, typed arrays, ArrayBuffers, Maps,
// Sets, bigints, promises, closures and class instances box BY REFERENCE —
// the payload is the same object and costs only the 64-byte node that names
// it. ARRAYS and RECORDS are the two that copy, because their static and
// dynamic representations are physically different memory. Every byte this
// lane reports above 64 per node is therefore attributable to those two.
//
// WHAT IT DOES NOT DO. It does not know how many ELEMENTS an array holds at
// run time (the emitted converter loops over `v->len`), so an array's cost
// is reported as a per-element rate and the type is marked `unbounded`. It
// does not know how many times a site is REACHED. It is a per-value price
// list, and a retention count from another lane multiplies into it.

import { readFileSync } from "node:fs";

const NODE_B = 64; // ScrCycHdr 16 + ScrDyn 48, pool grain 8
const ENTRY_B = 24; // sizeof(ScrDynEntry)
const ITEM_B = 8; // sizeof(ScrDyn *)
const ORIGIN_ENT_B = 32; // sizeof(ScrDynOriginEnt)
const ORIGIN_LOAD = 0.7; // dyn_origin_grow's threshold
const MALLOC_HDR = 8; // tests/perf/dyncensus/mallocgrain.c
const MALLOC_ALIGN = 16;

export function mallocPhys(n) {
  if (n <= 0) return 0;
  return (n + MALLOC_HDR + (MALLOC_ALIGN - 1)) & ~(MALLOC_ALIGN - 1);
}

/** scr_json.c's growth policy: the FIRST allocation is exact, then it
 * doubles. So a table that reached n members has capacity n for n <= 1 and
 * the next power of two at or above n otherwise. */
export function capFor(n) {
  if (n <= 1) return n;
  let c = 1;
  while (c < n) c *= 2;
  return c;
}

/* ── reading the artifact ──────────────────────────────────────────────
 *
 * A converter is `sc_td_<n>`, and BOTH backends label it with the same
 * comment — the interned typeKey of the static type it converts. The label
 * is what makes the two lanes comparable at all, so a converter WITHOUT one
 * is skipped and counted, never guessed at. */
const C_HEAD = /^\s*(?:static\s+)?ScrDyn\s*\*\s*(sc_td_\d+)\s*\([^)]*\)\s*\{\s*\/\*\s*to-dyn\s+(.*?)\s*\*\//;
const LL_HEAD = /^define\s+internal\s+ptr\s+@(sc_td_\d+)\s*\([^)]*\)[^{]*\{\s*;\s*to-dyn\s+(.*?)\s*$/;

export function parseHelpers(text) {
  const lines = text.split(/\r?\n/);
  const lang = /^define\s+internal\s+ptr\s+@sc_td_/m.test(text) ? "ll" : "c";
  const head = lang === "ll" ? LL_HEAD : C_HEAD;
  const helpers = new Map(); // name -> { name, key, body }
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\}/.test(lines[j])) break;
      body.push(lines[j]);
    }
    helpers.set(m[1], { name: m[1], key: m[2], body: body.join("\n") });
  }
  return { lang, helpers };
}

/* The constructor a body reaches for. The two backends spell a call
 * differently (`sc_td_3(v->f)` against `call ptr @sc_td_3(ptr %t9)`) and
 * identically enough that one pair of patterns reads both. */
const CTORS = [
  ["scr_dyn_new_obj_flavor", "obj", "copies"],
  ["scr_dyn_new_obj_null_proto", "obj", "copies"],
  ["scr_dyn_new_obj", "obj", "copies"],
  ["scr_dyn_new_arr", "arr", "copies"],
  ["scr_dyn_new_str", "str", "shares"],
  ["scr_dyn_new_num", "num", "shares"],
  ["scr_dyn_new_bool", "bool", "shares"],
  ["scr_dyn_new_null", "null", "shares"],
  ["scr_dyn_new_objinst", "objinst", "shares"],
  ["scr_dyn_new_bytes_ref", "bytes", "shares"],
  ["scr_dyn_new_arrbuf_ref", "arrbuf", "shares"],
  ["scr_dyn_new_map_ref", "map", "shares"],
  ["scr_dyn_new_promise_adapting", "promise", "shares"],
  ["scr_dyn_new_promise", "promise", "shares"],
  ["scr_dyn_from_big", "bigint", "shares"],
  ["scr_dyn_from_error", "error", "copies"],
  ["scr_dyn_undefined", "undefined", "free"],
];

export function classify(h) {
  const b = h.body;
  const children = [...b.matchAll(/\b(sc_td_\d+)\s*\(/g)]
    .map((m) => m[1])
    .filter((n) => n !== h.name);
  // MEMBERS ARE COUNTED BY DISTINCT KEY, not by call site, and that is not
  // tidiness. An ARMED shape (one a dynCheck builder also materialises)
  // emits the SAME field twice — once into the object under
  // `scr_dyn_obj_set_lit` and once onto the rebuilt prototype chain when
  // the own-mask says the source only inherited it — so counting sites
  // would report a table twice as wide as the one the value ever holds,
  // and the capacity rule would then round it up again.
  const keys = new Set(
    [
      ...b.matchAll(
        /scr_dyn_obj_set(?:_present)?_lit\s*\(\s*[^,]+,\s*(?:"((?:[^"\\]|\\.)*)"|ptr\s+(@[A-Za-z0-9_.]+))/g,
      ),
    ].map((m) => m[1] ?? m[2]),
  );
  const nSet = keys.size;
  // THE FIELD NAMES, so a row is legible. A typeKey is `record:r981` and
  // nothing else — the shape ids are the frontend's interning counter, not
  // the source's names — so without this the price list cannot be matched to
  // a type anyone can name. Both backends annotate the member store with the
  // key: the C lane writes it as the literal argument, the LLVM lane as a
  // trailing `; <name>` comment beside the interned constant.
  const names = new Set(
    [
      ...b.matchAll(/scr_dyn_obj_set(?:_present)?_lit\s*\([^)]*\)\s*;\s*([A-Za-z_$][\w$]*)\s*$/gm),
    ].map((m) => m[1]),
  );
  if (names.size === 0) {
    for (const m of b.matchAll(/scr_dyn_obj_set(?:_present)?_lit\s*\(\s*[^,]+,\s*"((?:[^"\\]|\\.)*)"/g)) {
      names.add(m[1]);
    }
  }
  const nSlot = (b.match(/scr_dyn_obj_set_slot\s*\(/g) || []).length;
  const nPush = (b.match(/scr_dyn_arr_push\s*\(/g) || []).length;
  // The ELEMENT LOOP, in each backend's own spelling. The C lane writes the
  // `for` verbatim; the LLVM lane has no `for` at all, so the marker is the
  // length call and the `tda.` block labels the array converter names its
  // blocks with. A tuple has neither, which is exactly the distinction the
  // price needs: a tuple's push count is final, an array's is not.
  const loops =
    /for \(size_t i = 0; i < v->len/.test(b) || /@scr_arr_len\b/.test(b) || /^tda\.c\d+:/m.test(b);
  const isUnion =
    /switch \(v->tag\)/.test(b) || /^tdu\.(?:a|bad)\d*:/m.test(b) || /label %tdu\./.test(b);
  let ctor = null;
  let share = null;
  for (const [sym, kind, mode] of CTORS) {
    if (new RegExp(`\\b${sym}\\s*\\(`).test(b) || new RegExp(`@${sym}\\b`).test(b)) {
      ctor = kind;
      share = mode;
      break;
    }
  }
  if (ctor === null && /scr_dyn_retain/.test(b) && children.length === 0 && !isUnion) {
    ctor = "passthrough";
    share = "free";
  }
  return { ...h, children, nSet, nSlot, nPush, names, loops, isUnion, ctor, share };
}

/* ── which types have a FINITE box at all ─────────────────────────────
 *
 * A type whose converter can reach ITSELF has no bounded dyn image: the copy
 * is as deep as the value, and the value's depth is a run-time fact. zapo is
 * full of these — a WhatsApp message shape carries buttons that carry
 * messages — and the FIRST version of this file summed such a graph anyway,
 * memoising only the acyclic nodes. It printed 72,722,288 bytes for one
 * five-field record: the same shared subtrees re-walked down every path
 * through the DAG. That number was wrong in the direction of this lane's own
 * argument, which is the one direction a measurement must never be wrong in,
 * so a type that reaches a cycle now gets `bytes: null` and a stated LOWER
 * BOUND per level, never a total.
 *
 * `reachesCycle` is computed ONCE, over the whole graph, before any pricing
 * — which is also what makes the memo sound: with the cyclic set known, the
 * price of an acyclic node is path-independent and can be cached. */
export function reachesCycleSet(helpers) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map();
  const bad = new Set();
  const visit = (n) => {
    const c = color.get(n) ?? WHITE;
    if (c === GREY) { bad.add(n); return true; }
    if (c === BLACK) return bad.has(n);
    color.set(n, GREY);
    let hit = false;
    const h = helpers.get(n);
    for (const ch of h ? h.children : []) if (visit(ch)) hit = true;
    color.set(n, BLACK);
    if (hit) bad.add(n);
    return hit;
  };
  for (const n of helpers.keys()) visit(n);
  return bad;
}

/* ── the price ────────────────────────────────────────────────────────
 * An acyclic type gets an exact total. A type that reaches a cycle gets
 * `bytes: null` plus `floor`: the node, its own table, and one node for each
 * direct child — the least the FIRST level can cost, and explicitly a bound
 * rather than a figure. */
export function price(helpers, name, cyclic = null, memo = new Map()) {
  if (cyclic === null) cyclic = reachesCycleSet(helpers);
  if (memo.has(name)) return memo.get(name);
  const h = helpers.get(name);
  if (!h) return { bytes: 0, nodes: 0, recursive: false, unbounded: true, perElem: 0, missing: true };
  if (cyclic.has(name)) {
    const table =
      h.ctor === "obj" ? mallocPhys(ENTRY_B * capFor(h.nSet))
      : h.ctor === "arr" && !h.loops ? mallocPhys(ITEM_B * capFor(h.nPush))
      : 0;
    const r = {
      bytes: null,
      floor: NODE_B + table + NODE_B * h.children.length,
      nodes: null,
      recursive: true,
      unbounded: true,
      perElem: 0,
    };
    memo.set(name, r);
    return r;
  }
  let bytes = 0;
  let nodes = 0;
  let recursive = false;
  let unbounded = false;
  let perElem = 0;
  if (h.ctor === "passthrough" || h.ctor === "undefined") {
    // A `dyn` member passes through by reference and the undefined value is
    // ONE immortal node the whole process shares: neither allocates.
  } else if (h.ctor === "obj") {
    nodes = 1;
    bytes = NODE_B + mallocPhys(ENTRY_B * capFor(h.nSet));
    for (const c of h.children) {
      const p = price(helpers, c, cyclic, memo);
      bytes += p.bytes;
      nodes += p.nodes;
      recursive ||= p.recursive;
      unbounded ||= p.unbounded;
      perElem += p.perElem;
    }
  } else if (h.ctor === "arr") {
    nodes = 1;
    if (h.loops) {
      // An array of runtime length: the node is per VALUE, everything below
      // it — the item slot and the element's own tree — is per ELEMENT.
      bytes = NODE_B;
      unbounded = true;
      for (const c of h.children) {
        const p = price(helpers, c, cyclic, memo);
        perElem += p.bytes + ITEM_B + p.perElem;
        recursive ||= p.recursive;
      }
      if (h.children.length === 0) perElem += NODE_B + ITEM_B; // f64/bool fast paths
    } else {
      // A TUPLE: a fixed number of pushes, so the total is exact.
      bytes = NODE_B + mallocPhys(ITEM_B * capFor(h.nPush));
      for (const c of h.children) {
        const p = price(helpers, c, cyclic, memo);
        bytes += p.bytes;
        nodes += p.nodes;
        recursive ||= p.recursive;
        unbounded ||= p.unbounded;
        perElem += p.perElem;
      }
    }
  } else if (h.isUnion) {
    // A union costs its WIDEST arm: the tag picks one at run time and a sum
    // of the arms would price a value that cannot exist.
    let worst = { bytes: 0, nodes: 0, perElem: 0 };
    for (const c of h.children) {
      const p = price(helpers, c, cyclic, memo);
      recursive ||= p.recursive;
      unbounded ||= p.unbounded;
      if (p.bytes > worst.bytes) worst = p;
    }
    bytes = worst.bytes || NODE_B;
    nodes = worst.nodes || 1;
    perElem = worst.perElem;
  } else {
    // Every by-reference kind, and every scalar: one node, payload shared.
    nodes = 1;
    bytes = NODE_B;
  }
  const r = { bytes, nodes, recursive, unbounded, perElem };
  memo.set(name, r);
  return r;
}

export function originCost() {
  return { min: ORIGIN_ENT_B / ORIGIN_LOAD, max: ORIGIN_ENT_B / (ORIGIN_LOAD / 2) };
}

export function analyze(text) {
  const { lang, helpers: raw } = parseHelpers(text);
  const helpers = new Map();
  for (const [k, v] of raw) helpers.set(k, classify(v));
  const rows = [];
  const cyclic = reachesCycleSet(helpers);
  const memo = new Map();
  for (const [name, h] of helpers) {
    const p = price(helpers, name, cyclic, memo);
    rows.push({ name, key: h.key, ctor: h.ctor, fields: h.nSet, names: [...h.names], ...p });
  }
  // A recursive row has no total to sort on, so it sorts on its floor —
  // and it can never outrank an exact row that is genuinely larger, because
  // the floor is the smaller number by construction.
  const w = (r) => (r.bytes === null ? r.floor : r.bytes);
  rows.sort((a, b) => w(b) - w(a) || b.perElem - a.perElem);
  return { lang, count: helpers.size, rows };
}

/* ── the report ───────────────────────────────────────────────────────── */
function fmt(n) {
  return n.toLocaleString("en-US");
}

function render(res, topN, filter, showNames) {
  const o = [];
  const oc = originCost();
  o.push(`BOXANAT  ${res.count} static-to-dyn converters in the artifact (${res.lang} lane)`);
  o.push(`         a dyn node is ${NODE_B} B; an OBJ table cap*${ENTRY_B} B; an ARR items cap*${ITEM_B} B;`);
  o.push(`         a boundary copy's origin slot is ${oc.min.toFixed(1)}-${oc.max.toFixed(1)} B, root only,`);
  o.push(`         and the origin holds a STRONG reference to the source for the box's whole life.`);
  o.push("");
  o.push("type                                                     nodes      bytes   +per elem  fields");
  let shown = 0;
  for (const r of res.rows) {
    if (filter && !r.key.includes(filter)) continue;
    if (shown++ >= topN) break;
    const flags =
      (r.recursive ? " RECURSIVE (bytes is a per-level floor)" : "") +
      (r.unbounded && !r.recursive ? " unbounded" : "") +
      (r.missing ? " MISSING" : "");
    const b = r.bytes === null ? `>=${fmt(r.floor)}` : fmt(r.bytes);
    const n = r.nodes === null ? "n/a" : fmt(r.nodes);
    o.push(
      `${r.key.slice(0, 52).padEnd(52)} ${n.padStart(8)} ${b.padStart(10)} ${String(fmt(r.perElem)).padStart(11)} ${String(r.fields || "").padStart(6)}${flags}`,
    );
    // The typeKey is the frontend's interning counter and names nothing a
    // reader can look up, so the members are what identify the shape.
    if (showNames && r.names && r.names.length) {
      o.push(`      ${r.names.slice(0, 10).join(", ")}${r.names.length > 10 ? `, +${r.names.length - 10} more` : ""}`);
    }
  }
  o.push("");
  const copies = res.rows.filter((r) => r.ctor === "obj" || r.ctor === "arr");
  const rec = res.rows.filter((r) => r.recursive);
  const exact = res.rows.filter((r) => r.bytes !== null);
  o.push(
    `${copies.length} of the ${res.count} converters COPY (record / array); the other ${res.count - copies.length} box by reference.`,
  );
  o.push(
    `${rec.length} reach a CYCLE, so their box has no bounded size — the figure above is the first level's floor,`,
  );
  o.push(`not a total. ${exact.length} have an exact one.`);
  if (exact.length) {
    const sorted = [...exact].sort((a, b) => a.bytes - b.bytes);
    const med = sorted[Math.floor(sorted.length / 2)].bytes;
    const sum = exact.reduce((a, b) => a + b.bytes, 0);
    o.push(
      `Of the exact ones: median ${fmt(med)} B, mean ${fmt(Math.round(sum / exact.length))} B, max ${fmt(sorted[sorted.length - 1].bytes)} B (${sorted[sorted.length - 1].key}).`,
    );
  }
  return o.join("\n");
}

/* ── the self-test ───────────────────────────────────────────────────────
 * Every control here is a way this file can be wrong and still print a
 * plausible number. It REFUSES rather than warns, for tests/perf/dyncensus's
 * reason: the figure is an argument for a representation change. */
function selfTest() {
  const fails = [];
  let checks = 0;
  const ok = (name, cond) => {
    checks++;
    if (!cond) fails.push(name);
  };

  ok("capFor(0)=0", capFor(0) === 0);
  ok("capFor(1)=1", capFor(1) === 1);
  ok("capFor(2)=2", capFor(2) === 2);
  ok("capFor(3)=4", capFor(3) === 4);
  ok("capFor(4)=4", capFor(4) === 4);
  ok("capFor(5)=8", capFor(5) === 8);
  // The grain measured by tests/perf/dyncensus, reproduced from its own
  // reported numbers: 996 objects at cap 2 cost 63,744 B physical and 996
  // at cap 4 cost 111,552 B, i.e. 64 and 112 apiece.
  ok("mallocPhys(48)=64", mallocPhys(ENTRY_B * 2) === 64);
  ok("mallocPhys(96)=112", mallocPhys(ENTRY_B * 4) === 112);
  ok("mallocPhys(16)=32", mallocPhys(ITEM_B * 2) === 32);
  ok("mallocPhys(0)=0", mallocPhys(0) === 0);

  // A synthetic artifact in BOTH spellings, for the shape the anatomy probe
  // measures: record { id: string; n: number; inner: { a: number; b: string };
  // tags: string[] }. Nine nodes at two tags — dyncensus measured 8.96 per
  // box over 1,000 retained boxes, which is nine minus the snapshot band.
  const cText = [
    "static ScrDyn *sc_td_1(ScrStr *v) { /* to-dyn string */",
    "  return scr_dyn_new_str(v);",
    "}",
    "static ScrDyn *sc_td_2(double v) { /* to-dyn f64 */",
    "  return scr_dyn_new_num(v);",
    "}",
    "static ScrDyn *sc_td_3(sc_rs_r0 *v) { /* to-dyn record:r0 */",
    "  ScrDyn *d = scr_dyn_new_obj();",
    '  scr_dyn_obj_set_lit(d, "a", 1, sc_td_2(v->sc_fld_a));',
    '  scr_dyn_obj_set_lit(d, "b", 1, sc_td_1(v->sc_fld_b));',
    "  return d;",
    "}",
    "static ScrDyn *sc_td_4(ScrArr *v) { /* to-dyn array<string> */",
    "  ScrDyn *d = scr_dyn_new_arr();",
    "  for (size_t i = 0; i < v->len; i++) {",
    "    ScrStr *e = (ScrStr *)scr_arr_get_ref(v, (double)i);",
    "    scr_dyn_arr_push(d, sc_td_1(e));",
    "    scr_str_release(e);",
    "  }",
    "  return d;",
    "}",
    "static ScrDyn *sc_td_0(sc_rs_r1 *v) { /* to-dyn record:r1 */",
    "  ScrDyn *d = scr_dyn_new_obj();",
    '  scr_dyn_obj_set_lit(d, "id", 2, sc_td_1(v->sc_fld_id));',
    '  scr_dyn_obj_set_lit(d, "n", 1, sc_td_2(v->sc_fld_n));',
    '  scr_dyn_obj_set_lit(d, "inner", 5, sc_td_3(v->sc_fld_inner));',
    '  scr_dyn_obj_set_lit(d, "tags", 4, sc_td_4(v->sc_fld_tags));',
    "  return d;",
    "}",
  ].join("\n");
  const llText = [
    "define internal ptr @sc_td_1(ptr %v) #0 { ; to-dyn string",
    "  %t0 = call ptr @scr_dyn_new_str(ptr %v)",
    "  ret ptr %t0",
    "}",
    "define internal ptr @sc_td_2(double %v) #0 { ; to-dyn f64",
    "  %t0 = call ptr @scr_dyn_new_num(double %v)",
    "  ret ptr %t0",
    "}",
    "define internal ptr @sc_td_3(ptr %v) #0 { ; to-dyn record:r0",
    "  %t0 = call ptr @scr_dyn_new_obj()",
    "  %t4 = call ptr @sc_td_2(double %t3)",
    "  call void @scr_dyn_obj_set_lit(ptr %t0, ptr @sc_cs_2, i64 1, ptr %t4)",
    "  %t7 = call ptr @sc_td_1(ptr %t6)",
    "  call void @scr_dyn_obj_set_lit(ptr %t0, ptr @sc_cs_3, i64 1, ptr %t7)",
    "  ret ptr %t0",
    "}",
    // Copied from a real artifact, block labels and all: the loop marker
    // this lane keys on is the emitter's own, not a paraphrase of one.
    "define internal ptr @sc_td_4(ptr %v) #0 { ; to-dyn array<string>",
    "entry:",
    "  %s2 = alloca double",
    "  %t0 = call ptr @scr_dyn_new_arr()",
    "  %t1 = call double @scr_arr_len(ptr %v)",
    "  br label %tda.c0",
    "tda.c0:",
    "  %t3 = load double, ptr %s2",
    "  %t4 = fcmp olt double %t3, %t1",
    "  br i1 %t4, label %tda.b1, label %tda.e2",
    "tda.b1:",
    "  %t5 = call ptr @scr_arr_get_ref(ptr %v, double %t3) ; +1",
    "  %t6 = call ptr @sc_td_1(ptr %t5)",
    "  call void @scr_dyn_arr_push(ptr %t0, ptr %t6)",
    "  br label %tda.c0",
    "tda.e2:",
    "  ret ptr %t0",
    "}",
    "define internal ptr @sc_td_0(ptr %v) #0 { ; to-dyn record:r1",
    "  %t0 = call ptr @scr_dyn_new_obj()",
    "  %t4 = call ptr @sc_td_1(ptr %t3)",
    "  call void @scr_dyn_obj_set_lit(ptr %t0, ptr @sc_cs_0, i64 2, ptr %t4)",
    "  %t7 = call ptr @sc_td_2(double %t6)",
    "  call void @scr_dyn_obj_set_lit(ptr %t0, ptr @sc_cs_1, i64 1, ptr %t7)",
    "  %t10 = call ptr @sc_td_3(ptr %t9)",
    "  call void @scr_dyn_obj_set_lit(ptr %t0, ptr @sc_cs_4, i64 5, ptr %t10)",
    "  %t13 = call ptr @sc_td_4(ptr %t12)",
    "  call void @scr_dyn_obj_set_lit(ptr %t0, ptr @sc_cs_5, i64 4, ptr %t13)",
    "  ret ptr %t0",
    "}",
  ].join("\n");
  const c = analyze(cText);
  const l = analyze(llText);
  ok("c lane parses 5 converters", c.count === 5);
  ok("ll lane parses 5 converters", l.count === 5);
  ok("c lane detected as c", c.lang === "c");
  ok("ll lane detected as ll", l.lang === "ll");

  const cRoot = c.rows.find((r) => r.key === "record:r1");
  const lRoot = l.rows.find((r) => r.key === "record:r1");
  ok("c lane priced the root", !!cRoot);
  ok("ll lane priced the root", !!lRoot);
  // THE CROSS-LANE CHECK. Both backends emit the same converter, so the two
  // artifacts must price identically. A difference here is a parser bug in
  // one lane, and it is the failure this file is most exposed to.
  ok("both lanes agree on bytes", cRoot && lRoot && cRoot.bytes === lRoot.bytes);
  ok("both lanes agree on nodes", cRoot && lRoot && cRoot.nodes === lRoot.nodes);
  ok("both lanes agree per elem", cRoot && lRoot && cRoot.perElem === lRoot.perElem);

  // The arithmetic, spelled out so a change to the model cannot pass silently:
  //   root  OBJ node 64 + table cap 4 -> mallocPhys(96) = 112
  //   id    STR node 64
  //   n     NUM node 64
  //   inner OBJ node 64 + table cap 2 -> mallocPhys(48) = 64, + a 64 + a 64
  //   tags  ARR node 64, unbounded, 64 + 8 per element
  const want = 64 + 112 + 64 + 64 + (64 + 64 + 64 + 64) + 64;
  ok(`root bytes = ${want}`, cRoot && cRoot.bytes === want);
  ok("root nodes = 7 bounded", cRoot && cRoot.nodes === 7);
  ok("root is unbounded (an array below it)", cRoot && cRoot.unbounded === true);
  ok("root per element = 72", cRoot && cRoot.perElem === 72);
  // ...and the two-element instance the anatomy probe actually holds:
  ok("nine nodes at 2 tags", cRoot && cRoot.nodes + 2 === 9);
  const total = cRoot ? cRoot.bytes + mallocPhys(ITEM_B * capFor(2)) + 2 * NODE_B : 0;
  ok("784 B at 2 tags", total === 784);

  // THE RECURSION REFUSAL. A shape that carries itself — zapo is full of
  // them, a message shape whose buttons carry messages — has no bounded dyn
  // image, and the first version of this file summed one anyway and printed
  // 72,722,288 B for a five-field record. Both the node ON the cycle and the
  // node that merely REACHES it must refuse a total.
  const cycText = [
    "static ScrDyn *sc_td_0(sc_rs_a *v) { /* to-dyn record:a */",
    "  ScrDyn *d = scr_dyn_new_obj();",
    '  scr_dyn_obj_set_lit(d, "b", 1, sc_td_1(v->sc_fld_b));',
    "  return d;",
    "}",
    "static ScrDyn *sc_td_1(sc_rs_b *v) { /* to-dyn record:b */",
    "  ScrDyn *d = scr_dyn_new_obj();",
    '  scr_dyn_obj_set_lit(d, "a", 1, sc_td_0(v->sc_fld_a));',
    "  return d;",
    "}",
    "static ScrDyn *sc_td_2(sc_rs_top *v) { /* to-dyn record:top */",
    "  ScrDyn *d = scr_dyn_new_obj();",
    '  scr_dyn_obj_set_lit(d, "a", 1, sc_td_0(v->sc_fld_a));',
    "  return d;",
    "}",
  ].join("\n");
  const cy = analyze(cycText);
  const rowA = cy.rows.find((r) => r.key === "record:a");
  const rowTop = cy.rows.find((r) => r.key === "record:top");
  ok("a cyclic type refuses a total", rowA && rowA.bytes === null && rowA.recursive === true);
  ok("a cyclic type still states a floor", rowA && rowA.floor === 64 + 32 + 64);
  ok("reaching a cycle also refuses", rowTop && rowTop.bytes === null && rowTop.recursive === true);
  // ...and the control that says the refusal is not blanket: an ACYCLIC type
  // in the same artifact must still get an exact total.
  const cyMix = analyze(
    cycText +
      "\nstatic ScrDyn *sc_td_3(ScrStr *v) { /* to-dyn string */\n  return scr_dyn_new_str(v);\n}\n",
  );
  ok("an acyclic type beside a cycle is still exact", cyMix.rows.find((r) => r.key === "string")?.bytes === 64);

  // A POSITIVE CONTROL on the parser: an artifact with no converters must
  // read as zero, and an artifact whose converter is UNLABELLED must not be
  // silently counted.
  ok("empty artifact reads 0", analyze("int main(void){return 0;}").count === 0);
  ok(
    "unlabelled converter is not counted",
    analyze("static ScrDyn *sc_td_9(int v) {\n  return scr_dyn_new_obj();\n}\n").count === 0,
  );
  // ...and the control that says the checks above CAN fail: a model that got
  // the capacity rule wrong must be caught by one of them.
  ok("a wrong cap rule would be caught", capFor(3) !== 3);

  if (fails.length) {
    console.error("SELF-TEST FAILED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log(`boxanat self-test: ok (${checks} checks, both lanes)`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: boxanat.mjs <program.c|program.ll> [--top N] [--json] [--names] [--type <key>]");
    process.exit(2);
  }
  const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 40;
  const filter = args.includes("--type") ? args[args.indexOf("--type") + 1] : null;
  const res = analyze(readFileSync(file, "utf8"));
  if (args.includes("--json")) console.log(JSON.stringify(res, null, 2));
  else console.log(render(res, topN, filter, args.includes("--names")));
}

if (process.argv[1] && process.argv[1].endsWith("boxanat.mjs")) main();
