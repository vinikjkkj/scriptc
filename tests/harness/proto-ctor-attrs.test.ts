/* Property ATTRIBUTES are per-OBJECT here, and one own property was the
 * exception — because nothing STORED it.
 *
 * The diagnosis this file was opened on was "per-instance semantics
 * represented per-shape". It is not true of this runtime, and the last
 * describe block is the proof: `hidden` is a table on the OBJ node itself
 * (`ScrDyn.v.obj.hidden`), so two objects that share a shape and differ in
 * an attribute already answer differently, and every combination the two
 * tables cannot express refuses LOUDLY at the define
 * (`Object.defineProperty` with an ENUMERABLE NON-WRITABLE data descriptor
 * names itself and stops).
 *
 * The real defect was one property that is in neither table. A function's
 * `prototype` object is minted on demand (`scr_dyn_fn_prototype`) and Node
 * gives it an own `constructor` — a data property { writable: true,
 * enumerable: FALSE, configurable: true }. This tier deliberately does not
 * STORE it: the prototype would hold a FUNC box holding the closure
 * holding the property table holding the prototype, so the value is
 * answered out of a pointer-keyed registry instead. The property therefore
 * existed for `in`, for Object.hasOwn and for the read, and existed
 * nowhere the two attribute tables could see. Two mirror-image wrong
 * answers came out of that, both silent, both on BOTH backends:
 *
 *   - `F.prototype.constructor = F` — the pre-class idiom — is a [[Set]]
 *     over an EXISTING non-enumerable own property, which ES answers by
 *     changing [[Value]] and keeping every attribute. Falling through to
 *     the ordinary member write instead put `constructor` into `entries`,
 *     and `entries` IS every enumeration surface at once: Object.keys,
 *     values, entries, assign, structuredClone, util.inspect and
 *     deepStrictEqual all reported a key Node does not show. Measured
 *     against v25.9.0: `["constructor"]` where Node says `[]`,
 *     `F { constructor: [Function: F] }` where Node says `{}`, and a
 *     deepStrictEqual that THREW where Node passes.
 *
 *   - The other direction, on a prototype nobody assigned to:
 *     `Object.getOwnPropertyNames(F.prototype)` answered `[]` where Node
 *     answers `["constructor"]`. The own-names walk is "Object.keys plus
 *     `length`", and this name is in neither table, so the list was
 *     silently SHORT — the exact failure `scr_dyn_own_names_fence` exists
 *     to prevent for every OTHER non-enumerable property.
 *
 * The narrowness is load-bearing and is asserted below. On any other
 * receiver Node has no own `constructor` to preserve, so
 * `C.prototype = Object.create(P.prototype); C.prototype.constructor = C`
 * — the ES5 inheritance idiom, and the far commoner spelling — creates an
 * ordinary ENUMERABLE property and `Object.keys` DOES list it, on both
 * sides, before and after. Widening the rule to every receiver would have
 * traded one wrong answer for another.
 *
 * `delete F.prototype.constructor` is the third fact, and it is why the
 * runtime carries TWO predicates rather than one: the implicit property is
 * configurable, so the delete succeeds and the object stops having an own
 * `constructor` (hasOwn false, own-names list short by it, a later
 * assignment creating an ORDINARY enumerable member) while `constructor`
 * stays reachable through the chain, so `in` keeps answering true. Using
 * "is a minted prototype" for "still owns its constructor" is how a
 * deleted property came back in a list.
 *
 * Node IS the oracle here, exactly as in the differential lane: every
 * expectation is this process's own `node <file>` output, so nothing can
 * drift into a golden file. BOTH backends run every case, because the fix
 * lives in the runtime AND in the LIFTED own-names walk, and a lifted walk
 * is built separately by each lane.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/** Both lanes, always. The runtime half is shared; the own-names walk is a
 * LIFTED function each backend emits for itself, and a fix green on one
 * lane and absent on the other is the drift this pair exists to catch. */
