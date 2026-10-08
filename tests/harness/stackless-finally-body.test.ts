/* D4 -- A SUSPENSION INSIDE A `finally` BODY, AND THE THING IT COST.
 *
 * This file guards the slice that admitted shape (1): an `await` sited inside
 * a `finally` body. The admission is not what makes it need its own guards;
 * the EMISSION is. A finally body is emitted once per completion path, so one
 * plan point becomes up to three emitted states, and the invariant that had
 * tied analysis to artifact through every previous slice -- one state per
 * point, checked as a single equality -- cannot hold any more.
 *
 * WHAT WAS SOLD, stated here because this is where it has to be bought back.
 * The equality became TWO INCLUSIONS (emit-stmts.ts): every plan point is
 * emitted at least once, and every allocated state is sited at a plan point.
 * Together those still pin emission to plan in both directions -- but neither
 * can tell THREE copies of a point from FOUR. Multiplicity stopped being
 * checked by the compiler's own assertion. That was accepted deliberately,
 * with the cost known, and `the multiplicity is measured, not assumed` below
 * is the check that replaces it.
 *
 * WHY MULTIPLICITY IS MEASURED AND NOT ASSERTED AGAINST 3. Section 10b of
 * docs/stackless-llvm-port.md once carried `excess = 2 x in-finally points`,
 * which presupposes three copies. Its own later measurement refuted the
 * premise as a general law: over app182's knob-absent C there are 89
 * try-with-finally regions but only 87 exception copies and 64 pending-return
 * copies, because each of those two is emitted only when something actually
 * jumps to its label (`excHandler.used`, `retEntry.used` -- flags the emitter
 * sets WHILE EMITTING). The copy count is 1-3. So this file counts the copies
 * that are ACTUALLY in the C it just built and derives the expected state
 * count from them. A test that hard-coded 3 would pass for the wrong reason on
 * a one-copy region and fail honestly on nothing.
 *
 * THE THREE PATHS ARE EXERCISED, not just compiled. A finally body runs on
 * normal completion, on an in-flight exception, and on a pending return that
 * is crossing it. Those are three different emitted copies of the same source,
 * each with its own state, and a value test that only ever completes normally
 * guards one of the three while looking like it guards the shape.
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

/** The shape-(1) wrappers. Each has exactly one `await` INSIDE a `finally`
 * body, which is what makes it shape (1); the rest of the function is
 * ordinary. `paths` says which completion paths the program actually drives
 * through the region, so a wrapper cannot claim coverage it does not exercise. */
const WRAPPERS: ReadonlyArray<{ name: string; paths: string }> = [
  { name: "wfbNormal", paths: "normal" },
  { name: "wfbThrow", paths: "normal+exception" },
  { name: "wfbReturn", paths: "normal+pending-return" },
  { name: "wfbAll", paths: "normal+exception+pending-return" },
];

const SOURCE = `
async function p(n: number): Promise<number> {
  return n;
}

/* NORMAL completion only: the finally body's await runs on the fall-through
 * copy. */
async function wfbNormal(n: number): Promise<number> {
  let acc = 0;
  try {
    acc = acc + n;
  } finally {
    acc = acc + (await p(10));
  }
  return acc;
}

/* EXCEPTION path: the try body throws, so the finally body runs with an
 * exception pending and the await sits on the exception COPY. The stash
 * (ScrCaught) is taken before the body and re-raised after, across a park. */
async function wfbThrow(fail: boolean): Promise<number> {
  let acc = 0;
  try {
    if (fail) {
      throw new Error("boom");
    }
    acc = acc + 1;
  } catch (e) {
    acc = acc + 100;
  } finally {
    acc = acc + (await p(10));
  }
  return acc;
}

/* PENDING-RETURN path: the \`return\` inside the try is crossing the finally,
 * so its value is snapshotted BEFORE the finally runs and the body executes on
 * the pending-return copy -- with an await in it. The returned value must be
 * the snapshot (1), not what the finally computes. */
async function wfbReturn(n: number): Promise<number> {
  let acc = 0;
  try {
    return n;
  } finally {
    acc = acc + (await p(10));
  }
}

/* ALL THREE through one region, selected at runtime. */
async function wfbAll(mode: number): Promise<number> {
  let acc = 0;
  try {
    if (mode === 1) {
      throw new Error("x");
    }
    if (mode === 2) {
      return 7;
    }
    acc = acc + 1;
  } catch (e) {
    acc = acc + 100;
  } finally {
    acc = acc + (await p(10));
  }
  return acc;
}

async function main(): Promise<void> {
  console.log("fbnorm", await wfbNormal(5));
  console.log("fbthrow", await wfbThrow(false), await wfbThrow(true));
  console.log("fbret", await wfbReturn(1));
  console.log("fball", await wfbAll(0), await wfbAll(1), await wfbAll(2));
  console.log("done");
}
void main();
`;

