#!/usr/bin/env node
// unioncensus.mjs — how many union-typed fields could stop allocating.
//
//   node unioncensus.mjs <program.ir.json> [--reconcile <program.c>] [--list] [--json]
//   node unioncensus.mjs --self-test
//
// Build the input with `scriptc build <entry> --emit-ir`.
//
// WHY. A field typed `T | null` is not a nullable pointer: it is an
// `ScrUnion *` pointing at a separate 64-byte cycle-headered allocation, one
// per populated field per instance (tests/perf/boxanat/README.md). A UNIT arm
// costs nothing — it is an immortal static singleton.
//
// The obvious fix only applies to one shape. For a union of exactly TWO arms,
// one of them a unit arm and the other POINTER-SHAPED, the tag is implied by
// null-ness and the three RC hooks are constant for the field, so the field
// could be a plain nullable pointer and the allocation disappears. Every other
// union genuinely needs the tag and the slot:
//
//   - three or more arms: null-ness cannot encode the tag;
//   - a SCALAR arm (f64/bool): the value lives in `slot`, and there is no
//     pointer to be null;
//   - two ref arms: null-ness distinguishes neither.
//
// So the prize is not "7,666 union fields". It is however many of them are
// that one shape, and this counts them.
//
// ARITY IS ONLY IN THE IR. `IrUnionDef.arms` carries it; the emitted C has
// lowered every union to the same `ScrUnion *` and kept no record of how many
// arms it had. The tag histogram of the constructor calls in the C
// (7,605 at tag 0, 3,459 at tag 1, …) HINTS at arity and cannot settle it —
// a 5-arm union constructed only at tag 0 is indistinguishable there from a
// 2-arm one. Do not quote it for arity.
//
// WHAT THIS DOES NOT ANSWER. Whether a collapse is SOUND for a given field.
// Deleting the `ScrUnion` deletes a node from the collector's graph, so the
// owning record's trace has to visit the field directly instead; whether that
// is needed depends on the emitter's per-shape cycle grading, which is not in
// the IR. This lane reports the ref arm's KIND so that follow-up has a list
// to work from, and claims nothing about it.

import { readFileSync, statSync } from "node:fs";

/** Loading a big IR dump, with the failure named rather than thrown raw.
 *
 * zapo's emitted C is 163 MB across fifteen translation units, so its IR JSON
 * is large enough that `readFileSync(..., "utf8")` can exceed V8's maximum
 * string length before `JSON.parse` is ever reached. That failure surfaces as
 * a bare "Invalid string length" with no file and no size, which is a
 * fifteen-minute detour the first time somebody meets it. */
