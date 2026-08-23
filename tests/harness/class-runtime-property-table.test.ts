/* `Object.defineProperty(<a compiled class instance>, <a RUN-TIME string>,
 * <a descriptor>)` — the per-instance property table.
 *
 * WHAT THIS REPLACED: a compiled class instance is a C struct with one
 * cell per DECLARED member, so a property named by a run-time string had
 * nowhere to live and the whole spelling refused at the RECEIVER. That was
 * row 3 of zapo's tagged refusals — `src/client/plugins/install.ts:114`,
 * the exposed-plugin getter — and `tests/harness/zapo-tagged-refusals.ts`
 * now carries it on the CLOSED side.
 *
 * WHY A HARNESS FILE AND NOT ONLY CORPUS PROGRAMS: the corpus proves the
 * ANSWERS (Node is the oracle for every one of them, on both lanes —
 * 5990–5996). What it cannot prove is the two halves that have no Node
 * counterpart:
 *
 *   1. the shapes that must stay LOUD. A per-instance table's failure
 *      mode is not "it does not work", it is "it answers, wrongly, in a
 *      place nothing looks". Two shapes cannot be represented — a
 *      run-time key naming a DECLARED member (the field is a typed C cell
 *      and the table is beside it, so honouring it would leave two
 *      properties of one name) and a getter that is not an arrow (the
 *      table calls it with no receiver, and only an arrow's `this` is
 *      already captured) — and each must refuse where Node answers. A
 *      differential cannot assert that: the two sides differ by design.
 *
 *   2. the shapes that must STILL refuse. Object.keys, getOwnPropertyNames,
 *      spread, for-in and delete over a class receiver have no lowering,
 *      and that absence is load-bearing: it is the reason the table can
 *      hold an ENUMERABLE accessor at all without any surface reporting it
 *      wrongly. If one of them gains a lowering, it has to read the table,
 *      and this file is what says so out loud when it happens.
 *
 *   3. the COST. The field is added only to the classes a defineProperty
 *      site names. A class with no such site must carry no extra cell —
 *      asserted against the emitted C, not assumed.
 *
 * Both lanes throughout. The LLVM lane keeps its own emitter and this
 * project has shipped a fix green on one lane and wrong on the other.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const LANES = ["c", "llvm"] as const;
type Lane = (typeof LANES)[number];

/** The run-time key every program below uses. `process.argv.length > 99`
 * is false in every run, so the value is fixed — and nothing about it is
 * known at compile time, which is the whole point: a literal key lets a
 * folding path answer without reaching the table. */
const RTKEY = "const k = process.argv.length > 99 ? 'zz' : 'plug'\n";

