/* WHICH RUNTIME SYMBOLS PARK, DERIVED FROM THE RUNTIME.
 *
 * The type fence in ir/suspends.ts keys on the `scr_await_` SPELLING. That
 * is a naming convention, and it is the honest limit of that fence: a
 * suspending primitive lowered under some other name walks straight past
 * it. This file closes that gap from the other side, by PROPERTY.
 *
 * THE PROPERTY. `scr_switch` is the single context-switch helper in the
 * runtime -- the one place a fiber's execution context is swapped. A
 * function parks iff it reaches `scr_switch`, directly or transitively. That
 * is computed here from the runtime sources on every run, so a new parking
 * function is in the set the moment it exists, with nobody updating a list.
 *
 * THE ASSERTION is the intersection: of the symbols that park, which does
 * the C emitter actually emit? That set is pinned. A new parking symbol
 * reaching the emitter fails this test by name, which is the question
 * "is the registration list still complete today" asked mechanically
 * instead of answered from memory.
 *
 * WHY BOTH THIS AND THE TYPE FENCE. The fence stops an unregistered
 * `scr_await_*` at compile time but cannot see a differently-named
 * primitive; this sees any parking symbol but only at test time. Neither
 * subsumes the other, and the pair is why "exactly one unregistered site"
 * became a claim with a control under it rather than a result someone
 * reported once.
 *
 * ARMED: the test below plants a parking function that the census has never
 * seen and asserts the census finds it. If the plant comes back unseen the
 * census is blind and every clean result above it is worthless -- the same
 * mandatory-failing-row rule the value probes carry. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(import.meta.dirname, "../..");
const runtimeDir = join(repoRoot, "packages/runtime/src");
const emitterDir = join(repoRoot, "packages/compiler/src/backend/emission");

/** Comments out, FIRST. A mention of a symbol inside a comment is not a
 * call, and this census counted one: scr_coro_park documents the fiber path
 * it replaced with `scr_await_yield();` inside a block comment, so the
 * STACKLESS park was itself reported as a parking function. Implausible on
 * its face, which is how it was caught -- the same way the 34-symbol
 * over-approximation was, and the phantom park-vs-case mismatches before
 * that. An instrument that reads source has to read it as source. */
function stripComments(src: string): string {
  const block = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const line = new RegExp("//[^\\n]*", "g");
  return src.replace(block, " ").replace(line, " ");
}

/** Crude but sufficient C function splitter: a definition is a line starting
 * in column 0 that ends in `{`, and the body runs to the matching brace. */
function functionsOf(raw: string): Map<string, string> {
  const src = stripComments(raw);
  const out = new Map<string, string>();
  const def = /^[A-Za-z_][A-Za-z0-9_ *]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*?\)\s*\{/gm;
  for (let m = def.exec(src); m !== null; m = def.exec(src)) {
    const start = src.indexOf("{", m.index);
    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.set(m[1]!, src.slice(start, i));
  }
  return out;
}

/** Every function that reaches a YIELD-OUT switch, to a fixpoint.
 *
 * `scr_switch` runs in BOTH directions and only one of them parks the
 * caller. `scr_switch(&here, &f->st->ctx, f)` is the scheduler entering a
 * fiber -- the caller keeps running. `scr_switch(&self->st->ctx,
 * self->return_to, NULL)` is the current fiber yielding out, and THAT is
 * what a coroutine body must never contain. Seeding on `scr_switch` alone
 * over-approximated badly: it pulled in scr_loop_run and scr_async_spawn,
 * i.e. the scheduler itself, and reported 34 symbols as suspect. The
 * destination argument is what separates them. */
function parkingSymbols(sources: ReadonlyArray<string>): Set<string> {
  const bodies = new Map<string, string>();
  for (const s of sources) for (const [k, v] of functionsOf(s)) bodies.set(k, v);
  const parks = new Set<string>();
  for (const [name, body] of bodies) {
    if (/scr_switch\s*\([^)]*return_to/.test(body)) parks.add(name);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of bodies) {
      if (parks.has(name)) continue;
      for (const p of parks) {
        if (new RegExp(`\\b${p}\\s*\\(`).test(body)) {
          parks.add(name);
          changed = true;
          break;
        }
      }
    }
  }
  return parks;
}