export function loadIr(path) {
  let size = -1;
  try { size = statSync(path).size; } catch { /* reported below */ }
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const mb = size >= 0 ? (size / 1048576).toFixed(1) + " MB" : "unknown size";
    // Only the LENGTH failure gets the streaming advice. A missing or
    // unreadable file got it too in the first version, which sent the reader
    // hunting for a V8 limit when the path was simply wrong.
    const isLength = /string length|Invalid string/i.test(e.message);
    throw new Error(
      `could not read ${path} (${mb}) as one string: ${e.message}` +
      (isLength
        ? ". V8 caps string length; an IR dump this large needs a streaming reader, not a bigger --max-old-space-size."
        : ""),
    );
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} (${(text.length / 1048576).toFixed(1)} MB of text) is not valid JSON: ${e.message}`);
  }
}


/** Unit arms carry no payload — the compiler emits one immortal static
 * singleton per (union, tag) and every instance takes its address. */
const UNIT = new Set(["undefinedT", "nullT"]);
/** Arms whose payload IS a pointer, so null-ness can encode the tag. `string`
 * is here because a `ScrStr *` is a pointer like any other. */
const POINTER = new Set([
  "record", "array", "object", "bytes", "map", "set", "promise", "string", "dyn", "bigint",
]);
/** Arms whose payload lives in the union's 8-byte `slot`. A nullable pointer
 * has nowhere to put these, and 0 is a legal value for both. */
const SCALAR = new Set(["f64", "bool"]);

export function classifyUnion(def) {
  const arms = def.arms ?? [];
  const kinds = arms.map((a) => (a && a.kind) || "?");
  const units = kinds.filter((k) => UNIT.has(k));
  const refs = kinds.filter((k) => POINTER.has(k));
  const scalars = kinds.filter((k) => SCALAR.has(k));
  const other = kinds.filter((k) => !UNIT.has(k) && !POINTER.has(k) && !SCALAR.has(k));
  let verdict;
  if (arms.length !== 2) verdict = "multi-arm";
  else if (other.length > 0) verdict = "unmodelled-arm";
  else if (units.length === 1 && refs.length === 1) verdict = "COLLAPSIBLE";
  else if (scalars.length > 0) verdict = "scalar-arm";
  else if (units.length === 2) verdict = "two-unit";
  else verdict = "two-ref";
  return {
    id: def.id,
    arity: arms.length,
    kinds,
    verdict,
    refArm: verdict === "COLLAPSIBLE" ? refs[0] : null,
  };
}

export function analyze(mod) {
  const byId = new Map();
  for (const d of mod.unions ?? []) byId.set(d.id, classifyUnion(d));

  // Weight by USE: a union with one field costs less than the same union
  // behind forty. Counted over declared record fields, which is what the
  // emitted `ScrUnion *` slots are.
  const fieldsPer = new Map();
  for (const s of mod.records ?? []) {
    for (const f of s.fields ?? []) {
      if (!f.type || f.type.kind !== "union") continue;
      const id = f.type.unionId;
      fieldsPer.set(id, (fieldsPer.get(id) ?? 0) + 1);
    }
  }
  const rows = [];
  for (const [id, c] of byId) rows.push({ ...c, fields: fieldsPer.get(id) ?? 0 });
  // A union used by a field but absent from `unions` is a hole, not a zero.
  for (const [id, n] of fieldsPer) {
    if (!byId.has(id)) rows.push({ id, arity: null, kinds: [], verdict: "MISSING-DEF", refArm: null, fields: n });
  }
  rows.sort((a, b) => b.fields - a.fields);
  return rows;
}

/** THE CROSS-LANE CONTROL, and it runs before either number is quoted.
 *
 * The IR says how many record fields are union-typed. The emitted C says the
 * same thing independently: every one of them is an `ScrUnion *` slot in a
 * `struct sc_rs_r<n>`. Two readers, two artifacts, one number -- and if they
 * disagree, one of them is wrong and NEITHER figure may be used.
 *
 * This is not decoration. Both of this block's earlier readers produced a
 * confident zero from a pattern that did not match the split build, and the
 * only thing that would have caught either at the time was a second count of
 * the same quantity from a different file. */
export function countUnionFieldsInC(text) {
  const lines = text.split(/\r?\n/);
  const head = /^struct (sc_rs_r[0-9]+) \{/;
  const fld = /^\s+ScrUnion \*sc_fld_/;
  let inStruct = false;
  let n = 0;
  const shapes = new Set();
  for (const l of lines) {
    const h = head.exec(l);
    if (h) { inStruct = true; shapes.add(h[1]); continue; }
    if (!inStruct) continue;
    if (l.startsWith("};")) { inStruct = false; continue; }
    if (fld.test(l)) { n++; }
  }
  return { fields: n, shapes: shapes.size };
}

export function reconcile(irFields, cFields) {
  return {
    ir: irFields, c: cFields, agree: irFields === cFields,
    delta: irFields - cFields,
  };
}

export function summarise(rows) {
  const byVerdict = new Map();
  const fieldsBy = new Map();
  for (const r of rows) {
    byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);
    fieldsBy.set(r.verdict, (fieldsBy.get(r.verdict) ?? 0) + r.fields);
  }
  return { byVerdict, fieldsBy, unions: rows.length,
           fields: rows.reduce((a, b) => a + b.fields, 0) };
}

const ORDER = ["COLLAPSIBLE", "multi-arm", "scalar-arm", "two-ref", "two-unit",
               "unmodelled-arm", "MISSING-DEF"];

function render(rows, list, topN) {
  const s = summarise(rows);
  const o = [];
  o.push(`UNIONCENSUS  ${s.unions} union definitions behind ${s.fields} declared record fields`);
  o.push("");
  o.push("verdict            unions   fields   (a field is one ScrUnion * slot)");
  for (const k of ORDER) {
    if (!s.byVerdict.has(k)) continue;
    o.push(`  ${k.padEnd(16)} ${String(s.byVerdict.get(k)).padStart(6)}   ${String(s.fieldsBy.get(k) ?? 0).padStart(6)}`);
  }
  const cf = s.fieldsBy.get("COLLAPSIBLE") ?? 0;
  o.push("");
  o.push(`${cf} of ${s.fields} union-typed fields (${s.fields ? (100 * cf / s.fields).toFixed(1) : "0.0"}%) are the two-arm`);
  o.push("unit+pointer shape a nullable pointer could carry with no allocation.");
  o.push(`At 64 B per populated field per instance, that is the ceiling on the fix.`);
  o.push("");
  o.push("NOT answered here: whether a collapse is SOUND for a given field. Removing the");
  o.push("ScrUnion removes a node from the collector's graph, so the owning record's trace");
  o.push("must visit the field instead — and per-shape cycle grading is not in the IR.");
  if (list) {
    o.push("");
    o.push("union      arity  fields  verdict           ref arm");
    for (const r of rows.slice(0, topN)) {
      o.push(`${String(r.id).padEnd(10)} ${String(r.arity ?? "?").padStart(5)}  ${String(r.fields).padStart(6)}  ${r.verdict.padEnd(16)}  ${r.refArm ?? ""}`);
    }
  }
  return o.join("\n");
}

/* ── the self-test ───────────────────────────────────────────────────────
 * Every fixture below is written from the schema (`IrUnionDef` in
 * ir/nodes.ts: `arms` is an IrType[] in canonical order, and an arm's index
 * IS its runtime tag), and the schema reading has since been confirmed
 * against a real artifact: on app182 this lane counts 7,666 union-typed
 * record fields and the emitted `.scrh` independently counts 7,666
 * `ScrUnion *` struct slots. That agreement is what licenses the census, and
 * `--reconcile` re-runs it on every invocation rather than trusting it once. */
function selfTest() {
  const fails = [];
  let n = 0;
  const ok = (name, c) => { n++; if (!c) fails.push(name); };
  const U = (id, ...kinds) => ({ id, arms: kinds.map((k) => ({ kind: k })) });

  ok("null + record is collapsible", classifyUnion(U("u0", "nullT", "record")).verdict === "COLLAPSIBLE");
  ok("undefined + record is collapsible", classifyUnion(U("u1", "undefinedT", "record")).verdict === "COLLAPSIBLE");
  ok("undefined + string is collapsible", classifyUnion(U("u2", "undefinedT", "string")).verdict === "COLLAPSIBLE");
  ok("it names the ref arm", classifyUnion(U("u3", "nullT", "array")).refArm === "array");

  // The three shapes that genuinely need the tag and the slot.
  ok("three arms is not collapsible", classifyUnion(U("u4", "nullT", "record", "string")).verdict === "multi-arm");
  ok("a scalar arm is not collapsible", classifyUnion(U("u5", "nullT", "f64")).verdict === "scalar-arm");
  ok("bool is a scalar arm too", classifyUnion(U("u6", "undefinedT", "bool")).verdict === "scalar-arm");
  ok("two ref arms is not collapsible", classifyUnion(U("u7", "record", "string")).verdict === "two-ref");
  ok("null + undefined is not collapsible", classifyUnion(U("u8", "nullT", "undefinedT")).verdict === "two-unit");
  // An arm kind this file does not model must be named, never folded into a
  // verdict it has not earned.
  ok("an unmodelled arm is flagged", classifyUnion(U("u9", "nullT", "someNewKind")).verdict === "unmodelled-arm");

  // FIELD WEIGHTING. The prize is fields, not unions: one collapsible union
  // behind forty fields is worth forty allocations per instance-set.
  const mod = {
    unions: [U("u0", "nullT", "record"), U("u1", "nullT", "f64")],
    records: [{ id: "r0", fields: [
      { name: "a", type: { kind: "union", unionId: "u0" } },
      { name: "b", type: { kind: "union", unionId: "u0" } },
      { name: "c", type: { kind: "union", unionId: "u1" } },
      { name: "d", type: { kind: "f64" } },
    ] }],
  };
  const rows = analyze(mod);
  const s = summarise(rows);
  ok("counts fields, not unions", s.fields === 3);
  ok("a non-union field is not counted", s.fields !== 4);
  ok("collapsible fields weighted", s.fieldsBy.get("COLLAPSIBLE") === 2);
  ok("scalar-arm fields weighted", s.fieldsBy.get("scalar-arm") === 1);

  // A union a field names but the module does not define is a HOLE. Silently
  // dropping it would shrink the denominator and inflate the percentage — in
  // the direction that flatters the fix.
  const holed = analyze({ unions: [], records: [{ id: "r0", fields: [
    { name: "a", type: { kind: "union", unionId: "uZZ" } }] }] });
  ok("a missing definition is reported", holed[0]?.verdict === "MISSING-DEF");
  ok("...and still counted in the denominator", summarise(holed).fields === 1);

  // THE CROSS-LANE CONTROL. Counting ScrUnion * slots out of the emitted C is
  // the independent half; it has to see the SPLIT build's spelling, which is
  // what defeated two earlier readers in this block.
  const structC = [
    "struct sc_rs_r0 { /* record r0 { name; next } */",
    "  size_t rc;",
    "  ScrStr *sc_fld_name; /* name */",
    "  ScrUnion *sc_fld_next; /* next */",
    "};",
    "struct sc_rs_r1 {",
    "  size_t rc;",
    "  ScrUnion *sc_fld_a;",
    "  ScrUnion *sc_fld_b;",
    "};",
  ].join(String.fromCharCode(10));
  ok("counts ScrUnion * slots in the C", countUnionFieldsInC(structC).fields === 3);
  ok("a non-union field is not counted",
     countUnionFieldsInC(structC).fields !== 4);
  // A ScrUnion mentioned OUTSIDE a struct is not a field.
  ok("only struct members count",
     countUnionFieldsInC("ScrUnion *scr_union_new_ref(uint32_t tag);").fields === 0);
  ok("it counts the structs it saw", countUnionFieldsInC(structC).shapes === 2);
  // A part TU of a split build defines no structs; the CLI refuses on this
  // rather than reporting a delta that looks like reader disagreement.
  ok("a file with no structs reports zero shapes",
     countUnionFieldsInC("void sc_f_x(void) { ScrUnion *u; }").shapes === 0);
  ok("reconcile agrees when equal", reconcile(3, 3).agree === true);
  ok("reconcile disagrees when not", reconcile(3, 4).agree === false);
  ok("reconcile reports the delta", reconcile(3, 4).delta === -1);

  // Positive controls: an empty module reads zero, and the fixture above does
  // not — a census that can only say "nothing" is not a census.
  ok("empty module reads 0", analyze({ unions: [], records: [] }).length === 0);
  ok("the fixture is not empty", rows.length === 2);

  if (fails.length) {
    console.error("SELF-TEST FAILED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log(`unioncensus self-test: ok (${n} checks)`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const f = args.find((a) => !a.startsWith("--"));
  if (!f) {
    console.error("usage: unioncensus.mjs <program.ir.json> [--list] [--json] [--top N]");
    process.exit(2);
  }
  let rows;
  try {
    rows = analyze(loadIr(f));
  } catch (e) {
    // The same shape as every other refusal in this lane: one line
    // naming what could not be done, not a stack trace.
    console.error("REFUSED — " + e.message);
    process.exit(4);
  }
  const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 40;
  // --reconcile RUNS FIRST AND CAN REFUSE. Neither number below may be quoted
  // until the two artifacts agree on how many union-typed fields there are.
  if (args.includes("--reconcile")) {
    const cPath = args[args.indexOf("--reconcile") + 1];
    const c = countUnionFieldsInC(readFileSync(cPath, "utf8"));
    // A SPLIT BUILD PUTS EVERY STRUCT IN THE SHARED HEADER. zapo emits
    // fifteen translation units and one `.scrh`, and all 7,666 ScrUnion *
    // slots are in the header -- a part TU defines no record structs at all.
    // Without this, pointing --reconcile at a part gives "IR 7666, C 0",
    // which reads as a disagreement between the two readers when it is only
    // the wrong file.
    if (c.shapes === 0) {
      console.error(`REFUSED — ${cPath} defines no record structs at all.`);
      console.error("In a split build they live in the shared .scrh, not in the part TUs.");
      process.exit(3);
    }
    const irTotal = summarise(rows).fields;
    const r = reconcile(irTotal, c.fields);
    console.log(`RECONCILE  IR union-typed record fields : ${r.ir}`);
    console.log(`           C  ScrUnion * struct slots   : ${r.c}`);
    if (!r.agree) {
      console.error(`REFUSED — the two readers disagree by ${r.delta}. One of them is wrong,`);
      console.error("and NEITHER figure may be used until it is resolved.");
      process.exit(3);
    }
    console.log("           agree — the census below may be quoted.");
    console.log("");
  }
  if (args.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else console.log(render(rows, args.includes("--list"), topN));
}

if (process.argv[1] && process.argv[1].endsWith("unioncensus.mjs")) main();
