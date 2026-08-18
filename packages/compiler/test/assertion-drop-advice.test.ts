/* SC6001 — `x as unknown as T` and the members `T` does not name.
 *
 * WHAT THIS FILE USED TO PROVE, AND WHAT CHANGED. TypeScript's double
 * assertion is a RELABEL: the object keeps every member and only the
 * static type moves. scriptc's records are closed — a monomorphic struct
 * with exactly the members its shape declares — so the same spelling is a
 * RESHAPE, and the members `T` does not name used to have nowhere to live:
 *
 *     const big: Big = { a: "x", b: "y" };
 *     const small = big as unknown as Small;
 *     JSON.stringify(small)     node {"a":"x","b":"y"}   scriptc {"a":"x"}
 *     Object.keys(small)        node a,b                 scriptc a
 *
 * The OVERFLOW GRANT (frontend/types.ts, overflowShapeKeys) closes that: a
 * shape a double assertion reshapes INTO is interned with a `dyn` overflow
 * portion, the reshape captures the unnamed members into it, and both
 * lines above now print Node's answer byte for byte. zapo's driver was the
 * shape this cost — the cast at `:199`, the trap four hundred lines later
 * at `:324` — and it is the program that proved the close.
 *
 * So the DIVERGENCE half of this file is now a CONVERGENCE assertion, and
 * SC6001 says what is still true: the members left the STRUCT for a
 * runtime overflow store, a widening back to a type that names one reads
 * it through a CHECKED extraction, and every value of the destination
 * shape carries the overflow pointer.
 *
 * WHY ADVICE AND NOT A REFUSAL, which is the half worth pinning. A refusal
 * costs more than anything it reports: every diagnostic in this compiler
 * is fatal, and under `--best-effort` a fatal one becomes a runtime throw
 * AT THE STATEMENT — so `messages.push(e as unknown as T)` inside a message
 * handler would stop pushing anything at all, and a driver that lost one
 * stanza would lose all of them. So SC6001 rides its own list
 * (`LowerResult.advisories`), never enters `diagnostics`, and cannot make
 * `module` null or be spliced into a fence.
 *
 * Both halves are asserted here, and so is the armed half: the three
 * shapes that must produce NO row. An advisory that fired for every cast
 * would pass a one-directional test and be noise. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import type { ScrDiagnostic } from "../src/diagnostics/diagnostic.js";

interface Lowered {
  readonly advisories: readonly ScrDiagnostic[];
  readonly diags: readonly ScrDiagnostic[];
  readonly compiled: boolean;
}

function lower(source: string): Lowered {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-dropadvice-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    return { advisories: r.advisories, diags: r.diagnostics, compiled: r.module !== null };
  } finally {
    load.dispose();
  }
}

const PRELUDE = `
interface Small { a: string }
interface Big { a: string; b: string }
interface Wide { a: string; b: string; c: string }
const big: Big = { a: "x", b: "y" };
`;

test("the double assertion that moves a member out of the struct is named, at the cast, by member", () => {
  const r = lower(`${PRELUDE}
const small = big as unknown as Small;
console.log(JSON.stringify(small));
`);
  expect(r.diags).toEqual([]);
  expect(r.compiled, "the advice must not stop the build").toBe(true);
  expect(r.advisories.length).toBe(1);
  const a = r.advisories[0]!;
  expect(a.code).toBe("SC6001");
  expect(a.severity).toBe("advice");
  expect(a.message).toContain("'b'");
  expect(a.message).toContain("OVERFLOW STORE");
  // The span is the CAST, not the statement and not the declaration: the
  // whole point is that the loss becomes findable where it happens.
  const text = `${PRELUDE}\nconst small = big as unknown as Small;\nconsole.log(JSON.stringify(small));\n`;
  expect(text.slice(a.loc.start, a.loc.end)).toBe("big as unknown as Small");
});

test("every moved member is named, not just the first", () => {
  const r = lower(`${PRELUDE}
const wide: Wide = { a: "x", b: "y", c: "z" };
const small = wide as unknown as Small;
console.log(JSON.stringify(small));
`);
  expect(r.advisories.length).toBe(1);
  expect(r.advisories[0]!.message).toContain("'b'");
  expect(r.advisories[0]!.message).toContain("'c'");
});

/* ── the armed half: three shapes that must produce NO row ─────────────── */

test("a double assertion that moves NOTHING is silent", () => {
  // Small → Big names every member the source carries (it names more).
  // Nothing is lost, so there is nothing to say.
  const r = lower(`${PRELUDE}
const small: Small = { a: "x" };
const wider = small as unknown as Big;
console.log(JSON.stringify(wider));
`);
  expect(r.advisories).toEqual([]);
});

test("a SINGLE assertion is not this rule", () => {
  // `big as Small` is a checker-legal width narrowing the checker still
  // reasons about, and it has its own rules (SC2002 names the missing
  // members for the widening direction). Only the `unknown` waypoint —
  // the point where the checker stopped reasoning — is this one.
  const r = lower(`${PRELUDE}
const small = big as Small;
console.log(JSON.stringify(small));
`);
  expect(r.advisories).toEqual([]);
});

test("a program with no assertion at all is silent", () => {
  const r = lower(`${PRELUDE}
console.log(JSON.stringify(big));
`);
  expect(r.advisories).toEqual([]);
});