/** The parking symbols the C emitter actually writes into a program. */
function emittedBy(emitterSrc: string, parks: ReadonlySet<string>): string[] {
  const src = stripComments(emitterSrc);
  return [...parks].filter((p) => new RegExp(`\\b${p}\\s*\\(`).test(src)).sort();
}

/* THE PIN. Every entry is a parking symbol the emitter emits, with WHY it is
 * safe. Adding a row is a deliberate act; a symbol arriving here on its own
 * fails the test first. */
const KNOWN: Readonly<Record<string, string>> = {
  scr_await_hop: "fiber-only; registered as async.hop and emitted through fiberOnly()",
  scr_await_dyn_value: "fiber-only; registered as async.awaitDyn and emitted through fiberOnly()",
  scr_await_f64: "awaitExpr lowering, FIBER PATH ONLY -- guarded by E.currentCoro",
  scr_await_bool: "awaitExpr lowering, fiber path only",
  scr_await_str: "awaitExpr lowering, fiber path only",
  scr_await_ref: "awaitExpr lowering, fiber path only",
  scr_await_void: "awaitExpr lowering, fiber path only",
  scr_await_dyn: "awaitExpr lowering, fiber path only",
  scr_await_settled: "reached only through the typed scr_await_* wrappers above",
  scr_await_yield: "reached only through scr_await_hop",
  scr_await_park: "internal plumbing of the wrappers above",
  // Found BY THIS CENSUS, and the type fence could never have seen it: the
  // name has no `scr_await_` in it. A node:test subtest runs inline on the
  // runner fiber, so an AWAITING subtest body parks its caller. Measured: a
  // parent whose subtest awaits exited 0xC0000409 with the knob on and
  // printed nothing, against 12 correct lines with it off. A SYNCHRONOUS
  // subtest does not crash, which is why every existing fixture missed it.
  scr_test_sub: "fiber-only; registered as test.sub / test.subEmpty and emitted through fiberOnly()",
  // The module evaluator's dependency wait, emitted only for the
  // `module.await` intrinsic in module-init code. Module init is not an
  // async function, so it is never a coroutine body and never admitted.
  // That is a reasoned claim about where the emission can appear, not a
  // measurement, and it is the weakest row here.
  scr_module_await: "module evaluator dependency wait; module init is not an async function body",
};

describe("the parking census, derived from the runtime rather than from a name", () => {
  const sources = readdirSync(runtimeDir)
    .filter((f) => f.endsWith(".c"))
    .map((f) => readFileSync(join(runtimeDir, f), "utf8"));
  const emitterSrc = readdirSync(emitterDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(emitterDir, f), "utf8"))
    .join("\n");

  test("the census can see a parking symbol it has never been told about", () => {
    // THE MANDATORY FAILING ROW. A planted function that reaches scr_switch
    // through one hop must land in the set. If it does not, the census is
    // blind and every other assertion in this file is vacuous.
    const planted = `
void scr_planted_inner(void) { scr_switch(&self->st->ctx, self->return_to, NULL); }
void scr_planted_parks_too(void) { scr_planted_inner(); }
`;
    const parks = parkingSymbols([...sources, planted]);
    expect([...parks].filter((p) => p.startsWith("scr_planted")).sort(),
      "the census did not find a planted parking symbol -- it is blind, and every clean result here is worthless")
      .toEqual(["scr_planted_inner", "scr_planted_parks_too"]);
  });

  test("every parking symbol the emitter emits is accounted for", () => {
    const parks = parkingSymbols(sources);
    expect(parks.size, "no parking symbols found at all -- the property is not being computed")
      .toBeGreaterThan(3);

    const emitted = emittedBy(emitterSrc, parks);
    const unexplained = emitted.filter((s) => !(s in KNOWN));
    expect(unexplained,
      "parking symbols the C emitter emits that nothing accounts for. Each is a candidate " +
      "for the async.hop / async.awaitDyn defect: a fiber primitive reaching an admitted " +
      "coroutine body. Register it in ir/suspends.ts and emit it through fiberOnly(), or " +
      "add a row to KNOWN saying why it is safe.")
      .toEqual([]);
  });
});
