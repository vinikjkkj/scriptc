/* THE `.then` ADAPTER ON THE LLVM LANE -- and the key that could not seat it.
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT A `.then` TEST. `p.then(cb)` has no
 * lowering of its own: lower-calls.ts synthesizes a lifted async adapter
 * `%fnN_then` that awaits the receiver and then calls the handler. When the
 * handler's static return type is a promise, the adapter awaits a SECOND time
 * -- the spec's thenable adoption -- and both awaits are stamped with the
 * `.then` call site's `loc`, because a synthesized node has no position of its
 * own and there is no other to give it.
 *
 * The LLVM emitter seated a state at its plan point by (kind, position). Two
 * `awaitExpr` at one range are one key, and it threw:
 *
 *     llvm emitter bug: %fn97_then plans suspension points 0 and 1, both
 *     awaitExpr at .../resolver.ts:14257-14568.
 *
 * THAT WAS THE WHOLE LANE'S REACH, not one function's. The emitter stops at
 * the first one, so the user's app182 -- the shipping load this lowering was
 * built for -- produced NO `.ll` at all with the knob on, while the 81-of-81
 * value fixture was green. A fixture that contains no synthesized duplicate
 * cannot see a defect about synthesized duplicates.
 *
 * SO THE SUBJECT HERE IS THE KEY, and `.then` is merely the cheapest witness
 * of it. The fix is not a tie-break between two awaits: a position is a
 * property of the SOURCE and the lowering synthesizes nodes the source does
 * not contain, so (kind, position) reads as an identity and is not one. The
 * point is now seated by the IR NODE, which is unique by construction.
 * `pu` -- an `awaitExpr` and a `libCall:async.hop` at one range -- was the
 * same class, patched once by adding the kind to the key; this is what that
 * patch left open.
 *
 * WHY THE ARTIFACT IS READ AND NOT JUST THE EXIT CODE. "It builds" is bought
 * by refusing the adapter back onto the fiber lane, which is exactly the
 * outcome this slice exists to prevent -- green test, zero reach. So the
 * adapter is required to BE a coroutine, and to hold TWO states: one per
 * await. A single-state adapter would mean the two awaits had been collapsed,
 * which is the defect wearing a different face.
 *
 * AND WHY IT IS ALSO RUN. Two states with the wrong values in them is IR the
 * verifier accepts -- an entry alloca dominates everything, so a slot written
 * before a park and read after it is well-formed and wrong. The knob-off arm
 * is the oracle: the same program, same lane, no state machine.
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

/* TWO ADAPTERS, BECAUSE THE SECOND AWAIT IS EMITTED FROM TWO DIFFERENT ARMS
 * of lower-calls.ts and only one of them is the one app182 tripped on:
 *
 *   `dbl` returns Promise<number> into a Promise<number> result -- the
 *   `handlerCall.type.kind === "promise" && R.kind !== "promise"` arm, which
 *   awaits and coerces into R. This is app182's shape.
 *
 *   `say` returns Promise<void> into a Promise<void> result -- the
 *   `R.kind === "void"` arm, which awaits as a statement and returns null.
 *   It reaches the same two-points-one-loc state by a different line.
 *
 * A one-adapter test would guard half of it and read as guarding the shape. */
const SOURCE = `
async function inc(n: number): Promise<number> {
  return n + 1;
}
async function dbl(n: number): Promise<number> {
  return n * 2;
}
async function say(n: number): Promise<void> {
  console.log("say", n);
}

async function main(): Promise<void> {
  console.log("chain", await inc(1).then(dbl));
  await inc(10).then(say);
  console.log("done");
}
void main();
`;

interface Arm {
  exe: string;
  artifact: string;
}