const BACKENDS = ["c", "llvm"] as const;

interface Ran {
  stdout: string;
  exitCode: number;
}

function runNode(file: string): Ran {
  try {
    const stdout = execFileSync(process.execPath, [file], { encoding: "utf8" });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { status?: unknown; stdout?: string };
    if (typeof e.status !== "number") throw err;
    return { stdout: e.stdout ?? "", exitCode: e.status };
  }
}

async function runCompiled(name: string, source: string, backend: "c" | "llvm"): Promise<Ran> {
  const key = createHash("sha256")
    .update(source)
    .update(backend)
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const outDir = join(cacheDir, `proto-ctor-attrs-${key}`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name}.js`);
  writeFileSync(file, source, "utf8");
  const result = await compile(file, {
    outPath: join(outDir, exeName(name)),
    outDir,
    sanitize,
    backend,
  });
  // A cell that could not COMPILE is not a passing cell and not a failing
  // one — it did not run, and the loudest possible thing to do with it is
  // to say so with the diagnostics attached. A refusal collapsed into
  // "no failure observed" is the same error this whole file is about.
  if (!result.ok) {
    throw new Error(
      `[${backend}] ${name} DID NOT RUN (compile refused):\n` +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }
  try {
    const stdout = execFileSync(result.binaryPath, [], { encoding: "utf8" });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { status?: unknown; stdout?: string };
    if (typeof e.status !== "number") throw err;
    return { stdout: e.stdout ?? "", exitCode: e.status };
  }
}

/** One cell: run it under Node, run it on both backends, demand byte
 * equality of stdout and agreement on the exit code. The Node run IS the
 * expectation — a case whose Node output is empty would make the assertion
 * vacuous, so the denominator is checked first. */
function differential(name: string, source: string): void {
  /* The cell name is prose and it also becomes a directory and a module
   * file name — spaces and commas ride into the emitted symbol names. It
   * works today on both backends (measured), but a stem is what a path
   * wants, so the path takes a slug and the report keeps the sentence. */
  const stem = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  describe(name, () => {
    for (const backend of BACKENDS) {
      test(
        `matches Node on the ${backend} backend`,
        async () => {
          const outDir = join(cacheDir, `proto-ctor-attrs-oracle-${stem}`);
          mkdirSync(outDir, { recursive: true });
          const oracleFile = join(outDir, `${stem}.js`);
          writeFileSync(oracleFile, source, "utf8");
          const want = runNode(oracleFile);
          expect(want.stdout.length).toBeGreaterThan(0);
          const got = await runCompiled(stem, source, backend);
          expect(got.stdout).toBe(want.stdout);
          expect(got.exitCode).toBe(want.exitCode);
        },
        240_000,
      );
    }
  });
}

describe("the minted prototype's own `constructor` is NON-ENUMERABLE", () => {
  /* The whole idiom, and every enumeration surface that reads the member
   * table. `Object.keys` is the headline; `Object.assign` and
   * structuredClone are the two that silently COPIED the key onwards. */
  differential(
    "assigned-backlink-is-invisible-to-enumeration",
    `function F() {}
F.prototype.constructor = F;
const p = F.prototype;
console.log("keys=" + JSON.stringify(Object.keys(p)));
console.log("entries=" + JSON.stringify(Object.entries(p).map((e) => e[0])));
console.log("values=" + Object.values(p).length);
console.log("assign=" + JSON.stringify(Object.keys(Object.assign({}, p))));
console.log("clone=" + JSON.stringify(Object.keys(structuredClone(p))));
console.log("json=" + JSON.stringify(p));
console.log("inspect=" + require("node:util").inspect(p));
`,
  );

  /* util.inspect's constructor-name walk, which is NOT "read cname". Node
   * keeps an own `constructor` descriptor only when
   * `value instanceof descriptor.value`, and `F.prototype instanceof F` is
   * false — the walk starts one link up. So a prototype prints as a bare
   * `{}` while an INSTANCE of it prints `F {}`. Three renderings, because
   * the nested forms take different arms of the inspector. */
  differential(
    "a prototype inspects as a plain object, an instance does not",
    `function F() {}
F.prototype.constructor = F;
const p = F.prototype;
console.log(p);
console.log([p]);
console.log({ p: p });
console.log(new F());
`,
  );

  /* deepStrictEqual compares own ENUMERABLE keys and the [[Prototype]].
   * With `constructor` in the member table this THREW. */
  differential(
    "deepStrictEqual sees no own key on a minted prototype",
    `const assert = require("node:assert");
function F() {}
F.prototype.constructor = F;
try { assert.deepStrictEqual(F.prototype, {}); console.log("deepEq=ok"); }
catch { console.log("deepEq=throw"); }
`,
  );

  /* The reads that always DID say the property exists, kept honest beside
   * the enumeration surfaces that now agree with them. */
  differential(
    "the property still exists, and still reads",
    `function F() {}
F.prototype.constructor = F;
const p = F.prototype;
console.log("hasOwn=" + Object.hasOwn(p, "constructor"));
console.log("in=" + ("constructor" in p));
console.log("name=" + p.constructor.name);
console.log("iname=" + new F().constructor.name);
`,
  );

  /* Assigned twice, and read through an instance: the second write updates
   * the VALUE of the same non-enumerable slot (ES's [[Set]]) rather than
   * layering an enumerable member over it. */
  differential(
    "a second assignment replaces the value, not the attributes",
    `function F() {}
function G() {}
F.prototype.constructor = F;
F.prototype.constructor = G;
console.log("name=" + F.prototype.constructor.name);
console.log("keys=" + JSON.stringify(Object.keys(F.prototype)));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(F.prototype)));
console.log("iname=" + new F().constructor.name);
`,
  );
});

describe("Object.getOwnPropertyNames lists it, in creation order", () => {
  /* The mirror defect: a prototype nobody assigned to. Node lists
   * `constructor`; the keys-plus-length walk could not see it at all. */
  differential(
    "an untouched prototype still owns constructor",
    `function F() {}
