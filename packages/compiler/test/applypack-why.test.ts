/* The SCRIPTC_APPLYPACK_WHY instrument, tested — on the same ground
 * unionslot-why.test.ts states: an instrument whose only proof is that
 * somebody looked at its output once is not an instrument.
 *
 * WHAT IT IS FOR. `fn.apply(thisArg, pack)` with a RUNTIME-LENGTH pack has
 * five independent ways to be refused and one way to be built, and the
 * fence's own text names none of them — it says "Function.prototype.apply on
 * a compiled function value", which is true of the closed sites too. The one
 * a reader must be able to see is `receiver-parameter-not-dyn`: a non-dyn
 * parameter reached by a SHORT pack throws where Node passes `undefined` and
 * lets the body make NaN, and keeping that divergence OUT of a path that used
 * to refuse is the whole soundness argument for the arm. A reader who cannot
 * tell it from "the receiver never lowered" cannot check the argument.
 *
 *   CLOSED-BY=dyn-apply-pack            boxed and routed to scr_dyn_invoke;
 *   NOT-CLOSED=receiver-parameter-not-dyn:[kinds]   the armed half;
 *   NOT-CLOSED=receiver-did-not-lower               no function value;
 *   (and receiver-not-a-func / receiver-has-an-island-rest-abi /
 *    receiver-does-not-box / operands-do-not-reach-dyn, which no reduction
 *    in this file produces — they are named here so a reader knows the
 *    population is six, not three.)
 *
 * The STATIC spellings must produce NO row at all: an array-literal `apply`
 * and a `call` both compute a static argument list and never reach the arm.
 * That is the armed half of the instrument itself — one that printed a row
 * for every `apply` would pass every assertion above. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";

/** Lower `source` as PLAIN JS and return the instrument's rows. `on` selects
 * whether the env dial is set, because "off by default" is half the
 * contract. The dial writes to stderr, not console.error, so the capture is
 * a process.stderr.write patch rather than unionslot-why's console patch. */
function applypackRows(source: string, on: boolean): string[] {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-applypack-"));
  const entry = join(dir, "main.js");
  writeFileSync(entry, source);
  const captured: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  const previous = process.env["SCRIPTC_APPLYPACK_WHY"];
  if (on) process.env["SCRIPTC_APPLYPACK_WHY"] = "1";
  else delete process.env["SCRIPTC_APPLYPACK_WHY"];
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string): boolean => {
    captured.push(String(s));
    return true;
  };
  try {
    const load = loadProgram(entry);
    // Some of these literals are EXPECTED to be refused; lowerToIr returns
    // its diagnostics rather than throwing, so nothing here inspects them.
    lowerToIr(load.program, load.entry, load.moduleOrder);
  } finally {
    (process.stderr as unknown as { write: typeof realWrite }).write = realWrite;
    if (previous === undefined) delete process.env["SCRIPTC_APPLYPACK_WHY"];
    else process.env["SCRIPTC_APPLYPACK_WHY"] = previous;
  }
  return captured
    .join("")
    .split("\n")
    .filter((l) => l.startsWith("APPLYPACK "));
}

/* Five call sites, one per outcome, and every expected value below is
 * readable off these twenty lines rather than off the implementation.
 *
 *   packOpen    an untyped parameter — the func type is all-dyn, so the box
 *               and the dyn dispatch are the answer. CLOSED.
 *   packTyped   the SAME call with a JSDoc `number` parameter. Node passes
 *               `undefined` for a short pack and the body makes NaN; the
 *               boxed thunk dynCHECKS and throws. Kept out, by name.
 *   packStdlib  a STDLIB member (`Object.prototype.toString`), which has no
 *               compiled function value: the speculative lowering leaves a
 *               diagnostic behind, so the arm declines and the fence below
 *               keeps its own message.
 *   litApply    the ARRAY-LITERAL spelling — a static list, so the direct
 *               call above the arm claims it and NO row is produced.
 *   plainCall   `.call(...)` — always a static list, same silence. */
const SOURCE = `
function pack(n) { var t = new Array(n); for (var i = 0; i < n; i++) t[i] = i; return t; }
function open(a) { return a }
/** @param {number} a */
function typed(a) { return a * 1 }
open.apply(null, pack(1));
typed.apply(null, pack(1));
Object.prototype.toString.apply(null, pack(1));
open.apply(null, [7]);
open.call(null, 7);
console.log(typeof open, typeof typed);
`;

test("the instrument names the VERDICT at every runtime-length apply, and nothing at the static ones", () => {
  const rows = applypackRows(SOURCE, true);
  // Lowering runs collection more than once, so a site can be reported
  // repeatedly; the CLAIM is about the distinct rows.
  const distinct = [...new Set(rows)].sort();
  const why = `rows:\n${distinct.join("\n")}`;

  // THREE sites reach the arm — the two static spellings do not.
  expect(distinct.length, why).toBe(3);

  const closed = distinct.filter((l) => l.includes(" CLOSED-BY=dyn-apply-pack"));
  expect(closed.length, why).toBe(1);
  expect(closed[0], why).toContain("open.apply(null, pack(1))");

  /* THE ARMED HALF. The typed receiver must be refused, and the reason must
   * NAME the parameter kinds — `f64` here — rather than any of the other
   * four declines. This is the assertion that would fail if the all-dyn gate
   * were ever relaxed, which is the one change that would import a measured
   * Node divergence into a path that refuses today. */
  const typed = distinct.filter((l) => l.includes("NOT-CLOSED=receiver-parameter-not-dyn"));
  expect(typed.length, why).toBe(1);
  expect(typed[0], why).toContain("typed.apply(null, pack(1))");
  expect(typed[0], why).toMatch(/receiver-parameter-not-dyn:\[[a-z0-9,]+\]/);
  expect(typed[0], why).not.toContain("[dyn]");

  /* A STDLIB member has no compiled function value, and the speculative
   * lowering leaves a diagnostic behind rather than a `func`. The arm must
   * decline there and DISCARD what it captured — the fence below is still
   * the answer and it names the working spelling. */
  const stdlib = distinct.filter((l) => l.includes("NOT-CLOSED=receiver-did-not-lower"));
  expect(stdlib.length, why).toBe(1);
  expect(stdlib[0], why).toContain("Object.prototype.toString.apply(null, pack(1))");

  // NOTHING from the two static spellings, and that is the instrument's own
  // armed half: a dial that printed a row for every `apply` would satisfy
  // every assertion above.
  for (const l of distinct) {
    expect(l, why).not.toContain("[7]");
    expect(l, why).not.toContain(".call(");
  }

  // Every row is keyed file:line:col — the same spelling the other dials use.
  for (const l of distinct) expect(l).toMatch(/^APPLYPACK \S+main\.js:\d+:\d+ (CLOSED-BY|NOT-CLOSED)=/);
});

test("the instrument is silent with the dial unset", () => {
  expect(applypackRows(SOURCE, false)).toEqual([]);
});
