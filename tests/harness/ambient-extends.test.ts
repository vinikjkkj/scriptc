/* `class D extends <ambient declare class>` — the SILENT WRONG ANSWER
 * this file exists to keep closed.
 *
 * Node erases a `declare class` entirely, so the `extends` clause reads a
 * name nothing defines. The read happens when the CLASS STATEMENT
 * evaluates — before any member, before any static initializer, before
 * anything below it in the module — and throws
 * `ReferenceError: <name> is not defined`, ending the process with exit 1.
 *
 * WHAT THE COMPILER DID INSTEAD: the ambient class was COLLECTED like a
 * program class, so the heritage resolution FOUND a ClassInfo for it and
 * the derived class inherited a fabricated base. The program compiled,
 * printed every statement after the class, RAN static field initializers
 * whose side effects Node never performs, and constructed instances that
 * read their fields back out of `calloc` — exit 0, no diagnostic, no
 * trap, on BOTH backends. That is the failure mode this project ranks
 * above every other: a wrong answer is silent where a refusal is loud.
 *
 * The contract here is deliberately three-sided, because a one-sided
 * version of it is passed by a compiler that simply refuses everything:
 *
 *   1. CORRECT ANSWER — the shape the throw shell covers (a non-generic
 *      class DECLARATION) compiles and RUNS, printing exactly what Node
 *      prints before the class statement and nothing after it, exit 1.
 *      This test spawns the binary; a compile-only assertion could not
 *      tell a correct throw from a fabricated base.
 *   2. LOUD, NOT SILENT — the shapes the shell does NOT cover (a generic
 *      family, a class expression, a subclass of a throwing class, a
 *      static read through one) refuse with an SCxxxx that names the
 *      ambient base. They are worse than (1) and better than what they
 *      replaced, and each names its own emitter so "still refuses" can
 *      never be satisfied by some unrelated new refusal.
 *   3. DOES NOT OVER-FIRE — every neighbouring `extends` shape that DOES
 *      have a runtime still compiles: a program class, a stdlib error, an
 *      EventEmitter, a generic class over a program base, a class
 *      expression over a program base, and an ambient class used only as
 *      a TYPE. Without this group the whole file is satisfied by refusing
 *      every `extends` in the language.
 *
 * Both lanes are checked throughout. The LLVM lane keeps its own emitter
 * and this project has shipped a fix green on one lane and wrong on the
 * other.
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

/** The declaration under test, shared by every program below. */
const AMBIENT = "declare class AmbientBase { constructor(); readonly y: number }\n";

