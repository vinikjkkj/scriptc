#!/usr/bin/env node
// unioncensus.mjs — how many union-typed fields could stop allocating.
//
//   node unioncensus.mjs <program.ir.json> [--list] [--json] [--top N]
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

import { readFileSync } from "node:fs";

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
 * THIS LANE HAS NOT YET BEEN RUN ON A REAL ARTIFACT. zapo's `--emit-ir` build
 * has not been taken, so every fixture below is written from the schema
 * (`IrUnionDef` in ir/nodes.ts: `arms` is an IrType[] in canonical order, and
 * an arm's index IS its runtime tag). That is stated rather than hidden: the
 * first real run has to be checked against the emitted `ScrUnion *` field
 * count, which tests/perf/boxanat's README records as 7,666 for app182. */
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

  // Positive controls: an empty module reads zero, and the fixture above does
  // not — a census that can only say "nothing" is not a census.
  ok("empty module reads 0", analyze({ unions: [], records: [] }).length === 0);
  ok("the fixture is not empty", rows.length === 2);

  if (fails.length) {
    console.error("SELF-TEST FAILED:\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log(`unioncensus self-test: ok (${n} checks) — NOT yet run on a real artifact`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const f = args.find((a) => !a.startsWith("--"));
  if (!f) {
    console.error("usage: unioncensus.mjs <program.ir.json> [--list] [--json] [--top N]");
    process.exit(2);
  }
  const rows = analyze(JSON.parse(readFileSync(f, "utf8")));
  const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 40;
  if (args.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else console.log(render(rows, args.includes("--list"), topN));
}

if (process.argv[1] && process.argv[1].endsWith("unioncensus.mjs")) main();
