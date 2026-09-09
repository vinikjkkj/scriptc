#!/usr/bin/env node
// narrowcensus.mjs — which `unknown` slots never actually need to be dynamic.
//
//   node narrowcensus.mjs <program.ir.json> [--list] [--json] [--top N]
//   node narrowcensus.mjs --self-test
//
// Build the input with `scriptc build <entry> --emit-ir`.
//
// WHY. Boxing a record into an `unknown` slot materialises the whole
// reachable subtree, one 64-byte node per scalar (tests/perf/boxanat). Two
// routes shrink that; only ONE removes it. If every value that reaches a
// given slot has the same static type, and every read of that slot casts it
// straight back to that type, then the slot was never dynamic in the first
// place: it can carry the pointer, and the box, its member table, its whole
// subtree and its origin-table entry all cease to exist.
//
// That route cannot cost a cycle, because there is no run-time mechanism in
// it at all. It is the reason the narrowing pass goes first.
//
// THIS IS A CENSUS, NOT THE PASS. It measures how often the opportunity is
// real on a program the compiler has actually lowered, and it asks the same
// dataflow question the pass would have to answer — asked first, off the
// serialized IR, so the answer is checkable before any compiler source moves.
//
// IT READS THE IR, WHICH IS THE ONLY LEVEL THAT CAN ANSWER THIS. The emitted
// C and .ll have the crossings but have lost which record FIELD a value came
// out of, and a census over the 122 `dynFrom` creation sites in the frontend
// would be a census of the lowering rather than of the program.
//
// WHAT MAKES A SLOT NARROWABLE, and every clause is a way to be wrong:
//
//   1. every WRITE is a `dynFrom` of the same static type T. A write of some
//      other dyn — one that came from JSON, an island, another slot — is
//      opaque, and the slot has to stay dynamic.
//   2. every READ is consumed directly by a `dynCheck` back to that same T.
//      A read that flows anywhere else may be inspected dynamically, and
//      this lane cannot see where it goes.
//   3. there is at least one of each. A slot with no writes or no reads is
//      reported apart and never counted as a win, because "narrowable" for a
//      slot nothing uses is a number that flatters the route.
//
// WHICH ZAPO. This lane is about THE COMPILER'S BEHAVIOUR -- what its lowering
// does with an `unknown` field -- so the arm it is run on does not change the
// conclusion, and `app182` (zapo-js 1.8.2) is the one used because that is the
// artifact this block builds.
//
// SAY SO WHEREVER THE RESULT IS QUOTED, because every settled-memory figure
// this objective rests on came from `app/` (zapo-js 1.6.2): 2,794 B per
// retained value, 163.39 -> 104.50 MiB, the 105.14 MiB the census itemised.
// 1.6.2 downloads and decodes a history blob whole; 1.8.2 streams proto
// fields. They are different programs with different sync architectures, and
// anyone connecting a narrowable-slot count to a retention number is crossing
// that boundary -- which is allowed, and has to be deliberate. A slot that is
// narrowable in one version and not the other is a finding to name, never a
// union to take silently.
//
// WHAT IT COVERS, AND WHAT IT DOES NOT. Record FIELDS only. An `unknown` that
// is a module-level binding, an array element type, or a Map value is not a
// record field and is not counted here. The read-only survey of zapo-js 1.8.2
// source found 178 `unknown` slots that outlive their statement: 137 fields,
// 24 collection element types, 14 retained closure captures, 3 module
// bindings. So this lane sees about three quarters of them and is silent
// about the rest -- which matters most for the collection case, because the
// MCP event ring is exactly that shape.
//
// IT UNDER-COUNTS ON PURPOSE. A read that lands in a local and is cast on the
// next line is two expressions, and this lane sees only the first, so it
// scores `read-escapes`. Every such miss moves a slot OUT of the narrowable
// set. The number this prints is a floor.

import { readFileSync } from "node:fs";

/** A structural key for an IR type. NOT the compiler's `typeKey` — it is only
 * ever compared against another key from the SAME module, where structural
 * equality and interned identity agree. Spelled out because borrowing the
 * name would invite someone to join these rows against a table keyed by the
 * real one. */
export function tkey(t) {
  if (t === null || t === undefined) return "?";
  switch (t.kind) {
    case "record": return `record:${t.shapeId}`;
    case "union": return `union:${t.unionId}`;
    case "array": return `array<${tkey(t.elem)}>`;
    case "map": return `map<${tkey(t.key)},${tkey(t.value)}>`;
    case "set": return `set<${tkey(t.elem)}>`;
    case "object": return `class:${t.className}`;
    case "bytes": return `bytes<${t.elem}>`;
    case "promise": return `promise<${tkey(t.inner)}>`;
    default: return String(t.kind);
  }
}

const isDyn = (t) => t !== null && t !== undefined && t.kind === "dyn";

