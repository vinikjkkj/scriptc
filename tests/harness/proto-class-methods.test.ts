/* A prototype-class's methods must all reach their call sites.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS DATED BEFORE THE ARM THAT NEEDS IT:
 * `lower-modules.ts` derives a class def's method list by REACHABILITY —
 * `def.methods.filter((m) => reachable.has("%" + def.name + "." + m))` —
 * and that filter IS the dead-stripper (tests/harness/deadstrip.test.ts
 * pins that an unreached body leaves no trace in the emitted C, so
 * bypassing the filter is not available; it would emit unused method
 * bodies, a size cost in a size project). The consequence for a class the
 * frontend SYNTHESIZES from a JavaScript pre-class constructor
 * (`function K(){...}` + `K.prototype.m = function(){...}`) is that a
 * method whose call site never fires `noteEdge` is dropped SILENTLY at
 * lowering and then fails validation at the call as a phantom undeclared
 * function. The validator now names reachability as the cause
 * (packages/compiler/src/ir/validate.test.ts) — this file is the other
 * half: the end-to-end evidence that each REACH SHAPE actually notes its
 * edge, one row per shape, so a regression names WHICH shape broke rather
 * than only that something did.
 *
 * SCORED AGAINST A LIVE NODE, NOT A TRANSCRIBED STRING. Every program
 * here is plain JavaScript that Node runs unchanged, so the oracle is
 * `process.execPath` executing the very file that was compiled. A
 * hard-coded expectation can rot into agreement with a wrong compiler;
 * a live oracle cannot.
 *
 * BOTH LANES. The LLVM backend keeps its own emitter and this project has
 * shipped a fix green on one lane and wrong on the other.
 *
 * TODAY (before the prototype-class arm lands) every one of these
 * compiles through the per-use dyn box in lower-classes.ts and answers
 * correctly — that is the point of a "can only turn a refusal or a dyn
 * box into a class" arm: this file must be green BEFORE and AFTER, and
 * the change it is guarding against is the one that makes it red.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const LANES = ["c", "llvm"] as const;
type Lane = (typeof LANES)[number];

/** One reach shape per row. The NAME is the shape, because a failure has
 * to say which one stopped noting its edge. */
