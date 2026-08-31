// Array.isArray over FIXED TUPLES, and the reads that follow the guard.
// Promoted from tests/perf/upstream (upstream vercel-labs/scriptc #154,
// 1e4f71dd) the day it started passing. Node is the oracle.
//
// It covers three defects that were all live here, and the first two were
// SILENT: a tuple lowers to a positional record shape, so Array.isArray on
// one folded to a constant false, and a union narrowed by that fold took
// the wrong branch and then failed the union coercion at runtime. The
// third is the readonly spelling: `Array.isArray` is declared `arg is
// any[]`, a readonly tuple is not assignable to that, and the true branch
// comes back as the union of per-arm `& any[]` intersections -- a type
// that maps to nothing, so the element read, `.length`, `.slice`, `.map`
// and a const alias each fenced on a value the tag test had just proved.


// Fixed tuples use a positional record-shaped IR representation so each
// slot can keep its own type, but they are still JavaScript arrays. This is
// the Native SDK facade shape: an update returns either its model record or
// [model, command], then Array.isArray selects the tuple before indexing it.
interface TupleModel {
  n: number;
}

interface TupleCommand {
  op: string;
}

function tupleUpdate(model: TupleModel, effect: boolean): TupleModel | [TupleModel, TupleCommand] {
  if (!effect) return model;
  return [model, { op: "spawn" }];
}

function normalizeTuple(model: TupleModel, effect: boolean): [TupleModel, string] {
  const out = tupleUpdate(model, effect);
  if (Array.isArray(out)) return [out[0], out[1].op];
  return [out, "none"];
}

function isFixedTuple(value: [TupleModel, TupleCommand]): boolean {
  return Array.isArray(value);
}

// For a readonly tuple union, tsc narrows the guarded value to an
// intersection with any[] rather than directly to an array type. The
// runtime tag still proves the tuple arm, so positional reads must bridge
// back to its fixed shape.
type ReadonlyTupleResult = TupleModel | readonly [TupleModel, TupleCommand];
function describeReadonlyTuple(value: ReadonlyTupleResult): string {
  if (Array.isArray(value)) return `${value[0].n}:${value[1].op}`;
  return "plain";
}

// The checker keeps the same synthetic intersection for neighboring tuple
// operations. A const alias must retain the lowered tuple representation;
// then length, the supported read-only methods, and iteration all dispatch
// from that representation too.
function summarizeReadonlyTuple(value: ReadonlyTupleResult): string {
  if (!Array.isArray(value)) return "plain";
  const tuple = value;
  let visits = 0;
  for (const _part of tuple) visits++;
  return `${value.length}:${value.slice(0).length}:${value.map(() => "v").join("")}:${tuple.length}:${tuple.slice(0).length}:${tuple.map(() => "t").join("")}:${visits}`;
}

const plainResult = normalizeTuple({ n: 7 }, false);
console.log(plainResult[0].n, plainResult[1]);
const tupleResult = normalizeTuple({ n: 9 }, true);
console.log(tupleResult[0].n, tupleResult[1]);
console.log(isFixedTuple([{ n: 11 }, { op: "direct" }]));
const readonlyTuple: readonly [TupleModel, TupleCommand] = [{ n: 12 }, { op: "readonly" }];
console.log(describeReadonlyTuple({ n: 13 }));
console.log(describeReadonlyTuple(readonlyTuple));
console.log(summarizeReadonlyTuple({ n: 14 }));
console.log(summarizeReadonlyTuple(readonlyTuple));