export function analyze(mod) {
  // The candidate slots: every record field the shape declares as dyn.
  const slots = new Map();
  for (const s of mod.records ?? []) {
    for (const f of s.fields ?? []) {
      if (!isDyn(f.type)) continue;
      slots.set(`record:${s.id}.${f.name}`, {
        slot: `record:${s.id}.${f.name}`, shapeId: s.id, field: f.name,
        writes: new Map(), opaqueWrites: 0,
        reads: 0, recovered: new Map(),
        indexSig: s.indexValue !== undefined,
      });
    }
  }

  const noteWrite = (row, val) => {
    if (val && val.kind === "dynFrom") {
      const t = tkey(val.value ? val.value.type : null);
      row.writes.set(t, (row.writes.get(t) ?? 0) + 1);
    } else {
      row.opaqueWrites++;
    }
  };

  // Reads consumed directly by a dynCheck are found from the dynCheck side,
  // so the walk needs no parent links: a `dynCheck` names its own operand.
  const walk = (v) => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }

    if (v.kind === "dynCheck" && v.value && v.value.kind === "recordGet") {
      const row = slots.get(`record:${v.value.shapeId}.${v.value.field}`);
      if (row) {
        const t = tkey(v.type);
        row.recovered.set(t, (row.recovered.get(t) ?? 0) + 1);
      }
    }
    if (v.kind === "recordGet" && isDyn(v.type)) {
      const row = slots.get(`record:${v.shapeId}.${v.field}`);
      if (row) row.reads++;
    }
    if (v.kind === "recordLit" && v.type && v.type.kind === "record") {
      for (const f of v.fields ?? []) {
        const row = slots.get(`record:${v.type.shapeId}.${f.name}`);
        if (row) noteWrite(row, f.value);
      }
    }
    if (v.kind === "recordSet") {
      const row = slots.get(`record:${v.shapeId}.${v.field}`);
      if (row) noteWrite(row, v.value);
    }
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(mod);

  for (const row of slots.values()) {
    const wt = [...row.writes.keys()];
    const rt = [...row.recovered.keys()];
    const recoveredReads = [...row.recovered.values()].reduce((a, b) => a + b, 0);
    row.recoveredReads = recoveredReads;
    row.otherReads = Math.max(0, row.reads - recoveredReads);
    row.mono = wt.length === 1 && row.opaqueWrites === 0;
    row.type = wt.length === 1 ? wt[0] : null;
    if (row.writes.size === 0 && row.opaqueWrites === 0 && row.reads === 0) {
      row.verdict = "unused";
    } else if (row.indexSig) {
      // An index-signature shape's `unknown` VALUES live in the overflow map,
      // not in a declared field: a different slot with different readers.
      row.verdict = "index-signature";
    } else if (!row.mono) {
      row.verdict = row.opaqueWrites > 0 ? "opaque-write" : "polymorphic";
    } else if (row.otherReads > 0) {
      row.verdict = "read-escapes";
    } else if (rt.length === 1 && rt[0] === row.type && recoveredReads > 0) {
      row.verdict = "NARROWABLE";
    } else if (recoveredReads === 0) {
      row.verdict = "write-only";
    } else {
      row.verdict = "recovered-at-another-type";
    }
  }
  return [...slots.values()];
}

export function summarise(rows) {
  const by = new Map();
  for (const r of rows) by.set(r.verdict, (by.get(r.verdict) ?? 0) + 1);
  return by;
}

const ORDER = ["NARROWABLE", "read-escapes", "polymorphic", "opaque-write",
               "write-only", "recovered-at-another-type", "index-signature", "unused"];

function render(rows, list, topN) {
  const by = summarise(rows);
  const o = [];
  o.push(`NARROWCENSUS  ${rows.length} record fields declared \`unknown\``);
  o.push("");
  for (const k of ORDER) if (by.has(k)) o.push(`  ${k.padEnd(26)} ${String(by.get(k)).padStart(5)}`);
  for (const [k, n] of by) if (!ORDER.includes(k)) o.push(`  ${k.padEnd(26)} ${String(n).padStart(5)}`);
  const win = by.get("NARROWABLE") ?? 0;
  const live = rows.filter((r) => r.verdict !== "unused" && r.verdict !== "index-signature").length;
  o.push("");
  o.push(`${win} of ${live} live \`unknown\` fields need no dynamic representation at all.`);
  o.push("A FLOOR: a read that lands in a local before its cast scores read-escapes.");
  if (list) {
    o.push("");
    o.push("slot                                        verdict                     w  r  written as");
    const sorted = [...rows].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || b.reads - a.reads);
    for (const r of sorted.slice(0, topN)) {
      o.push(`${r.slot.slice(0, 42).padEnd(42)}  ${r.verdict.padEnd(26)} ${String(r.writes.size + r.opaqueWrites).padStart(2)} ${String(r.reads).padStart(2)}  ${r.type ?? ""}`);
    }
  }
  return o.join("\n");
}

