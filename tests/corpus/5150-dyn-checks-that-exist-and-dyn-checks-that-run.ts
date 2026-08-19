// A program with many more dyn checks than it ever executes, so the difference
// between "a check EXISTS" and "a check RAN" has something behind it that runs.
//
// The DYNCHECK population is counted by tu-census.mjs as scr_dyn_check_fail
// statements, and the statements live inside INTERNED per-target-type
// validators (sc_dc_<n>) rather than at program sites. A record target with N
// declared members contributes N+1 statements by itself, and the program may
// enter that validator from one place, from many, or -- for a validator a
// parent walker only recurses into -- from none of its own.
//
// That makes the statement count a poor proxy for anything a run does, and
// until SCRIPTC_DC_COUNT there was no instrument that could tell the two
// readings apart: SCRIPTC_DC_WHERE only renames a path segment inside a message
// that only a FAILING check prints, and SCRIPTC_DC_CENSUS is compile-time.
//
// So this program is built to be lopsided on purpose:
//
//   * a WIDE record (many declared members, so many statements) entered ONCE;
//   * a NARROW validator (`string`) entered many times, because every member of
//     the wide record and every element of the arrays is one;
//   * a DEEP nest whose inner validators are reached only by recursion;
//   * a union whose arms are validated by a matcher and then re-validated by
//     the arm's builder -- the same tree walked twice;
//   * several targets that are declared and interned but whose branch this run
//     never takes at all.
//
// Its OUTPUT is ordinary and must match Node exactly: the counting is a dial,
// and a dial that changes an answer is not an instrument. Every cast below is
// one Node accepts, so nothing here refuses -- with one deliberate exception at
// the end, caught, so the failing arm has a value too.

type Wide = {
  a1: string; a2: string; a3: string; a4: string; a5: string;
  b1: number; b2: number; b3: number;
  c1: boolean; c2: boolean;
  tags: string[];
  note?: string;
};

type Leaf = { v: string };
type Mid = { leaf: Leaf; more: Leaf[] };
type Deep = { mid: Mid; label: string };

type Small = { k: string };
type Either = Small | string | number;

// Interned but never entered on this run: the emitter plants the validator
// because the cast is reachable in the source, and the branch that takes it is
// not. This is the shape that makes "statements" and "executions" diverge.
type NeverA = { x1: string; x2: string; x3: string; x4: string };
type NeverB = { y1: number; y2: number; y3: number };

const WIDE = '{"a1":"p","a2":"q","a3":"r","a4":"s","a5":"t",' +
  '"b1":1,"b2":2,"b3":3,"c1":true,"c2":false,"tags":["x","y","z"]}';
const DEEP = '{"mid":{"leaf":{"v":"core"},"more":[{"v":"m1"},{"v":"m2"}]},"label":"L"}';

function readWide(raw: string): string {
  const w = JSON.parse(raw) as Wide;
  return w.a1 + w.a5 + String(w.b1 + w.b3) + (w.c1 ? "T" : "F") +
    w.tags.join("") + (w.note === undefined ? "-" : w.note);
}

function readDeep(raw: string): string {
  const d = JSON.parse(raw) as Deep;
  return d.label + ":" + d.mid.leaf.v + ":" + d.mid.more.map((m) => m.v).join(",");
}

// The union: the matcher decides the arm, then the arm's own builder validates
// the very same value again. Both walks happen on every call.
function readEither(raw: string): string {
  const e = JSON.parse(raw) as Either;
  if (typeof e === "string") return "s=" + e;
  if (typeof e === "number") return "n=" + String(e);
  return "k=" + e.k;
}

// Never called with a value that reaches it -- the guard is false on this run,
// so both validators are emitted and neither is entered.
function unreached(flag: boolean, raw: string): string {
  if (!flag) return "skipped";
  const a = JSON.parse(raw) as NeverA;
  const b = JSON.parse(raw) as NeverB;
  return a.x1 + String(b.y1);
}

function main(): void {
  // Entered once: one wide validator, many narrow ones underneath it.
  console.log(readWide(WIDE));

  // Entered repeatedly: the SAME interned validators, many executions.
  let acc = "";
  for (let i = 0; i < 5; i++) acc += readDeep(DEEP);
  console.log(acc.length, acc.slice(0, 13));

  // Three arms of one union, each selected on a different run through.
  console.log(readEither('"hello"'), readEither("7"), readEither('{"k":"kv"}'));

  // Declared, interned, never entered.
  console.log(unreached(false, "{}"));

  // One deliberate refusal, so the FAILING counter has a value too -- and it
  // has to be a refusal NODE ALSO MAKES, or this program would stop being a
  // differential fixture. `null as Small` is that case: scriptc refuses at the
  // cast ("expected object at $, got null") and Node refuses at the member read
  // ("Cannot read properties of null"), so both throw and only the message
  // differs. The message is deliberately NOT printed.
  //
  // The refusals scriptc makes and Node does NOT -- a required member that is
  // absent, or present with the wrong type -- are the documented
  // check-and-extract stance and belong in a test that can assert them
  // directly; they are pinned in tests/harness/dyncheck.test.ts, not here.
  let refused = "no-throw";
  try {
    const bad = JSON.parse("null") as Small;
    refused = "read " + bad.k;
  } catch {
    refused = "caught";
  }
  console.log(refused);
}

main();
export {};
