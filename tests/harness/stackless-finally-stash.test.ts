/* C2 -- THE FINALLY STASH ACROSS A SUSPENSION.
 *
 * `sc_fexc_N` is the in-flight exception a `finally` body runs on top of:
 * taken out of the pending cell at the exception-path label so the body's own
 * may-throw calls answer for themselves, re-raised after the body. It was
 * emitted as a C AUTOMATIC, declared at that label -- and the stackless
 * lowering turns a `yield`/`await` in the finally body into
 * `sc_b->state = N; return;`, with the resume entering through
 * `switch (sc_b->state) { case N: goto sc_SN; }` at the TOP of the function.
 * That goto jumps straight over the initialiser. `scr_rethrow` then read an
 * indeterminate pointer: rc=139, empty stderr, no diagnostic.
 *
 * WHY THIS FILE AND NOT stackless-finally-body.test.ts, which already drives
 * an `await` inside a finally on the exception path and stayed GREEN over the
 * whole life of the defect. An async resume is re-entered from the scheduler
 * along one fixed call path, so the dead stack slot that held the stash tends
 * to still contain the right pointer -- the bug is real there and latent. A
 * GENERATOR is resumed by the CONSUMER calling `.next()` from arbitrary
 * depth, so the slot is reliably clobbered and the fault is deterministic.
 * The DRIVER is the discriminator, not the construct: a test that only awaits
 * cannot guard this.
 *
 * THREE SHAPES, because one would guard less than it looks like it does:
 *   gStash -- one stash, a return completion in flight (`.return()`).
 *   gNest  -- a finally inside a finally, so a park inside the INNER region
 *             must carry the OUTER stash too. Three stash ids in one
 *             function; the slot set GROWS as the body is walked, and this is
 *             what proves a park does not ship a half-filled set.
 *   gThrow -- the stash re-raised as a THROW after the park, so the value
 *             read back across the park is actually CONSUMED rather than
 *             released untouched.
 *
 * THE ORACLE IS THE FIBER LANE AND node, together. The fiber arm answers the
 * same question on a lane that never had the defect; EXPECTED below is node
 * v25.9.0's own stdout for this program, byte for byte.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/** The generators carrying a stash across a park, and what each one is for. */
const WRAPPERS: ReadonlyArray<{ name: string; shape: string }> = [
  { name: "gStash", shape: "one stash, return completion in flight" },
  { name: "gNest", shape: "nested finallys -- a park inside the inner region" },
  { name: "gThrow", shape: "the stash re-raised as a throw after the park" },
];

const SOURCE = `
/* One stash: a yield inside a finally, reached by .return() on a suspended
 * generator -- the finally runs with a return completion in flight. */
function* gStash(): Generator<number, number, unknown> {
  try {
    yield 1;
  } finally {
    console.log("fin-a");
    yield 2;
    console.log("fin-b");
  }
  return 0;
}
const a = gStash();
a.next();
const ar = a.return(9);
console.log("a1", ar.done === true, ar.value as number);
const ar2 = a.next();
console.log("a2", ar2.done === true, ar2.value as number);

/* TWO regions, nested: a park inside the inner region must carry the outer
 * stash too, or the outer re-raise reads a dead slot. */
function* gNest(): Generator<number, number, unknown> {
  try {
    yield 1;
  } finally {
    console.log("outer-in");
    try {
      yield 2;
    } finally {
      console.log("inner-in");
      yield 3;
      console.log("inner-out");
    }
    console.log("outer-out");
  }
  return 0;
}
const b = gNest();
b.next();
const br = b.return(11);
console.log("b1", br.done === true, br.value as number);
const br2 = b.next();
console.log("b2", br2.done === true, br2.value as number);
const br3 = b.next();
console.log("b3", br3.done === true, br3.value as number);

/* The stash re-raised as a THROW after the park, not as a return completion:
 * .throw() at the parked yield unwinds into the finally, which yields again,
 * and the error only surfaces at the next() that drains it. */
function* gThrow(): Generator<number, number, unknown> {
  try {
    yield 1;
  } finally {
    console.log("t-in");
    yield 2;
    console.log("t-out");
  }
  return 0;
}
const c = gThrow();
c.next();
try {
  c.throw(new Error("boom"));
} catch (e) {
  if (e instanceof Error) console.log("c-early", e.message);
}
console.log("c-parked");
try {
  const cr = c.next();
  console.log("c1", cr.done === true, cr.value as number);
} catch (e) {
  if (e instanceof Error) console.log("c-raised", e.message);
}
console.log("done");
`;

