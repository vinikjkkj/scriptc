/* THE STACKLESS LANE MUST GIVE THE SAME ANSWERS, not just the same turn count.
 *
 * WHY THIS EXISTS. The lane shipped with a wrong-ANSWER bug and every gate was
 * green: an `async` function returning a boolean fulfilled its promise through
 * the f64 field, while every awaiter -- stackless and fiber alike -- reads the
 * separate `b` field. So `await f()` answered false whatever f returned, 62
 * times over in the shipped zapo-rest build, and the Noise handshake rejected
 * every certificate because its verifier is one of them.
 *
 * Nothing caught it, and the reason is worth stating: the turns ruler counts
 * MICROTASK TURNS, run-poison.sh counts turns, the TU-split guard checks
 * STRUCTURE. The corpus runs with the knob absent. Not one check compared a
 * VALUE the lane produced -- a lane with no value coverage can be green and
 * wrong at the same time, which is exactly what happened.
 *
 * This compares the two lanes' OUTPUT on one program built both ways, with the
 * knob as the only difference. It sets the knob itself rather than reading it,
 * so it guards the lane on the ordinary knob-absent gate. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/* Every result kind an await can carry. `bool` is first because it is the one
 * that was broken; the others are here so the next mismatch of this shape is
 * caught by the same test rather than by a user. */
const SOURCE = `
async function pf(v: number): Promise<number> { return v + 1; }
async function pb(v: boolean): Promise<boolean> { return v; }
async function ps(v: string): Promise<string> { return v + "!"; }
async function pr(n: number): Promise<number[]> { return [n, n + 1]; }
async function pu(n: number): Promise<number | null> { return n > 0 ? n : null; }
async function pv(): Promise<void> { }

async function viaLocal(v: boolean): Promise<boolean> { const x = await pb(v); return x; }
async function viaReturn(v: boolean): Promise<boolean> { return await pb(v); }
async function chained(v: boolean): Promise<boolean> { const a = await pb(v); return await pb(a); }

async function main(): Promise<void> {
  console.log("f64   ", await pf(41));
  console.log("bool  ", await pb(true), await pb(false));
  console.log("local ", await viaLocal(true), await viaLocal(false));
  console.log("return", await viaReturn(true), await viaReturn(false));
  console.log("chain ", await chained(true), await chained(false));
  console.log("str   ", await ps("x"));
  console.log("ref   ", (await pr(5)).join(","));
  console.log("union ", await pu(2), await pu(-1));
  await pv();
  console.log("done");
}
void main();
`;

async function buildArm(knob: boolean): Promise<string> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else delete process.env["SCRIPTC_STACKLESS"];
  try {
    // The knob is part of the KEY. It is not part of the compiler's own cache
    // key, so two arms sharing an output directory would share one binary and
    // the comparison would pass by being the same program twice.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `stackless-values-${key}`);
    const file = join(outDir, "prog.ts");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    const r = await compile(file, { outPath: join(outDir, exeName("prog")), outDir, sanitize, backend: "c", keepC: true });
    if (!r.ok) throw new Error(r.diagnostics.map((d: any) => `${d.code}: ${d.message}`).join("\n"));
    return r.binaryPath;
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

describe("the stackless lane answers what the fiber lane answers", () => {
  test("every await result kind survives the state machine", async () => {
    const [onExe, offExe] = [await buildArm(true), await buildArm(false)];
    // The arming check: if the knob stopped reaching the emitter this test
    // would compare a program against itself and pass while blind.
    expect(onExe, "the two arms must be different binaries").not.toEqual(offExe);
    const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
    const off = run(offExe);
    expect(off, "the fiber arm is the reference and must be sane").toContain("bool   true false");
    expect(run(onExe), "the stackless lane disagrees with fibers").toEqual(off);
  });
});
