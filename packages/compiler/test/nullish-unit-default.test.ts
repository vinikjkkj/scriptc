/* `attrs.k ?? null` — the retype and its DESTINATION LICENCE, plus the
 * SCRIPTC_NULLISH_UNIT instrument, tested at IR level.
 *
 * WHAT IT IS FOR. tsc types an index-signature read by the signature's VALUE
 * type, so it types `attrs.ab_key ?? null` as `string` and the `?? null` is dead
 * to it. `lowerNullishCoalesce`'s dyn rung widened the read, correctly took the
 * RIGHT operand for an absent key, and then validated the result back to
 * `string` — refusing the `null` it had just produced and the destination
 * declares. zapo `src/client/events/abprops.ts:52:16`; Node prints `null`.
 *
 * The honest type of `L ?? <unit literal>` is `want | unit`. It is applied only
 * when the destination admits the unit, and THAT is the half most worth pinning:
 * applied unconditionally, `(attrs.k ?? null).length` with the key PRESENT — a
 * program main compiles and gets right — becomes `SC2003 union types must match
 * exactly: expected 'string', got 'null | string'`. So this file asserts BOTH
 * directions, because a fix that only widened would pass a one-directional test
 * and still be a regression.
 *
 * The instrument is tested for the same reason `unionslot-why.test.ts` gives:
 * this project has caught instruments passing without testing anything, and one
 * whose only proof is that somebody read its output once is that artefact. It is
 * armed with a case that must produce NO row at all. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";

interface Lowered {
  readonly rows: string[];
  readonly diags: readonly { readonly code: string }[];
}

/** Lower `source` and return the instrument's rows plus the diagnostics. `on`
 * selects whether the env dial is set, because "off by default" is half the
 * contract. */
function lower(source: string, on: boolean): Lowered {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-nullishunit-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const captured: string[] = [];
  const realError = console.error;
  const previous = process.env["SCRIPTC_NULLISH_UNIT"];
  if (on) process.env["SCRIPTC_NULLISH_UNIT"] = "1";
  else delete process.env["SCRIPTC_NULLISH_UNIT"];
  console.error = (...args: unknown[]): void => {
    captured.push(args.map((a) => String(a)).join(" "));
  };
  let diags: readonly { readonly code: string }[] = [];
  try {
    const load = loadProgram(entry);
    diags = lowerToIr(load.program, load.entry, load.moduleOrder).diagnostics;
  } finally {
    console.error = realError;
    if (previous === undefined) delete process.env["SCRIPTC_NULLISH_UNIT"];
    else process.env["SCRIPTC_NULLISH_UNIT"] = previous;
  }
  return { rows: [...new Set(captured.filter((l) => l.startsWith("NULLISHUNIT ")))].sort(), diags };
}

/* One function per outcome, and the last two are the armed half.
 *
 *   declaresNull  the real site: the destination field declares the null, so
 *                 the retype applies (`widen=1`).
 *   restParam     the case `estado-content3.md` §5.4 called "no destination at
 *                 all". Its contextual type is the rest parameter's element,
 *                 which admits the unit, so it is licensed after all.
 *   plainString   a destination that CANNOT hold the null. At risk, and left
 *                 exactly as main lowers it (`widen=0 admits=0`).
 *   receiver      the only position with NO contextual type. This is the one an
 *                 unlicensed retype breaks, and it must read `ctx=none`.
 *   notLiteral    a unit-TYPED default that is not a unit LITERAL: the
 *                 predicate is syntactic on purpose, so `unit=-` and no retype.
 *   noKeyedRead   the rung never fires — the left is honestly typed. NO ROW AT
 *                 ALL, which is the assertion an instrument that printed for
 *                 everything would fail.
 */
const SOURCE = `
interface BinNode { readonly attrs: Readonly<Record<string, string>> }
interface Snap { readonly abKey: string | null }
interface Strict { readonly k: string }

export function declaresNull(n: BinNode): Snap {
    return { abKey: n.attrs.ab_key ?? null }
}
export function restParam(n: BinNode): void {
    console.log(n.attrs.ab_key ?? null)
}
export function plainString(n: BinNode): Strict {
    return { k: n.attrs.ab_key ?? null }
}
export function receiver(n: BinNode): number {
    return (n.attrs.ab_key ?? null).length
}
function nullMaker(): null { return null }
export function notLiteral(n: BinNode): Snap {
    return { abKey: n.attrs.ab_key ?? nullMaker() }
}
export function noKeyedRead(v: string | null): string | null {
    return v ?? null
}
console.log(typeof declaresNull, typeof restParam, typeof plainString,
    typeof receiver, typeof notLiteral, typeof noKeyedRead)
`;