/** Programs that must REFUSE, with the emitter that must answer. */
const REFUSALS: readonly { name: string; code: string; fragment: string; src: string }[] = [
  {
    name: "constructing the derived class",
    code: "SC1090",
    fragment: "whose extends clause provably throws ('AmbientBase' is an ambient name nothing defines",
    src: AMBIENT + "class Derived extends AmbientBase { constructor() { super() } }\nconsole.log(new Derived().y)\n",
  },
  {
    name: "a subclass of the throwing class",
    code: "SC1090",
    fragment: "whose extends clause provably throws ('AmbientBase' is an ambient name nothing defines",
    src: AMBIENT + "class Mid extends AmbientBase { }\nclass Leaf extends Mid { }\nconsole.log(typeof Leaf)\n",
  },
  {
    name: "a static read through the throwing class",
    code: "SC1090",
    fragment: "whose extends clause provably throws ('AmbientBase' is an ambient name nothing defines",
    src: AMBIENT + "class D extends AmbientBase { static s = 1 }\nconsole.log(D.s)\n",
  },
  {
    // The shell is declarations-only, so the GENERIC family reaches the
    // heritage guard instead. Both are loud; only the message differs,
    // and the message must name the ambient base either way.
    name: "a generic family extending the ambient class",
    code: "SC1090",
    fragment: "extending the ambient class 'AmbientBase' that nothing defines",
    src:
      AMBIENT +
      "class Box<T> extends AmbientBase { v: T\n  constructor(v: T) { super(); this.v = v } }\nconsole.log(new Box<number>(3).v)\n",
  },
  {
    // THE SHAPE THAT MAKES THE CHEAP FIX WRONG, pinned so it is noticed
    // if anyone tries it.
    //
    // The residual this file's stance leaves open is that a VALUE use of
    // the derived class is a build REFUSAL rather than a compiled throw,
    // and the obvious repair is to lower such uses to the same undefRead
    // shape `L.trapBindings` uses -- "it is provably dead code, so any
    // throw will do". It is not: a use ABOVE the class statement is
    // reachable, and Node answers it with the class's own TDZ, not with
    // the ambient name.
    //
    //   function g() { return new D().s }
    //   try { g() } catch (e) { console.log('caught', e.message) }
    //   class D extends AmbientBase { s = 1 }
    //
    //   Node v25.9.0   before
    //                  caught Cannot access 'D' before initialization
    //                  then ReferenceError: AmbientBase is not defined, rc=1
    //
    // An undefRead lowering would print `caught AmbientBase is not
    // defined` -- a refusal traded for a WRONG answer, which is the one
    // trade this project ranks worst. Closing the residual therefore
    // needs the source-order guard (earliestSameFileDeclStart /
    // fenceEarlyAliasUse), not twenty lines.
    //
    // The refusal's own wording is imprecise for THIS program -- nothing
    // below the class statement runs, but this use is above it and does
    // run under Node. It is still loud and still names the real cause,
    // and the fragment asserted here is the part that is true of every
    // shape in the family.
    name: "a use of the derived class ABOVE the throwing class statement (TDZ in Node)",
    code: "SC1090",
    fragment: "whose extends clause provably throws ('AmbientBase' is an ambient name nothing defines",
    src:
      AMBIENT +
      "function g(): number { return new D().s }\n" +
      "console.log('before')\n" +
      "try { console.log('v', g()) } catch (e) { console.log('caught', (e as Error).message) }\n" +
      "class D extends AmbientBase { s = 1 }\nconsole.log('after')\n",
  },
  {
    name: "a class expression extending the ambient class",
    code: "SC1090",
    fragment: "extending the ambient class 'AmbientBase' that nothing defines",
    src: AMBIENT + "const K = class extends AmbientBase { }\nconsole.log(typeof new K())\n",
  },
];

/** Programs that must still COMPILE — the over-fire controls. */
const COMPILES: readonly { name: string; src: string }[] = [
  {
    name: "extends a program class",
    src:
      "class Animal { nm: string\n  constructor(nm: string) { this.nm = nm }\n  speak(): string { return this.nm } }\n" +
      "class Dog extends Animal { }\nconsole.log(new Dog('rex').speak())\n",
  },
  {
    name: "extends a stdlib error",
    src: "class MyErr extends TypeError { }\nconsole.log(new MyErr('t').message)\n",
  },
  {
    name: "extends an EventEmitter",
    src:
      "import { EventEmitter } from 'node:events'\n" +
      "class Bus extends EventEmitter { }\nconst b = new Bus()\nb.on('x', (v: number) => console.log(v))\nb.emit('x', 7)\n",
  },
  {
    name: "a generic class over a program base",
    src:
      "class Animal { nm: string\n  constructor(nm: string) { this.nm = nm } }\n" +
      "class Box<T> extends Animal { v: T\n  constructor(v: T) { super('b'); this.v = v } }\n" +
      "console.log(new Box<number>(3).v)\n",
  },
  {
    name: "a class expression over a program base",
    src:
      "class Animal { nm: string\n  constructor(nm: string) { this.nm = nm } }\n" +
      "const K = class extends Animal { constructor() { super('k') } }\nconsole.log(new K().nm)\n",
  },
  {
    // The ambient class is inert as long as no VALUE touches it: an
    // annotation must never become a refusal.
    name: "an ambient class used only as a TYPE",
    src: AMBIENT + "function takes(a: AmbientBase): number { return a.y }\nconsole.log(typeof takes)\n",
  },
  {
    // The predicate is narrow on purpose: a class inside `declare module`
    // names a real package whose import resolves at run time, and the npm
    // chokepoint above owns that case. It must not be swept in here.
    name: "an ambient class inside a declare module is left alone",
    // Deliberately only ANNOTATES: reading a member off such a value hits
    // an unrelated, pre-existing wall (`SC1090 reading 'n' from a value of
    // type 'Thing'`) that has nothing to do with this rule, and pinning it
    // here would make this control fail for a reason it does not test.
    src:
      "declare module 'somepkg' { export class Thing { readonly n: number } }\n" +
      "function f(t: import('somepkg').Thing): string { return typeof t }\nconsole.log(typeof f)\n",
  },
];