/** Programs that must COMPILE and print exactly this. */
const RUNS: readonly { name: string; src: string; out: string }[] = [
  {
    name: "the zapo shape: an enumerable accessor named by a run-time string",
    src:
      "class Client { readonly name: string\n" +
      "  constructor(n: string) { this.name = n } }\n" +
      "const client = new Client('c')\n" +
      "const instances = new Map<string, number>()\n" +
      RTKEY +
      "instances.set(k, 7)\n" +
      "console.log(String(k in client))\n" +
      "Object.defineProperty(client, k, { get: () => instances.get(k), enumerable: true, configurable: false })\n" +
      "console.log(String(k in client))\n" +
      "console.log(client)\n",
    // Node v25.9.0, verbatim.
    out: "false\ntrue\nClient { name: 'c', plug: [Getter] }\n",
  },
  {
    name: "a non-enumerable accessor is a property `in` sees and inspect does not",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { get: () => 1, enumerable: false, configurable: true })\n" +
      "console.log(String(k in c))\n" +
      "console.log(c)\n",
    out: "true\nC { a: 1 }\n",
  },
  {
    name: "an ARRAY-INDEX key sorts ahead of the declared fields",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      "const ks = ['z', '10', '2']\n" +
      "for (let i = 0; i < ks.length; i += 1) {\n" +
      "  Object.defineProperty(c, ks[i], { value: i, enumerable: true, writable: true, configurable: true })\n" +
      "}\n" +
      "console.log(c)\n",
    out: "C { '2': 2, '10': 1, a: 1, z: 0 }\n",
  },
  {
    name: "a second define over a non-configurable property is a TypeError",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { get: () => 1, enumerable: true, configurable: false })\n" +
      "try {\n" +
      "  Object.defineProperty(c, k, { get: () => 2, enumerable: true, configurable: false })\n" +
      "  console.log('no throw')\n" +
      "} catch (e) { console.log((e as Error).message) }\n" +
      "console.log(c)\n",
    out: "Cannot redefine property: plug\nC { a: 1, plug: [Getter] }\n",
  },
  {
    name: "two instances of one class have two tables",
    src:
      "class C { a: number\n  constructor(v: number) { this.a = v } }\n" +
      "const x = new C(1)\nconst y = new C(2)\n" +
      RTKEY +
      "Object.defineProperty(x, k, { get: () => 9, enumerable: true, configurable: true })\n" +
      "console.log(String(k in x) + ' ' + String(k in y))\n" +
      "console.log(x)\nconsole.log(y)\n",
    out: "true false\nC { a: 1, plug: [Getter] }\nC { a: 2 }\n",
  },
  {
    // [[Get]] over the table. `scr_cls_props_get` shipped with NO caller
    // and `c[k]` refused a property the program had just defined on `c`,
    // while `in`, inspect and the enumerable count all read the same table.
    // The read must go through a WIDENING cast, because that is the only
    // spelling a class receiver has for a run-time key.
    name: "a run-time-keyed property reads back through a widening cast",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { value: 5, enumerable: true, writable: true, configurable: true })\n" +
      "const r = c as unknown as Record<string, unknown>\n" +
      "console.log(String(r[k]))\n",
    out: "5\n",
  },
  {
    // The accessor arm: the table RUNS the getter, with no receiver, which
    // is sound only because the lowering admits an arrow and nothing else.
    // A set-only accessor reads `undefined` — JS's answer, not a fence: the
    // property exists and its [[Get]] is undefined.
    name: "reading an accessor runs its getter; a set-only one reads undefined",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { get: () => 9, enumerable: true, configurable: true })\n" +
      "Object.defineProperty(c, k + 's', { set: (_v: unknown) => {}, enumerable: true, configurable: true })\n" +
      "const r = c as unknown as Record<string, unknown>\n" +
      "console.log(String(r[k]) + ' ' + String(r[k + 's']))\n",
    out: "9 undefined\n",
  },
];

/** Reads over a boxed instance that must stay the LOUD LADDER. Node answers
 * for all of them, and that divergence is the point: a class instance's
 * DECLARED members are struct cells the box cannot reach, so answering
 * `undefined` for a table MISS would answer `undefined` for `c.a` too — the
 * silent wrong answer the whole OBJINST arm exists to avoid. Every one of
 * these was already the fence before [[Get]] read the table; the rows are
 * here because the table lookup runs FIRST now, and a lookup that started
 * answering its own misses would take all of them silently. */
const READ_REFUSALS: readonly { name: string; src: string }[] = [
  {
    name: "a key no define ever put in the table",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { value: 5, enumerable: true, writable: true, configurable: true })\n" +
      "const r = c as unknown as Record<string, unknown>\n" +
      "console.log('READ ' + String(r['nope']))\n",
  },
  {
    name: "a DECLARED member read through the box",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { value: 5, enumerable: true, writable: true, configurable: true })\n" +
      "const r = c as unknown as Record<string, unknown>\n" +
      "console.log('READ ' + String(r['a']))\n",
  },
  {
    name: "any read on an instance of a class NO define names",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      "const r = c as unknown as Record<string, unknown>\n" +
      RTKEY +
      "console.log('READ ' + String(r[k]))\n",
  },
];

/** Programs that must refuse AT RUN TIME, loudly and catchably. Node
 * answers for both: the divergence is deliberate and is exactly what a
 * differential cannot assert. */
const RUNTIME_REFUSALS: readonly { name: string; src: string; fragment: string }[] = [
  {
    name: "a run-time key that names a DECLARED FIELD",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      "const k = process.argv.length > 99 ? 'zz' : 'a'\n" +
      "try {\n" +
      "  Object.defineProperty(c, k, { get: () => 9, enumerable: true, configurable: true })\n" +
      "  console.log('DEFINED')\n" +
      "} catch (e) { console.log('CAUGHT ' + (e as Error).message) }\n" +
      "console.log(String(c.a))\n",
    fragment: "names a member the class DECLARES",
  },
  {
    name: "a run-time key that names an INHERITED Object.prototype member",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      "const k = process.argv.length > 99 ? 'zz' : 'toString'\n" +
      "try {\n" +
      "  Object.defineProperty(c, k, { get: () => 9, enumerable: true, configurable: true })\n" +
      "  console.log('DEFINED')\n" +
      "} catch (e) { console.log('CAUGHT ' + (e as Error).message) }\n",
    fragment: "names a member the class DECLARES",
  },
];