/** The `file@offset` key resolved to a 1-based line, so a row can be tied to
 * the source line it came from without hard-coding an offset. */
function lineOf(row: string, source: string): number {
  const m = /@(\d+) /.exec(row);
  if (m === null) throw new Error(`row is not keyed file@offset: ${row}`);
  return source.slice(0, Number(m[1])).split("\n").length;
}

test("the instrument names the honest type, the licence and the destination — and prints nothing where the rung does not fire", () => {
  const { rows } = lower(SOURCE, true);
  const shown = `rows:\n${rows.join("\n")}`;

  // Five firings: the four `?? <unit literal>` sites plus `notLiteral`, whose
  // rung DOES fire (its left is a keyed read) and whose default is declined.
  // `noKeyedRead` never reaches the rung, so there is no sixth row.
  expect(rows.length, shown).toBe(5);
  for (const r of rows) expect(r).toMatch(/^NULLISHUNIT \S+main\.ts@\d+ unit=/);

  const at = (needle: string): string => {
    const wanted = SOURCE.split("\n").findIndex((l) => l.includes(needle)) + 1;
    const hit = rows.filter((r) => lineOf(r, SOURCE) === wanted);
    expect(hit.length, `${needle} -> ${shown}`).toBe(1);
    return hit[0] as string;
  };

  // The real site: the destination declares the null, so the retype applies.
  const declares = at("return { abKey: n.attrs.ab_key ?? null }");
  expect(declares).toContain("unit=nullT");
  expect(declares).toContain("want=string");
  expect(declares).toContain("honest=null | string");
  expect(declares).toContain("widen=1");
  expect(declares).toContain("admits=1");
  expect(declares).toContain("ctx=string | null");

  // §5.4's "no destination at all" HAS a contextual type, and it admits the
  // unit. That single measured field is what turns a destination-aware rule
  // from "provably incomplete" into the rule that ships.
  const rest = at("console.log(n.attrs.ab_key ?? null)");
  expect(rest).toContain("widen=1");
  expect(rest).toContain("admits=1");
  expect(rest).not.toContain("ctx=none");

  // At risk, and deliberately untouched: main's lowering, main's behaviour.
  const plain = at("return { k: n.attrs.ab_key ?? null }");
  expect(plain).toContain("widen=0");
  expect(plain).toContain("admits=0");
  expect(plain).toContain("ctx=string");

  // The receiver position is the ONLY one with no contextual type, and it is
  // exactly the position an unlicensed retype turns into a new refusal.
  const recv = at("return (n.attrs.ab_key ?? null).length");
  expect(recv).toContain("ctx=none");
  expect(recv).toContain("widen=0");

  // Syntactic narrowness: a unit-TYPED default that is not a unit LITERAL.
  const notLit = at("return { abKey: n.attrs.ab_key ?? nullMaker() }");
  expect(notLit).toContain("unit=-");
  expect(notLit).toContain("honest=-");
  expect(notLit).toContain("widen=0");

  // THE ARMED HALF: `noKeyedRead`'s `??` never reaches this rung, so an
  // instrument that reported on every `??` would have produced a sixth row.
  expect(rows.filter((r) => lineOf(r, SOURCE) === SOURCE.split("\n").findIndex((l) => l.includes("return v ?? null")) + 1).length, shown).toBe(0);
});

test("the dial is off by default", () => {
  expect(lower(SOURCE, false).rows).toEqual([]);
});

test("the licence keeps the receiver position compiling: no new refusal anywhere in the source", () => {
  /* The regression this guards. Widened without a licence, `receiver` above
   * fences with SC2003 ("union types must match exactly: expected 'string', got
   * 'null | string'") — a program main compiles and gets RIGHT with a present
   * key. Asserting the absence of a diagnostic is only meaningful next to a
   * case that DOES produce one, so the second half of this test plants the
   * fence by hand and requires it. */
  expect(lower(SOURCE, false).diags.map((d) => d.code)).toEqual([]);

  const planted = `
interface Snap { readonly abKey: string | null }
type Media = { readonly url: string } | { readonly url: string; readonly n: number }
export function fence(m: Media): Snap {
    const w = { ...m, abKey: "x" }
    return { abKey: w.abKey }
}
export function widened(v: string | null): string {
    return v as string
}
console.log(typeof fence, typeof widened)
`;
  // The planted program must be refused — otherwise the assertion above is
  // vacuous, because a `diags` that was always empty would satisfy it.
  expect(lower(planted, false).diags.length).toBeGreaterThan(0);
});