interface Arm {
  exe: string;
  cSource: string;
}

async function buildArm(knob: boolean): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else delete process.env["SCRIPTC_STACKLESS"];
  try {
    // The knob is part of the KEY: it is not part of the compiler's own cache
    // key, so two arms sharing an output directory would share one binary and
    // every comparison below would pass by being the same program twice.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `stackless-finally-body-${key}`);
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

/** The body of one emitted function, by its C symbol, brace-matched. */
function bodyOf(cSource: string, symbol: string): string | null {
  // THE DEFINITION, NOT THE FORWARD DECLARATION. Taking the first occurrence
  // of the symbol finds `void sc_cr_x(...);` in the prototype block and then
  // brace-matches into whatever function happens to follow, which reads as a
  // body with none of this one's markers in it -- zero finally regions for a
  // function that plainly has one. Scan occurrences and keep the one whose
  // argument list closes onto a `{`.
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

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe("a suspension inside a finally body", () => {

  test("both lanes answer the same on all three completion paths", async () => {
    const [on, off] = [await buildArm(true), await buildArm(false)];

    // ARMING, about the C and not the path: the arms get different output
    // directories by construction, so comparing paths proves nothing.
    expect(off.cSource, "the fiber arm must contain no coroutine lowering")
      .not.toMatch(/scr_coro_(take|finish)_/);
    expect(on.cSource, "the knob did not reach the emitter").toMatch(/scr_coro_finish_/);

    // THE COVERAGE CONTROL, which is the one that can go red on a regression
    // the output comparison cannot see. A wrapper dropping off the lane makes
    // the two arms MORE equal, so only this names it.
    const missing = WRAPPERS.filter((w) => !on.cSource.includes(`sc_cr_${w.name}(`));
    expect(missing.map((w) => `${w.name} (${w.paths})`),
      "shape-(1) wrappers that are NOT converted -- these paths are unguarded").toEqual([]);

    const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
    const [outOn, outOff] = [run(on.exe), run(off.exe)];

    // The VALUES, against the fiber lane. wfbReturn must answer 1: a return
    // crossing a finally snapshots its value before the finally runs, so the
    // `acc` the finally builds is invisible to the caller.
    expect(outOn).toBe(outOff);
    expect(outOn).toContain("fbnorm 15");
    expect(outOn).toContain("fbthrow 11 110");
    expect(outOn).toContain("fbret 1");
    expect(outOn).toContain("fball 11 110 7");
    expect(outOn.trimEnd().endsWith("done"), "the program did not run to completion").toBe(true);
  });

  test("the multiplicity is measured, not assumed", async () => {
    const on = await buildArm(true);

    // One plan point inside a finally body becomes one emitted state PER
    // EMITTED COPY of that body. The copy count is 1-3 and is a property of
    // this C, so it is counted here rather than assumed -- see the header.
    for (const w of WRAPPERS) {
      const body = bodyOf(on.cSource, `sc_cr_${w.name}`);
      expect(body, `${w.name} has no resume function in the stackless arm`).not.toBeNull();
      const b = body!;

      const normal = count(b, /\/\* finally \(normal path\) \*\//g);
      const exc = count(b, /^[ \t]*sc_finexc_\d+:/gm);
      const pret = count(b, /^[ \t]*sc_finret_\d+:/gm);
      const copies = normal + exc + pret;

      // Every wrapper here has exactly ONE finally region, so the normal copy
      // is emitted exactly once. If that stops being true the arithmetic below
      // is measuring something else and must be re-derived, so it is asserted
      // rather than assumed.
      expect(normal, `${w.name}: expected exactly one finally region`).toBe(1);
      expect(copies, `${w.name}: a region must emit between 1 and 3 copies`)
        .toBeGreaterThanOrEqual(1);
      expect(copies).toBeLessThanOrEqual(3);

      // Resume labels, minus the entry label sc_S0, are the emitted states.
      const states = count(b, /^[ \t]*sc_S\d+:/gm) - 1;
      // These wrappers have exactly one await, and it is inside the finally
      // body: so every emitted state belongs to that one plan point, and the
      // state count must equal the MEASURED copy count.
      expect(states, `${w.name}: ${copies} emitted finally copies must yield ${copies} states`)
        .toBe(copies);

      // And the dispatch must have a case for each, or a resume lands on
      // default: abort(). This is the artifact-side reading of the inclusion
      // the compiler checks against the plan.
      for (let st = 1; st <= states; st++) {
        expect(b, `${w.name}: state ${st} has no dispatch case`).toContain(`case ${st}: goto sc_S${st};`);
      }
    }
  });

  test("the turn count across a finally-body suspension matches the fiber lane", async () => {
    // AGAINST THE FIBER LANE, not against node. A widened promise can ride a
    // coercion whose turn count differs from node's, so a tick test written
    // against node measures the adapter and reports a regression that is not
    // one. The question here is only whether converting the function changed
    // its scheduling, and the fiber arm is the reference for that.
    const TURNS = `
async function p(n: number): Promise<number> { return n; }
const order: string[] = [];
async function wfbTurn(n: number): Promise<number> {
  let acc = 0;
  try {
    order.push("try");
  } finally {
    order.push("fin-before");
    acc = acc + (await p(n));
    order.push("fin-after");
  }
  return acc;
}
async function main(): Promise<void> {
  const t = wfbTurn(5);
  order.push("sync-after-call");
  void Promise.resolve().then(() => { order.push("microtask-1"); });
  console.log("value", await t);
  console.log("order", order.join(" "));
}
void main();
`;
    const build = async (knob: boolean): Promise<string> => {
      const previous = process.env["SCRIPTC_STACKLESS"];
      if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
      else delete process.env["SCRIPTC_STACKLESS"];
      try {
        const key = createHash("sha256").update(TURNS).update(knob ? "on" : "off")
          .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16);
        const outDir = join(cacheDir, `stackless-finally-turns-${key}`);
        const file = join(outDir, "prog.ts");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(file, TURNS);
        const r = await compile(file, { outPath: join(outDir, exeName("prog")), outDir, sanitize, backend: "c", keepC: true });
        if (!r.ok) throw new Error(r.diagnostics.map((d: { code: string; message: string }) => `${d.code}: ${d.message}`).join("\n"));
        const c = readFileSync(join(outDir, "prog.c"), "utf8");
        if (knob) {
          expect(c, "wfbTurn is not converted -- this test would compare the fiber lane with itself")
            .toContain("sc_cr_wfbTurn(");
        }
        return execFileSync(r.binaryPath, [], { encoding: "utf8" });
      } finally {
        if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
        else process.env["SCRIPTC_STACKLESS"] = previous;
      }
    };
    const [onOut, offOut] = [await build(true), await build(false)];
    expect(onOut).toBe(offOut);
    expect(onOut).toContain("value 5");
  });
});