/** Programs that must refuse AT COMPILE TIME. */
const COMPILE_REFUSALS: readonly { name: string; code: string; src: string }[] = [
  {
    // The table calls the getter with NO receiver, so only a getter whose
    // `this` is already captured is safe. A `function` expression could
    // read `this` and would get the wrong one.
    name: "a getter that is not an arrow function",
    code: "SC2020",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { get: function () { return 1 }, enumerable: true, configurable: true })\n" +
      "console.log(c)\n",
  },
  {
    // Every enumeration surface over a class receiver refuses, and that
    // absence is what makes the table exact rather than partial. If one of
    // these starts compiling it MUST read the table first.
    name: "Object.keys over an instance carrying a table",
    code: "SC2020",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { get: () => 1, enumerable: true, configurable: true })\n" +
      "console.log(Object.keys(c).join(','))\n",
  },
  {
    name: "Object.getOwnPropertyNames over an instance carrying a table",
    code: "SC2020",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { get: () => 1, enumerable: true, configurable: true })\n" +
      "console.log(Object.getOwnPropertyNames(c).join(','))\n",
  },
  {
    name: "object spread of an instance carrying a table",
    code: "SC1090",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { value: 5, enumerable: true, writable: true, configurable: true })\n" +
      "const s = { ...c }\nconsole.log(String(s.a))\n",
  },
  {
    name: "for-in over an instance carrying a table",
    code: "SC1052",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { value: 5, enumerable: true, writable: true, configurable: true })\n" +
      "for (const key in c) { console.log(key) }\n",
  },
  {
    name: "delete of a table key",
    code: "SC1090",
    src:
      "class C { a: number\n  constructor() { this.a = 1 } }\n" +
      "const c = new C()\n" +
      RTKEY +
      "Object.defineProperty(c, k, { value: 5, enumerable: true, writable: true, configurable: true })\n" +
      "delete (c as unknown as Record<string, unknown>)[k]\nconsole.log(String(k in c))\n",
  },
];

/** The COST control. A class no defineProperty site names must carry no
 * table cell, and the emitted struct is the only place that can be
 * checked — behaviour would look identical either way. */
const NO_TABLE_SRC =
  "class Plain { a: number\n  b: string\n  constructor() { this.a = 1; this.b = 'x' } }\n" +
  "const p = new Plain()\nconsole.log(p)\nconsole.log(String('a' in p))\n";

const TABLE_SRC =
  "class Tabled { a: number\n  constructor() { this.a = 1 } }\n" +
  "const t = new Tabled()\n" +
  RTKEY +
  "Object.defineProperty(t, k, { get: () => 1, enumerable: true, configurable: true })\n" +
  "console.log(t)\n";

let lab = "";
interface Built {
  ok: boolean;
  diags: { code: string; message: string }[];
  binaryPath?: string;
  cPath?: string;
}
const BUILT = new Map<string, Built>();

async function build(name: string, src: string, backend: Lane): Promise<Built> {
  const dir = join(lab, `${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}-${backend}`);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "main.ts");
  await writeFile(file, src, "utf8");
  const res = await compile(file, { outPath: join(dir, exeName("program")), outDir: dir, backend });
  return {
    ok: res.ok,
    diags: (res.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message })),
    ...(res.ok ? { binaryPath: res.binaryPath } : {}),
    ...(res.cPath ? { cPath: res.cPath } : {}),
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
  lab = await mkdtemp(join(tmpdir(), "scriptc-class-props-"));
  for (const backend of LANES) {
    for (const p of RUNS) BUILT.set(`R:${p.name}:${backend}`, await build(p.name, p.src, backend));
    for (const p of RUNTIME_REFUSALS) BUILT.set(`T:${p.name}:${backend}`, await build(p.name, p.src, backend));
    for (const p of READ_REFUSALS) BUILT.set(`G:${p.name}:${backend}`, await build(p.name, p.src, backend));
    for (const p of COMPILE_REFUSALS) BUILT.set(`C:${p.name}:${backend}`, await build(p.name, p.src, backend));
    BUILT.set(`N:no-table:${backend}`, await build("no-table", NO_TABLE_SRC, backend));
    BUILT.set(`N:table:${backend}`, await build("has-table", TABLE_SRC, backend));
  }
}, 1_800_000);