const PROGRAMS: readonly { name: string; src: string }[] = [
  {
    // The plain shape: `new K(a)` into a local, then `inst.m()`.
    name: "a method called directly on a new-produced instance",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.get = function () { return this.v }\n" +
      "var b = new Box(7)\n" +
      "console.log(String(b.get()))\n",
  },
  {
    // The instance is never bound to a name at all.
    name: "a method called on a construction expression directly",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.get = function () { return this.v }\n" +
      "console.log(String(new Box(9).get()))\n",
  },
  {
    // TRANSITIVE REACH. `inner` is named by no user statement — its only
    // caller is another synthesized method. If `noteEdge` fires while
    // lowering user code but not while lowering a synthesized body, this
    // is the row that goes red.
    name: "a method reached ONLY from another prototype method",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.inner = function () { return this.v * 2 }\n" +
      "Box.prototype.outer = function () { return this.inner() + 1 }\n" +
      "var b = new Box(5)\n" +
      "console.log(String(b.outer()))\n",
  },
  {
    // Reached only from the CONSTRUCTOR body, which lowers on its own
    // entry point (`%K.constructor`) and can note edges independently of
    // the method entry point.
    name: "a method reached ONLY from the constructor",
    src:
      "function Box(v) { this.v = v; this.d = this.twice(v) }\n" +
      "Box.prototype.twice = function (n) { return n + n }\n" +
      "var b = new Box(6)\n" +
      "console.log(String(b.d))\n",
  },
  {
    // Two hops, both invisible to user code: ctor -> a -> b.
    name: "a method reached only through the constructor and one more hop",
    src:
      "function Box(v) { this.v = v; this.d = this.a(v) }\n" +
      "Box.prototype.a = function (n) { return this.b(n) + 1 }\n" +
      "Box.prototype.b = function (n) { return n * 10 }\n" +
      "var b = new Box(3)\n" +
      "console.log(String(b.d))\n",
  },
  {
    // The receiver is a PARAMETER, so the call site does not syntactically
    // name the class at all.
    name: "a method called through a function parameter",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.get = function () { return this.v }\n" +
      "function use(x) { return x.get() }\n" +
      "console.log(String(use(new Box(4))))\n",
  },
  {
    // The receiver is an ALIAS binding, and the method is reached through
    // both names.
    name: "a method called through an alias binding",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.get = function () { return this.v }\n" +
      "var b = new Box(2)\n" +
      "var alias = b\n" +
      "console.log(String(b.get()) + ',' + String(alias.get()))\n",
  },
  {
    // The receiver comes out of an ARRAY, so its static type is whatever
    // the element type is, not the construction's.
    name: "a method called on an instance read back out of an array",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.get = function () { return this.v }\n" +
      "var xs = [new Box(1), new Box(2)]\n" +
      "console.log(String(xs[0].get()) + ',' + String(xs[1].get()))\n",
  },
  {
    // A method that MUTATES a field the constructor also sets, and returns
    // `this` for chaining — the Writer shape. `pos` in zapo's Reader takes
    // sixteen method writes against an initializer of 0, so the slot type
    // must admit the method writes and not only the initializer.
    name: "a chaining method that rewrites a constructor-initialised field",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.bump = function (n) { this.v = this.v + n; return this }\n" +
      "Box.prototype.get = function () { return this.v }\n" +
      "var b = new Box(1)\n" +
      "console.log(String(b.bump(4).bump(5).get()))\n",
  },
  {
    // THE SIBLING ALIAS (`p.prototype.int64 = p.prototype.uint64` is four
    // of these in zapo's bundle). Two prototype names, ONE body. A method
    // table that files an alias as data — or binds the wrong body to it —
    // answers wrongly rather than failing, so the two names must return
    // values that CANNOT be confused with each other.
    name: "two prototype names sharing one body, and a third with its own",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.wide = function () { return this.v + 1000 }\n" +
      "Box.prototype.narrow = function () { return this.v + 1 }\n" +
      "Box.prototype.alias = Box.prototype.wide\n" +
      "var b = new Box(5)\n" +
      "console.log(String(b.wide()) + ',' + String(b.narrow()) + ',' + String(b.alias()))\n",
  },
  {
    // TWO classes in one file whose methods share a name. A method table
    // keyed by method name rather than by (class, method) binds one of
    // these to the other's body — a wrong answer, not a build failure.
    name: "two prototype-classes with same-named methods",
    src:
      "function A(v) { this.v = v }\n" +
      "A.prototype.get = function () { return 'A' + String(this.v) }\n" +
      "function B(v) { this.v = v }\n" +
      "B.prototype.get = function () { return 'B' + String(this.v) }\n" +
      "console.log(new A(1).get() + ',' + new B(2).get())\n",
  },
  {
    // Names REUSED in different scopes. Minification puts two distinct
    // classes behind one identifier (`n`, `o` and `s` each name two
    // classes in zapo's bundle), so an IR class name minted from the
    // BINDING NAME rather than from position merges them.
    name: "two distinct prototype-classes behind one identifier in different scopes",
    src:
      "function makeOne() {\n" +
      "  function K(v) { this.v = v }\n" +
      "  K.prototype.tell = function () { return 'one:' + String(this.v) }\n" +
      "  return new K(1)\n" +
      "}\n" +
      "function makeTwo() {\n" +
      "  function K(w) { this.w = w }\n" +
      "  K.prototype.tell = function () { return 'two:' + String(this.w) }\n" +
      "  return new K(2)\n" +
      "}\n" +
      "console.log(makeOne().tell() + ',' + makeTwo().tell())\n",
  },
  {
    // The DEAD-STRIP side, stated as behaviour rather than as an emission
    // grep: an unreached method must not change what a reached one
    // answers. (What the C must not CONTAIN is deadstrip.test.ts's
    // contract; asserting it here before the arm exists would only
    // measure the dyn box's property table.)
    name: "an unreached method beside reached ones",
    src:
      "function Box(v) { this.v = v }\n" +
      "Box.prototype.get = function () { return this.v }\n" +
      "Box.prototype.neverCalledFromAnywhere = function () { return this.v - 999 }\n" +
      "var b = new Box(8)\n" +
      "console.log(String(b.get()))\n",
  },
];