/** The correct answer, run for real: stdout must stop at the class
 * statement and the process must exit 1. */
const THROWS_SRC =
  AMBIENT +
  "console.log('before')\n" +
  "class Derived extends AmbientBase { z: number = 5\n  static s = (console.log('STATIC RAN'), 1) }\n" +
  "console.log('after')\n";

let lab = "";
interface Built { ok: boolean; diags: { code: string; message: string }[]; binaryPath?: string }
const BUILT = new Map<string, Built>();

async function build(name: string, src: string, backend: Lane): Promise<Built> {
  const dir = join(lab, `${name.replace(/[^a-z0-9]+/gi, "-")}-${backend}`);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "main.ts");
  await writeFile(file, src, "utf8");
  const res = await compile(file, {
    outPath: join(dir, exeName("program")),
    outDir: dir,
    backend,
  });
  return {
    ok: res.ok,
    diags: (res.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message })),
    binaryPath: res.ok ? res.binaryPath : undefined,
  };
}

beforeAll(async () => {
  lab = await mkdtemp(join(tmpdir(), "scriptc-ambient-extends-"));
  for (const backend of LANES) {
    for (const p of REFUSALS) BUILT.set(`R:${p.name}:${backend}`, await build(p.name, p.src, backend));
    for (const p of COMPILES) BUILT.set(`C:${p.name}:${backend}`, await build(p.name, p.src, backend));
    BUILT.set(`T:throws:${backend}`, await build("throws", THROWS_SRC, backend));
  }
}, 1_800_000);

describe("class D extends <ambient declare class>", () => {
  test.for(LANES)("the correct answer, RUN, on the %s lane", (backend) => {
    const b = BUILT.get(`T:throws:${backend}`)!;
    expect(
      b.ok,
      `the non-generic declaration shape must COMPILE to the throw, not refuse. Diagnostics: ` +
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
    // Node v25.9.0 on this program prints `before` and nothing else, and
    // exits 1. `after` printing at all was the original defect; `STATIC
    // RAN` printing is the same defect performing a side effect Node
    // never performs. stderr is NOT compared — the uncaught-report format
    // is a documented divergence (see differential.test.ts).
    expect(stdout, `${backend}: stdout must stop at the class statement`).toBe("before\n");
    expect(status, `${backend}: an uncaught ReferenceError exits 1`).toBe(1);
  });

  test.for(REFUSALS.map((p) => [p.name, p] as const))("refuses loudly: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`R:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) COMPILED. Either the shape gained a correct lowering — record it here — ` +
          `or the ambient base is being fabricated again, which is a silent wrong answer.`,
      ).toBe(false);
      const hit = b.diags.filter((d) => d.code === p.code && d.message.includes(p.fragment));
      expect(
        hit.length,
        `${p.name} (${backend}) refuses, but not with ${p.code} / "${p.fragment}". Saw: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 140)}`).join(" | "),
      ).toBeGreaterThan(0);
    }
  });

  test.for(COMPILES.map((p) => [p.name, p] as const))("does not over-fire: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`C:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) stopped compiling — the ambient-extends rule is firing on a shape ` +
          `that HAS a runtime. Diagnostics: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 140)}`).join(" | "),
      ).toBe(true);
    }
  });
});