async function buildArm(knob: boolean): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  /* THE FIBER ARM IS SPELLED `0`, NOT ABSENT. The lane ships ON as of
   * 2026-10-09 (ir/coro-plans.ts), so `delete` here would set BOTH arms to
   * stackless and this file would compare a lane with itself and report
   * agreement. Do not "simplify" it back to a delete. */
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else process.env["SCRIPTC_STACKLESS"] = "0";
  try {
    // The knob is part of the KEY: it is not part of the compiler's own cache
    // key, so two arms sharing an output directory would share one binary and
    // the comparison below would pass by being the same program twice.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `stackless-then-adapter-${key}`);
    const file = join(outDir, "prog.ts");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    const r = await compile(file, {
      outPath: join(outDir, exeName("prog")),
      outDir,
      sanitize,
      backend: "llvm",
      keepC: true,
    });
    if (!r.ok) {
      throw new Error(
        r.diagnostics.map((d: { code: string; message: string }) => `${d.code}: ${d.message}`).join("\n"),
      );
    }
    return { exe: r.binaryPath, artifact: readFileSync(join(outDir, "prog.ll"), "utf8") };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

/** One emitted resume function's body, from its `define` to the next one. */
function resumeBody(artifact: string, symbol: string): string | null {
  const head = artifact.match(new RegExp(`^define [^@\\n]*@${symbol}\\(`, "m"));
  if (head === null || head.index === undefined) return null;
  const start = head.index + head[0].length;
  const next = artifact.indexOf("\ndefine ", start);
  return artifact.slice(start, next < 0 ? artifact.length : next);
}

/** Every `sc_cr_*` resume function the emitter produced, by name. */
function resumeNames(artifact: string): string[] {
  return [...artifact.matchAll(/^define [^@\n]*@(sc_cr_[A-Za-z0-9_]+)\(/gm)].map((m) => m[1]!);
}

/** How many suspension states a resume function carries: the non-entry arms of
 * its dispatch switch. Read off the DISPATCH rather than counted from the park
 * calls, because the park is what a two-armed point emits twice for one state
 * -- the dispatch is the table the states are actually numbered by. */
function stateCount(body: string): number {
  const sw = body.match(/switch i32 [^[]*\[([^\]]*)\]/);
  if (sw === null) return 0;
  return [...sw[1]!.matchAll(/i32 (\d+), label/g)].map((m) => Number(m[1])).filter((n) => n > 0).length;
}

describe("the .then adapter on the LLVM lane", () => {
  test(
    "an adapter whose handler returns a promise lowers, with one state per await",
    async () => {
      const on = await buildArm(true);

      // THE ADAPTERS ARE COROUTINES. Before the fix this assertion was
      // unreachable -- the build threw. After it, the live risk is the
      // opposite one: an adapter quietly refused back onto the fiber lane
      // builds fine and buys nothing.
      const names = resumeNames(on.artifact);
      const adapters = names.filter((n) => n.endsWith("_then"));
      expect(adapters.length, `sc_cr_* emitted: ${names.join(", ")}`).toBe(2);

      // TWO AWAITS, TWO STATES. One state would mean the two points had been
      // collapsed onto one -- the defect, surviving as a wrong answer instead
      // of a crash.
      for (const a of adapters) {
        const body = resumeBody(on.artifact, a);
        expect(body, `${a} has a define but no body`).not.toBeNull();
        expect(stateCount(body!), `${a} dispatch arms`).toBe(2);
      }
    },
    600_000,
  );

  test(
    "the stackless adapter answers what the fiber lane answers",
    async () => {
      const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
      const off = await buildArm(false);
      const on = await buildArm(true);

      // The oracle is the same program on the same backend with the state
      // machine off -- not a transcript written here, which could only ever
      // agree with whichever arm was consulted when it was written.
      const expected = run(off.exe);
      expect(expected.trim().split(/\r?\n/)).toEqual(["chain 4", "say 11", "done"]);
      expect(run(on.exe)).toBe(expected);

      // And the off arm must genuinely have no state machine, or the
      // comparison above is one program against itself.
      expect(resumeNames(off.artifact)).toEqual([]);
    },
    600_000,
  );
});
