/* An ERASED ambient declaration is `undefined` to `typeof` and a
 * ReferenceError to everything else — the whole rule, on all three
 * spellings, on both lanes.
 *
 * Node strips `declare const x: T`, `declare function f(): T` and
 * `declare class C {}` out of a program file entirely. Nothing binds the
 * name at run time, so:
 *
 *   - `typeof x` is the STRING "undefined" (the one read of an unbound
 *     name JavaScript does not throw on), and
 *   - every OTHER read of the same name throws
 *     `ReferenceError: x is not defined`.
 *
 * WHAT THE COMPILER DID INSTEAD, measured on both backends:
 *
 *   - `typeof x` lowered the operand like any other read, so the
 *     undefRead threw AT the typeof — one line before Node throws, and in
 *     a program that only sniffs, where Node does not throw at all. This
 *     was true for the SHIPPED `declare const` and `declare function`
 *     arms, not only for classes.
 *   - a `declare class` NAME in value position was claimed by the
 *     program-class arm: `Amb.name` folded to the string `"Amb"`,
 *     `const B = Amb` bound a class value, `[Amb]` built an array of one.
 *     Exit 0, no diagnostic, where Node exits 1. `new Amb()` alone had an
 *     arm (07187b62); every other position did not.
 *
 * Three-sided, for the reason a one-sided version fails: a compiler that
 * answered "undefined" to every `typeof`, or threw at every name, would
 * pass half of this file. So it pins (1) the correct answers, RUN; (2)
 * the shapes that must still refuse; (3) the neighbours that must be
 * untouched — a real class's `.name`, `typeof` over real bindings and
 * stdlib globals, and an ambient name inside `declare module`, which is
 * deliberately outside the rule.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const LANES = ["c", "llvm"] as const;
type Lane = (typeof LANES)[number];

const DECLS =
  "declare const ec: { readonly n: number }\n" +
  "declare function ef(x: number): string\n" +
  "declare class EC { static make(): EC; readonly y: number }\n";

/** Programs that must COMPILE and RUN, with Node v25.9.0's exact stdout
 * and exit code. `stdout`/`exit` are Node's, recorded from
 * v25.9.0 and re-derivable by running the source under it. */
const RUNS: readonly { name: string; src: string; stdout: string; exit: number }[] = [
  {
    name: "typeof over all three erased spellings",
    src: DECLS + "console.log(typeof ec, typeof ef, typeof EC)\nconsole.log('done')\n",
    stdout: "undefined undefined undefined\ndone\n",
    exit: 0,
  },
  {
    name: "typeof does not throw, the read after it does",
    src: DECLS + "console.log('t', typeof ef)\nconst b = ef\nconsole.log('never', typeof b)\n",
    stdout: "t undefined\n",
    exit: 1,
  },
  {
    name: "an ambient class name read as a value throws",
    src: DECLS + "console.log('before')\nconsole.log('never', EC.name)\n",
    stdout: "before\n",
    exit: 1,
  },
  {
    name: "binding an ambient class to a const throws at the binding",
    src: DECLS + "console.log('before')\nconst B = EC\nconsole.log('never', typeof B)\n",
    stdout: "before\n",
    exit: 1,
  },
  {
    name: "an ambient class in an array literal throws",
    src: DECLS + "console.log('before')\nconst a = [EC]\nconsole.log('never', a.length)\n",
    stdout: "before\n",
    exit: 1,
  },
  {
    name: "a static call on an ambient class throws at the callee",
    src: DECLS + "console.log('before')\nconsole.log('never', EC.make().y)\n",
    stdout: "before\n",
    exit: 1,
  },
  {
    // The neighbours. A real class's `.name` is a compile-time constant
    // and must stay one; `typeof` over real bindings must stay exact.
    name: "the neighbours are untouched",
    src:
      "class Real { v = 1 }\nfunction f(): number { return 1 }\nconst n = 1\n" +
      "console.log(Real.name, typeof Real, typeof f, typeof n, typeof new Real())\n" +
      "console.log(typeof JSON, typeof Math, typeof parseInt, typeof undefined)\n",
    stdout: "Real function function number object\nobject object function undefined\n",
    exit: 0,
  },
];

/** Shapes that must still REFUSE. Their presence is what keeps the rule
 * from being satisfied by "answer something for everything". */
const REFUSALS: readonly { name: string; code: string; fragment: string; src: string }[] = [
  {
    // `unknown` conversion is a pre-existing wall unrelated to this rule;
    // it is pinned so a future change to it is noticed here rather than
    // read as this rule regressing.
    name: "an ambient class passed where unknown is expected",
    code: "SC1101",
    fragment: "converting typed values to 'unknown'",
    src: DECLS + "function take(c: unknown): string { return typeof c }\nconsole.log(take(EC))\n",
  },
  {
    name: "an ambient class stringified",
    code: "SC2001",
    fragment: "values of type 'typeof EC' cannot be compiled yet",
    src: DECLS + "console.log(String(EC))\n",
  },
];

let lab = "";
interface Built { ok: boolean; diags: { code: string; message: string }[]; binaryPath?: string }
const BUILT = new Map<string, Built>();

async function build(name: string, src: string, backend: Lane): Promise<Built> {
  const dir = join(lab, `${name.replace(/[^a-z0-9]+/gi, "-")}-${backend}`);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "main.ts");
  await writeFile(file, src, "utf8");
  const res = await compile(file, { outPath: join(dir, exeName("program")), outDir: dir, backend });
  return {
    ok: res.ok,
    diags: (res.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message })),
    binaryPath: res.ok ? res.binaryPath : undefined,
  };
}

beforeAll(async () => {
  lab = await mkdtemp(join(tmpdir(), "scriptc-ambient-erased-"));
  for (const backend of LANES) {
    for (const p of RUNS) BUILT.set(`R:${p.name}:${backend}`, await build(p.name, p.src, backend));
    for (const p of REFUSALS) BUILT.set(`X:${p.name}:${backend}`, await build(p.name, p.src, backend));
  }
}, 1_800_000);

describe("an erased ambient name", () => {
  test.for(RUNS.map((p) => [p.name, p] as const))("%s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`R:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) did not compile. Diagnostics: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 140)}`).join(" | "),
      ).toBe(true);
      let stdout = "";
      let status: number | null = null;
      try {
        stdout = execFileSync(b.binaryPath!, [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        status = 0;
      } catch (e) {
        const err = e as { status?: number; stdout?: string };
        stdout = err.stdout ?? "";
        status = err.status ?? null;
      }
      // stdout byte-for-byte; stderr is NOT compared for a nonzero exit
      // (the uncaught-report format is a documented divergence).
      expect(stdout, `${p.name} (${backend}) stdout`).toBe(p.stdout);
      expect(status, `${p.name} (${backend}) exit code`).toBe(p.exit);
    }
  });

  test.for(REFUSALS.map((p) => [p.name, p] as const))("still refuses: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`X:${p.name}:${backend}`)!;
      expect(b.ok, `${p.name} (${backend}) compiled; record the new answer here`).toBe(false);
      const hit = b.diags.filter((d) => d.code === p.code && d.message.includes(p.fragment));
      expect(
        hit.length,
        `${p.name} (${backend}) refuses, but not with ${p.code} / "${p.fragment}". Saw: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 140)}`).join(" | "),
      ).toBeGreaterThan(0);
    }
  });
});