/** node v25.9.0's stdout for SOURCE, byte for byte. */
const EXPECTED = `fin-a
a1 false 2
fin-b
a2 true 9
outer-in
b1 false 2
inner-in
b2 false 3
inner-out
outer-out
b3 true 11
t-in
c-parked
t-out
c-raised boom
done
`;

interface Arm {
  exe: string;
  cSource: string;
}

async function buildArm(knob: boolean): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  /* THE FIBER ARM IS SPELLED `0`, NOT ABSENT. The lane ships ON, so `delete`
   * here would set BOTH arms to stackless and this file would compare a lane
   * with itself and report agreement. Do not "simplify" it to a delete. */
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else process.env["SCRIPTC_STACKLESS"] = "0";
  try {
    // The knob is part of the KEY: it is not part of the compiler's own cache
    // key, so two arms sharing an output directory would share one binary and
    // every comparison below would pass by being the same program twice.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `stackless-finally-stash-${key}`);
    const file = join(outDir, "prog.ts");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    const r = await compile(file, { outPath: join(outDir, exeName("prog")), outDir, sanitize, backend: "c", keepC: true });
    if (!r.ok) throw new Error(r.diagnostics.map((d: { code: string; message: string }) => `${d.code}: ${d.message}`).join("\n"));
    return { exe: r.binaryPath, cSource: readFileSync(join(outDir, "prog.c"), "utf8") };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

/** The body of one emitted function, by its C symbol, brace-matched. Scans
 * past the forward declaration: taking the first occurrence finds
 * `static void sc_cr_x(...);` in the prototype block and brace-matches into
 * whatever follows, which reads as a body with none of this one's markers. */
function bodyOf(cSource: string, symbol: string): string | null {
  let from = 0;
  for (;;) {
    const i = cSource.indexOf(`${symbol}(`, from);
    if (i < 0) return null;
    from = i + 1;
    let k = cSource.indexOf("(", i);
    let paren = 0;
    for (; k < cSource.length; k++) {
      if (cSource[k] === "(") paren++;
      else if (cSource[k] === ")") {
        paren--;
        if (paren === 0) break;
      }
    }
    const after = cSource.slice(k + 1).match(/^\s*/)?.[0].length ?? 0;
    if (cSource[k + 1 + after] !== "{") continue; // a prototype; keep looking
    const open = k + 1 + after;
    let depth = 0;
    for (let j = open; j < cSource.length; j++) {
      if (cSource[j] === "{") depth++;
      else if (cSource[j] === "}") {
        depth--;
        if (depth === 0) return cSource.slice(i, j);
      }
    }
    return null;
  }
}

describe("a finally stash crossing a suspension", () => {

  test("the stash survives the park, and both lanes answer node", async () => {
    const [on, off] = [await buildArm(true), await buildArm(false)];

    // ARMING, about the C and not about the output directory: the arms get
    // different directories by construction, so comparing paths proves
    // nothing.
    expect(off.cSource, "the fiber arm must contain no coroutine lowering")
      .not.toMatch(/scr_gen_coro_(yield|finish)_/);
    expect(on.cSource, "the knob did not reach the emitter").toMatch(/scr_gen_coro_yield_/);

    // THE COVERAGE CONTROL, which is the one that can go red on a regression
    // the output comparison cannot see. A generator dropping off the lane
    // makes the two arms MORE equal, so only this names it.
    const missing = WRAPPERS.filter((w) => !on.cSource.includes(`sc_cr_${w.name}(`));
    expect(missing.map((w) => `${w.name} (${w.shape})`),
      "generators that are NOT converted -- these shapes are unguarded").toEqual([]);

    // THE VALUES. execFileSync throws on a non-zero exit, so the segfault the
    // defect produced (rc=139, empty stderr, no diagnostic) fails here as a
    // thrown error rather than as a comparison -- which is the honest shape
    // of it, and is what this test reported on the parent commit.
    const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
    const [outOn, outOff] = [run(on.exe), run(off.exe)];
    expect(outOn).toBe(outOff);
    expect(outOn.replace(/\r\n/g, "\n")).toBe(EXPECTED);
  });

  test("every stash is hoisted above the dispatch and rides the frame", async () => {
    const on = await buildArm(true);

    for (const w of WRAPPERS) {
      const body = bodyOf(on.cSource, `sc_cr_${w.name}`);
      expect(body, `${w.name} has no resume function in the stackless arm`).not.toBeNull();
      const b = body!;

      // Which stashes this function emits, READ OFF THE ARTIFACT rather than
      // assumed: the ids come from a label counter shared with every other
      // label in the function and are not predictable from the source.
      const ids = [...new Set([...b.matchAll(/\bsc_fexc_(\d+)\b/g)].map((m) => m[1]!))];
      expect(ids.length, `${w.name}: expected at least one finally stash`).toBeGreaterThanOrEqual(1);

      const dispatchAt = b.indexOf("switch (sc_b->state) {");
      expect(dispatchAt, `${w.name}: no dispatch switch`).toBeGreaterThan(0);

      for (const id of ids) {
        // 1. THE DECLARATION IS HOISTED. C requires a declaration to dominate
        //    every label the switch can jump to; emitted at the finally label
        //    it did not, and the resume read an indeterminate pointer.
        const decl = b.indexOf(`ScrCaught *sc_fexc_${id} = NULL;`);
        expect(decl, `${w.name}: sc_fexc_${id} is not declared at the top of the resume function`)
          .toBeGreaterThan(0);
        expect(decl, `${w.name}: sc_fexc_${id} is declared BELOW the dispatch -- the goto jumps over it`)
          .toBeLessThan(dispatchAt);

        // 2. AND THE LABEL ONLY TAKES. A declaration still sited there would
        //    shadow the hoisted one and re-open the defect with the hoist
        //    present, so the absence is asserted and not inferred from (1).
        expect(b, `${w.name}: sc_fexc_${id} is still DECLARED at the finally label`)
          .not.toContain(`ScrCaught *sc_fexc_${id} = scr_exc_take();`);
        expect(b, `${w.name}: sc_fexc_${id} is never taken`)
          .toContain(`sc_fexc_${id} = scr_exc_take();`);

        // 3. AND IT RIDES THE FRAME. The hoist alone only MOVES the hole: the
        //    hoisted initialiser is jumped over on every resume too, so
        //    without the spill/reload pair the slot is still indeterminate.
        expect(b, `${w.name}: sc_fexc_${id} is never spilled to the frame`)
          .toContain(`sc_f->sc_fexc_${id} = sc_fexc_${id};`);
        expect(b, `${w.name}: sc_fexc_${id} is never reloaded from the frame`)
          .toContain(`sc_fexc_${id} = sc_f->sc_fexc_${id};`);
      }
    }

    // THE NESTED CASE, named: a park inside the inner region must carry the
    // outer stash as well, so some park in gNest spills MORE than one. The
    // stash set grows as the body is walked, and a park shipping only the
    // stash of its own region would pass every per-id check above.
    const nest = bodyOf(on.cSource, "sc_cr_gNest")!;
    const widths = [...nest.matchAll(/(?:^[ \t]*sc_f->sc_fexc_\d+ = sc_fexc_\d+;\n)+/gm)]
      .map((m) => m[0]!.trimEnd().split("\n").length);
    expect(widths.length, "gNest: no park spills a stash at all").toBeGreaterThanOrEqual(1);
    expect(Math.max(...widths),
      "gNest: no park carries more than one stash -- the nested region is unguarded")
      .toBeGreaterThanOrEqual(2);
  });

  test("the fiber lane keeps the stash as a plain C local", async () => {
    // THE OTHER DIRECTION, and it can come out red. The hoist, the frame
    // field and the spill/reload pair are bought by the stackless lowering
    // and are owed ONLY there: the fiber lane never jumps over the
    // declaration, so paying for it there would be an unasked-for change to
    // bytes that already ship.
    const off = await buildArm(false);
    expect(off.cSource, "the fiber arm lost the declaration-at-the-label form")
      .toMatch(/ScrCaught \*sc_fexc_\d+ = scr_exc_take\(\);/);
    expect(off.cSource, "the fiber arm grew a frame slot for a stash it does not need")
      .not.toMatch(/sc_f->sc_fexc_\d+/);
    expect(off.cSource, "the fiber arm grew a hoisted stash declaration")
      .not.toMatch(/ScrCaught \*sc_fexc_\d+ = NULL;/);
  });
});