/* ── the self-test ──────────────────────────────────────────────────── */
function selfTest() {
  const fails = [];
  let n = 0;
  const ok = (name, c) => { n++; if (!c) fails.push(name); };

  const rec = (id, ...fields) => ({ id, fields: fields.map((f) => ({ name: f, type: { kind: "dyn" } })) });
  const dynFrom = (shapeId) => ({ kind: "dynFrom", value: { kind: "varRef", type: { kind: "record", shapeId } }, type: { kind: "dyn" } });
  const lit = (shapeId, field, val) => ({ kind: "recordLit", type: { kind: "record", shapeId }, fields: [{ name: field, value: val }] });
  const get = (shapeId, field) => ({ kind: "recordGet", shapeId, field, type: { kind: "dyn" } });
  const chk = (val, shapeId) => ({ kind: "dynCheck", value: val, type: { kind: "record", shapeId } });

  // THE WIN: one writer type, one reader, and the reader casts straight back.
  const winMod = {
    records: [rec("r0", "held"), { id: "r1", fields: [] }],
    functions: [{ body: [lit("r0", "held", dynFrom("r1")), chk(get("r0", "held"), "r1")] }],
  };
  const w = analyze(winMod);
  ok("one slot found", w.length === 1);
  ok("narrowable", w[0]?.verdict === "NARROWABLE");
  ok("names the type", w[0]?.type === "record:r1");

  // TWO writer types: the slot really is polymorphic.
  const polyMod = {
    records: [rec("r0", "held"), { id: "r1", fields: [] }, { id: "r2", fields: [] }],
    functions: [{ body: [lit("r0", "held", dynFrom("r1")), lit("r0", "held", dynFrom("r2")), chk(get("r0", "held"), "r1")] }],
  };
  ok("two writer types is polymorphic", analyze(polyMod)[0]?.verdict === "polymorphic");

  // A write that is NOT a dynFrom — a dyn from somewhere this lane cannot
  // see. Treating that as monomorphic would be this route's worst failure:
  // narrowing a slot that really does carry something else.
  const opaqueMod = {
    records: [rec("r0", "held"), { id: "r1", fields: [] }],
    functions: [{ body: [lit("r0", "held", { kind: "jsonParse" }), chk(get("r0", "held"), "r1")] }],
  };
  ok("a non-dynFrom write is opaque", analyze(opaqueMod)[0]?.verdict === "opaque-write");

  // A read that is NOT consumed by a dynCheck: it may be inspected
  // dynamically and this lane cannot follow it.
  const escapeMod = {
    records: [rec("r0", "held"), { id: "r1", fields: [] }],
    functions: [{ body: [lit("r0", "held", dynFrom("r1")), get("r0", "held")] }],
  };
  ok("an unconsumed read escapes", analyze(escapeMod)[0]?.verdict === "read-escapes");

  // Recovered at a DIFFERENT type than it was written at — a widening. The
  // slot is monomorphic in writes and still not narrowable.
  const wideMod = {
    records: [rec("r0", "held"), { id: "r1", fields: [] }, { id: "r2", fields: [] }],
    functions: [{ body: [lit("r0", "held", dynFrom("r1")), chk(get("r0", "held"), "r2")] }],
  };
  ok("recovered at another type is not a win",
     analyze(wideMod)[0]?.verdict === "recovered-at-another-type");

  // A slot with writes and no reads is NOT a win. Counting it would flatter
  // the route with slots nothing uses.
  const woMod = {
    records: [rec("r0", "held"), { id: "r1", fields: [] }],
    functions: [{ body: [lit("r0", "held", dynFrom("r1"))] }],
  };
  ok("write-only is not narrowable", analyze(woMod)[0]?.verdict === "write-only");
  ok("unused is its own bucket",
     analyze({ records: [rec("r0", "held")], functions: [] })[0]?.verdict === "unused");

  // recordSet writes count exactly as literal fields do.
  const setMod = {
    records: [rec("r0", "held"), { id: "r1", fields: [] }],
    functions: [{ body: [{ kind: "recordSet", shapeId: "r0", field: "held", value: dynFrom("r1") },
                         chk(get("r0", "held"), "r1")] }],
  };
  ok("recordSet counts as a write", analyze(setMod)[0]?.verdict === "NARROWABLE");

  // A NON-dyn field is not a slot at all.
  ok("a typed field is not a candidate",
     analyze({ records: [{ id: "r0", fields: [{ name: "x", type: { kind: "f64" } }] }], functions: [] }).length === 0);

  // Positive control on the walker: an empty module must read zero, and the
  // win fixture must not — a census that can only say "nothing" is not a
  // census.
  ok("empty module reads 0", analyze({ records: [], functions: [] }).length === 0);
  ok("the fixtures are not all empty", w.length > 0);

  if (fails.length) {
    console.error("SELF-TEST FAILED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log(`narrowcensus self-test: ok (${n} checks)`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const f = args.find((a) => !a.startsWith("--"));
  if (!f) {
    console.error("usage: narrowcensus.mjs <program.ir.json> [--list] [--json] [--top N]");
    process.exit(2);
  }
  const rows = analyze(JSON.parse(readFileSync(f, "utf8")));
  const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 40;
  if (args.includes("--json")) {
    console.log(JSON.stringify(rows.map((r) => ({ ...r, writes: [...r.writes], recovered: [...r.recovered] })), null, 2));
  } else {
    console.log(render(rows, args.includes("--list"), topN));
  }
}

if (process.argv[1] && process.argv[1].endsWith("narrowcensus.mjs")) main();