describe("a compiled class instance's run-time property table", () => {
  test.for(RUNS.map((p) => [p.name, p] as const))("runs Node-exactly: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`R:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) did not compile: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
      ).toBe(true);
      const r = run(b.binaryPath!);
      expect(r.status, `${p.name} (${backend}) exit code`).toBe(0);
      expect(r.stdout, `${p.name} (${backend}) stdout must equal Node v25.9.0's`).toBe(p.out);
    }
  });

  test.for(RUNTIME_REFUSALS.map((p) => [p.name, p] as const))("refuses LOUDLY at run time: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`T:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) must COMPILE — the refusal belongs at run time, where the key is known. ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
      ).toBe(true);
      const r = run(b.binaryPath!);
      // Node DEFINES here — it replaces the declared member with an
      // accessor. This representation cannot, and answering anyway would
      // leave two properties of one name with every statically-typed read
      // still seeing the field. `DEFINED` on this line means that trade
      // was made.
      expect(
        r.stdout,
        `${p.name} (${backend}) DEFINED a property over a declared member instead of refusing`,
      ).not.toContain("DEFINED");
      expect(r.stdout, `${p.name} (${backend}) must throw a catchable error naming the collision`).toContain(
        p.fragment,
      );
    }
  });

  test.for(READ_REFUSALS.map((p) => [p.name, p] as const))("a boxed read stays the loud ladder: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`G:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) did not compile: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
      ).toBe(true);
      const r = run(b.binaryPath!);
      // `READ` on stdout means the read ANSWERED. Node answers here and this
      // representation must not: a table miss and a declared member are the
      // same NULL out of scr_cls_props_get, and answering `undefined` for
      // either makes `c.a` read `undefined` in silence.
      expect(
        r.stdout,
        `${p.name} (${backend}) ANSWERED a boxed property read instead of refusing`,
      ).not.toContain("READ");
      expect(
        r.status,
        `${p.name} (${backend}) must exit non-zero on the uncaught refusal`,
      ).not.toBe(0);
    }
  });

  test.for(COMPILE_REFUSALS.map((p) => [p.name, p] as const))("refuses at compile time: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`C:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) COMPILED. If the shape gained a lowering it MUST read the run-time ` +
          `property table (ClassInfo.hasPropsTable) — an enumeration surface that reports a class's ` +
          `own keys without it is a silent wrong answer, and record the change here.`,
      ).toBe(false);
      expect(
        b.diags.some((d) => d.code === p.code),
        `${p.name} (${backend}) refuses, but not with ${p.code}. Saw: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 140)}`).join(" | "),
      ).toBe(true);
    }
  });

  test("the table costs nothing on a class no define names", () => {
    // C lane only: the emitted struct is the artifact that carries the
    // answer, and the LLVM lane writes no .c. Both lanes build the layout
    // from the SAME ClassInfo, so one reading settles it.
    const none = BUILT.get("N:no-table:c")!;
    const some = BUILT.get("N:table:c")!;
    expect(none.ok, "the no-table control did not compile").toBe(true);
    expect(some.ok, "the table program did not compile").toBe(true);
    const noneC = readFileSync(none.cPath!, "utf8");
    const someC = readFileSync(some.cPath!, "utf8");
    const plain = /struct sc_o_Plain \{[^}]*\}/.exec(noneC)?.[0] ?? "";
    const tabled = /struct sc_o_Tabled \{[^}]*\}/.exec(someC)?.[0] ?? "";
    expect(plain, "the no-table program's class struct was not found").toContain("sc_fld_a");
    expect(
      plain,
      "a class NO defineProperty site names grew the run-time property table anyway — " +
        "the field is 8 bytes and a traced edge per instance, on every class in the program",
    ).not.toContain("props");
    expect(
      tabled,
      "the class a defineProperty site DOES name is missing the table field",
    ).toContain("props");
  });

  test("the run-time key is not folded away by the literal-key `in` path", () => {
    // A literal `in` over a table-carrying class used to fold to the
    // constant false. It cannot any more: a define could have put that
    // exact name in the table.
    const b = BUILT.get("N:table:c")!;
    expect(b.ok).toBe(true);
    expect(
      readFileSync(b.cPath!, "utf8"),
      "the emitted C never calls scr_cls_props_* — the table is declared and never read",
    ).toContain("scr_cls_props_");
  });
});