let lab = "";
interface Built {
  ok: boolean;
  diags: { code: string; message: string }[];
  binaryPath?: string;
  oracle: string;
}
const BUILT = new Map<string, Built>();

function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
}

async function build(name: string, src: string, backend: Lane): Promise<Built> {
  const dir = join(lab, `${slug(name)}-${backend}`);
  await mkdir(dir, { recursive: true });
  // `.js`, deliberately: the arm this file guards is JavaScript-only
  // (`isJsSourceFile`), mirroring `fnOwnPropBox` — in TypeScript the
  // checker has a declared type at the construction.
  const file = join(dir, "main.js");
  await writeFile(file, src, "utf8");
  const res = await compile(file, { outPath: join(dir, exeName("program")), outDir: dir, backend });
  return {
    ok: res.ok,
    diags: (res.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message })),
    ...(res.ok ? { binaryPath: res.binaryPath } : {}),
    oracle: execFileSync(process.execPath, [file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  };
}

function run(bin: string): { stdout: string; status: number | null } {
  try {
    return {
      stdout: execFileSync(bin, [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
      status: 0,
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { stdout: err.stdout ?? "", status: err.status ?? null };
  }
}

beforeAll(async () => {
  lab = await mkdtemp(join(process.env["TMPDIR"] ?? process.env["TMP"] ?? ".", "scriptc-protoclass-"));
  for (const backend of LANES) {
    for (const p of PROGRAMS) BUILT.set(`${p.name}:${backend}`, await build(p.name, p.src, backend));
  }
}, 1_800_000);

describe("a JavaScript pre-class constructor's prototype methods", () => {
  // THE SELF-TEST. A harness that cannot report "the oracle disagreed"
  // cannot be trusted when it reports agreement. Every oracle string must
  // be non-empty and they must not all be the same string — if the node
  // runs silently produced nothing, or produced one constant, every
  // comparison below would pass vacuously.
  test("the oracle is live: every program printed, and they differ", () => {
    const seen = new Set<string>();
    for (const p of PROGRAMS) {
      const b = BUILT.get(`${p.name}:c`)!;
      expect(b.oracle, `node printed nothing for: ${p.name}`).not.toBe("");
      seen.add(b.oracle);
    }
    expect(seen.size, "every program produced the same oracle string — the oracle is not live").toBeGreaterThan(
      PROGRAMS.length / 2,
    );
  });

  test.for(PROGRAMS.map((p) => [p.name, p] as const))(
    "every method reaches its call site: %s",
    ([, p]) => {
      for (const backend of LANES) {
        const b = BUILT.get(`${p.name}:${backend}`)!;
        expect(
          b.ok,
          `${p.name} (${backend}) did not compile. A [call to undeclared function "%K.m"] here ` +
            `means a synthesized method was pruned because its call site never fired noteEdge: ` +
            b.diags.map((d) => `${d.code} ${d.message.slice(0, 200)}`).join(" | "),
        ).toBe(true);
        const r = run(b.binaryPath!);
        expect(r.status, `${p.name} (${backend}) exit code`).toBe(0);
        expect(
          r.stdout,
          `${p.name} (${backend}) must print exactly what ${process.execPath} prints`,
        ).toBe(b.oracle);
      }
    },
  );
});

/* ── SCRIPTC_PROTOCLASS=1: the arm's OTHER state ─────────────────────────
 *
 * The arm is OFF by default and everything above scores the default. This
 * block scores the arm ON, and it is deliberately a MIXED ledger: some shapes
 * answer Node-exactly through the synthesized class, and some do not — those
 * are NAMED GAPS, pinned so the day one is fixed this file says so out loud
 * instead of quietly agreeing.
 *
 * The gap is one mechanism, not several: A CLASS INSTANCE COERCED INTO A DYN
 * SLOT KEEPS ITS FIELDS AND LOSES ITS METHODS. It is not caused by this arm —
 * main has it today for a DECLARED `class` in a .js file:
 *
 *     class Box { constructor(v) { this.v = v } get() { return this.v } }
 *     function use(x) { return x.get() }
 *     console.log(String(use(new Box(7))))
 *
 *     node    -> 7
 *     scriptc -> Uncaught TypeError: x.get is not a function
 *
 * The per-use dyn box the arm replaces dispatches that call correctly, so a
 * default-on arm would take such a program from MATCH to WRONG. That is the
 * whole reason for the flag, and it is why the OFF rows above are the ones
 * that must stay green.
 *
 * Two slots reach a dyn-typed destination in a JavaScript file:
 *   - an untyped PARAMETER (`function use(x)`), and
 *   - a `var` binding, whose slot is decided when the declaration HOISTS,
 *     before any initializer has lowered. `const`/`let` take their type from
 *     the lowered initializer and work.
 */
const ARM = "SCRIPTC_PROTOCLASS";
const PROTO = "function Box(v) { this.v = v }\nBox.prototype.get = function () { return this.v }\n";

const ARMED: readonly { name: string; src: string; gap: string | null }[] = [
  {
    name: "a const binding holding the instance",
    src: PROTO + "function run() { const b = new Box(7); return b.get() }\nconsole.log(String(run()))\n",
    gap: null,
  },
  {
    name: "a let binding the file never reassigns",
    src: PROTO + "function run() { let b = new Box(7); return b.get() }\nconsole.log(String(run()))\n",
    gap: null,
  },
  {
    // NAMED GAP. A `var` slot is typed when the declaration HOISTS — before
    // the initializer lowers — so the class instance boxes into a dyn slot
    // and loses its methods. Minified bundles spell `var`, so this is the
    // shape that matters most and the one that does not work.
    name: "a var binding holding the instance",
    src: PROTO + "function run() { var b = new Box(7); return b.get() }\nconsole.log(String(run()))\n",
    gap: "a var slot is typed at HOIST, before the initializer lowers",
  },
  {
    // NAMED GAP, and NOT this arm's doing: identical for a declared `class`.
    name: "the instance through an untyped parameter",
    src: PROTO + "function use(x) { return x.get() }\nconsole.log(String(use(new Box(4))))\n",
    gap: "an untyped JS parameter is a dyn slot; main loses a DECLARED class's methods here too",
  },
];

describe("SCRIPTC_PROTOCLASS=1 — the arm ON", () => {
  const RESULT = new Map<string, { ok: boolean; matched: boolean; detail: string }>();
  beforeAll(async () => {
    const prev = process.env[ARM];
    process.env[ARM] = "1";
    try {
      for (const p of ARMED) {
        const b = await build("armed-" + p.name, p.src, "c");
        const r = b.ok ? run(b.binaryPath!) : { stdout: "", status: null };
        RESULT.set(p.name, {
          ok: b.ok,
          matched: b.ok && r.status === 0 && r.stdout === b.oracle,
          detail: b.ok
            ? `exit ${String(r.status)} stdout ${JSON.stringify(r.stdout)} oracle ${JSON.stringify(b.oracle)}`
            : b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
        });
      }
    } finally {
      if (prev === undefined) delete process.env[ARM];
      else process.env[ARM] = prev;
    }
  }, 1_800_000);

  test.for(ARMED.filter((p) => p.gap === null).map((p) => [p.name, p] as const))(
    "answers Node-exactly with the arm ON: %s",
    ([, p]) => {
      const r = RESULT.get(p.name)!;
      expect(r.matched, `${p.name}: ${r.detail}`).toBe(true);
    },
  );

  test.for(ARMED.filter((p) => p.gap !== null).map((p) => [p.name, p] as const))(
    "NAMED GAP, still open: %s",
    ([, p]) => {
      const r = RESULT.get(p.name)!;
      // Pinned as a divergence ON PURPOSE. If this goes green the gap closed —
      // move the row up, and reconsider whether the arm can default ON.
      expect(
        r.matched,
        `${p.name} now MATCHES with the arm on — the gap (${p.gap!}) is CLOSED. ` +
          `Move this row into the answering set and re-examine the default. ${r.detail}`,
      ).toBe(false);
    },
  );
});