const p = F.prototype;
console.log("keys=" + JSON.stringify(Object.keys(p)));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(p)));
console.log("hasOwn=" + Object.hasOwn(p, "constructor"));
console.log("in=" + ("constructor" in p));
`,
  );

  /* Creation order is the order JS lists own string keys in, and a
   * prototype is BORN with `constructor` — so it comes first, before the
   * members the program added, whether or not it was ever assigned. */
  differential(
    "constructor comes first, before every added member",
    `function F() {}
F.prototype.constructor = F;
F.prototype.a = 1;
F.prototype.b = 2;
console.log("keys=" + JSON.stringify(Object.keys(F.prototype)));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(F.prototype)));
console.log("json=" + JSON.stringify(F.prototype));
function G() {}
G.prototype.m = function () { return 1; };
console.log("gopn2=" + JSON.stringify(Object.getOwnPropertyNames(G.prototype)));
`,
  );

  /* And the fence still fires for every OTHER non-enumerable property.
   * `secret` has no known creation position, so the walk refuses by name
   * rather than answering a list Node disagrees with — the exemption is
   * exactly one property wide, and this is what says so. The refusal is a
   * catchable throw, so Node stays the oracle for the lines around it. */
  differential(
    "the own-names fence still refuses any other hidden property",
    `function F() {}
F.prototype.constructor = F;
Object.defineProperty(F.prototype, "secret", { value: 1 });
console.log("keys=" + JSON.stringify(Object.keys(F.prototype)));
console.log("secret=" + F.prototype.secret);
`,
  );
});

describe("`delete` on the implicit backlink", () => {
  /* Ownership and mintedness part company here. Node: the delete succeeds,
   * hasOwn goes false, the own-names list loses the name, `in` stays true
   * (Object.prototype still has one), and a later assignment creates an
   * ORDINARY enumerable member. */
  differential(
    "deleting it removes the OWN property and re-assignment is ordinary",
    `function F() {}
