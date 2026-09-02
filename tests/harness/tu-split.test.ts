/* The MULTI-TU emission: what a program looks like when it is too big for
 * one translation unit, and what has to stay true when it is not.
 *
 * WHY THIS FILE EXISTS. A `zig cc` invocation compiles its C inputs across
 * its own thread pool — measured, six 2.7 MB TUs at -O2 cost 1.42x the wall
 * of one on six cores — and the emitter used to hand it exactly one input.
 * On the zapobench app that input is 129,831,315 bytes and the cc1 child
 * that eats it runs at a mean of 0.982 cores for 499 s while five cores sit
 * idle: 53% of a 999 s build, single-threaded by construction.
 *
 * So above a size threshold the emitter answers several units plus a shared
 * header. The threshold is a CONTRACT and not a tuning knob: under it the
 * emitted bytes and the cc command line are the historical ones, which is
 * what keeps every corpus program and both binary size classes where they
 * are. The consequence is that NOTHING in the gate would exercise the split
 * — every program here is three orders of magnitude under the threshold —
 * so SCRIPTC_SPLIT_PARTS forces it, and this file is the coverage.
 *
 * The failure the split can produce is not subtle and not silent: a symbol
 * whose declaration the shared header misses is a compile error naming it,
 * and one whose linkage was not promoted is `undefined symbol: <name>` from
 * the linker. Both happened while this was built — 34 corpus programs at
 * once for the lazily interned thunk families — which is exactly why the
 * declarations are emitted at the emission sites rather than recovered from
 * the assembled text. What this file adds on top is the thing a build
 * failure cannot tell you: that the program still ANSWERS the same.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/* Programs picked for what they drag into the emission, not for size: a
 * class hierarchy with vtables, an async family with spawn wrappers and
 * trampolines, generators, and the dyn walkers/thunks that are interned
 * LAZILY from a body — the family that broke first, because it is written
 * before the split is decided. */
const PROGRAMS = [
  "tests/corpus/1020-async-basics.ts",
  "tests/corpus/1301-errors-subclass.ts",
  "tests/corpus/2252-class-iterators.ts",
];

interface Built {
  binary: string;
  cPath: string;
  parts: string[];
  header: string | undefined;
}

async function build(src: string, tag: string, parts: number | null): Promise<Built> {
  const outDir = join(cacheDir, `tu-split-${tag}${sanitize ? "-san" : ""}`);
  await rm(outDir, { recursive: true, force: true });
  const previous = process.env["SCRIPTC_SPLIT_PARTS"];
  if (parts === null) delete process.env["SCRIPTC_SPLIT_PARTS"];
  else process.env["SCRIPTC_SPLIT_PARTS"] = String(parts);
  try {
    const result = await compile(join(repoRoot, src), {
      outPath: join(outDir, exeName("program")),
      outDir,
      sanitize,
      // Pinned to C: the split is the C backend's emission. The LLVM
      // backend emits one .ll and is not touched by any of this.
      backend: "c",
    });
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    return {
      binary: result.binaryPath,
      cPath: result.cPath,
      parts: result.cPathParts ?? [],
      header: result.cPathHeader,
    };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_SPLIT_PARTS"];
    else process.env["SCRIPTC_SPLIT_PARTS"] = previous;
  }
}

function run(binary: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(binary, [], { encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("a program emitted as several translation units", () => {
  for (const src of PROGRAMS) {
    test(`${src} answers the same split four ways as it does whole`, async () => {
      const whole = await build(src, "whole", null);
      // The size gate: nothing this small splits, so the emission is the
      // single file it has always been.
      expect(whole.parts, "a corpus program must never split on its own size").toEqual([]);
      expect(whole.header).toBeUndefined();
      expect(existsSync(whole.cPath)).toBe(true);

      const split = await build(src, "split", 4);
      // At MOST three files beside the first, and at least one: cuts land on
      // a top-level `}`, so a program with few functions can run out of
      // boundaries before it runs out of requested parts. Fewer parts is a
      // correct answer; zero would mean the split never happened.
      expect(split.parts.length).toBeGreaterThanOrEqual(1);
      expect(split.parts.length).toBeLessThanOrEqual(3);
      expect(split.header).toBeDefined();
      for (const p of [split.cPath, ...split.parts, split.header!]) {
        expect(existsSync(p), `${p} must exist`).toBe(true);
      }

      // Unit 0 defines the program's objects and must therefore SKIP the
      // header's declarations of them: SCR_STR_LIT is an anonymous struct,
      // and two anonymous structs are distinct types inside one unit.
      expect(readFileSync(split.cPath, "utf8")).toContain("#define SCR_PROGRAM_UNIT0");
      expect(readFileSync(split.header!, "utf8")).toContain("#ifndef SCR_PROGRAM_UNIT0");
      // The parts carry bodies and the include, nothing else.
      for (const p of split.parts) {
        const text = readFileSync(p, "utf8");
        expect(text).toContain("#include");
        expect(text, "a part must not define the object tables").not.toContain("SCR_STR_IMMORTAL");
      }

      const a = run(whole.binary);
      const b = run(split.binary);
      expect(b.stdout, "the split program must print exactly what the whole one prints").toBe(a.stdout);
      expect(b.status).toBe(a.status);
      expect(a.stdout.length, "the fixture must actually print something").toBeGreaterThan(0);
    }, 240_000);
  }
});