F.prototype.constructor = F;
const p = F.prototype;
console.log("del=" + (delete p.constructor));
console.log("hasOwn=" + Object.hasOwn(p, "constructor"));
console.log("in=" + ("constructor" in p));
console.log("keys=" + JSON.stringify(Object.keys(p)));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(p)));
p.constructor = F;
console.log("keys2=" + JSON.stringify(Object.keys(p)));
console.log("gopn2=" + JSON.stringify(Object.getOwnPropertyNames(p)));
`,
  );

  differential(
    "deleting one that was never assigned",
    `function F() {}
const p = F.prototype;
console.log("del=" + (delete p.constructor));
console.log("hasOwn=" + Object.hasOwn(p, "constructor"));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(p)));
`,
  );
});

describe("every OTHER receiver keeps the ordinary enumerable answer", () => {
  /* The ES5 inheritance idiom, which is the common spelling and was
   * already exact. If the minted-prototype rule ever widens, this is the
   * cell that goes red. */
  differential(
    "Object.create(P.prototype) has no own constructor to preserve",
    `function P() {}
function C() {}
C.prototype = Object.create(P.prototype);
C.prototype.constructor = C;
console.log("keys=" + JSON.stringify(Object.keys(C.prototype)));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(C.prototype)));
console.log("json=" + JSON.stringify(C.prototype));
console.log("inspect=" + require("node:util").inspect(C.prototype));
`,
  );

  differential(
    "a plain literal assigned a constructor keeps it enumerable",
    `function F() {}
const o = {};
o.constructor = F;
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(o)));
console.log("inspect=" + require("node:util").inspect(o));
`,
  );
});

describe("attributes are PER-OBJECT, not per-shape", () => {
  /* The population the opening diagnosis predicted would be wrong. Two
   * objects of one shape, one carrying a non-enumerable member and one an
   * ordinary member of the same name; then an accessor installed on one of
   * them only. Every answer already matched Node before any of this
   * block's changes — `hidden` hangs off the OBJ node, not off a shape —
   * and this is the file that keeps it true. */
  differential(
    "two objects of one shape differ in an attribute",
    `const a = { x: 1 };
const b = { x: 1 };
Object.defineProperty(b, "y", { value: 2 });
b.z = 3;
a.y = 9;
a.z = 8;
console.log("a=" + JSON.stringify(Object.keys(a)));
console.log("b=" + JSON.stringify(Object.keys(b)));
console.log("aj=" + JSON.stringify(a));
console.log("bj=" + JSON.stringify(b));
console.log("b.y=" + b.y);
Object.defineProperty(a, "acc", { get() { return 42; }, configurable: true });
console.log("a.acc=" + a.acc + " akeys=" + JSON.stringify(Object.keys(a)));
console.log("b.acc=" + b.acc);
`,
  );

  /* [[Set]] over an own non-enumerable WRITABLE data property keeps the
   * attribute — the rule the `constructor` arm now reuses, applied to the
   * properties this runtime does store. And Object.create's descriptor map
   * installs both families, per object. */
  differential(
    "a write through a non-enumerable slot does not promote it",
    `const o = { v: 1 };
Object.defineProperty(o, "hid", { value: 7, writable: true, configurable: true });
o.hid = 8;
console.log("hid=" + o.hid + " keys=" + JSON.stringify(Object.keys(o)));
const proto = { p: 1 };
const c = Object.create(proto, { q: { value: 2 }, r: { value: 3, enumerable: true, writable: true } });
console.log("ckeys=" + JSON.stringify(Object.keys(c)));
console.log("q=" + c.q + " r=" + c.r + " p=" + c.p);
console.log("cjson=" + JSON.stringify(c));
`,
  );
});
