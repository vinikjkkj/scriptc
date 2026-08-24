/* An ENUMERABLE ACCESSOR on a checked-dynamic object, and every surface
 * that has to agree about one.
 *
 * `Object.defineProperty(o, k, { get, enumerable: true })` used to refuse,
 * and the refusal's own message stated the blocker exactly: "Object.keys
 * reads the member table and an accessor never enters it, so the key would
 * be missing from a set Node reports." The descriptor lived in the OBJ
 * node's `hidden` table, which records no creation order; the member table
 * IS the creation order but holds no attributes and no getter.
 *
 * The property now lives in BOTH. The descriptor stays in `hidden` and
 * grew a fifth element, `enumerable`; the member table gets a SLOT — one
 * immortal node, told apart by pointer — that carries the key and nothing
 * else. That is what gives the property a creation position, and it is why
 * scr_dyn_obj_key_order, the ONE own-key projection this runtime has, did
 * not have to change: the key is already in the table it walks.
 *
 * WHY THIS FILE IS AS WIDE AS IT IS. `entries` is every enumeration
 * surface at once — Object.keys/values/entries, JSON.stringify,
 * util.format's %j, Object.assign, structuredClone, util.inspect,
 * assert.deepStrictEqual and the own-names walk all read it — so a slot
 * one of them does not understand is a silent wrong answer in that one
 * surface only, which is the shape of a bug that surfaces somewhere else.
 * A prior block closed SEVEN of those from one missing attribute in the
 * same table. Every surface gets a cell here.
 *
 * Three properties are asserted that a cheaper representation would get
 * wrong, and each has its own cell:
 *
 *   ORDER. Own string keys list index-like keys first in numeric order,
 *   then the rest in CREATION order. A slot claimed at the end of the
 *   member table puts a new accessor exactly where JS puts it; a slot is
 *   never withdrawn when the property goes non-enumerable, so a
 *   redefinition back to enumerable restores the key to the position it
 *   had rather than to a new one, and a redefinition to a DATA property
 *   inherits the position too.
 *
 *   TIMING. Object.keys does NOT call the getter — Node lists an
 *   accessor's name without running anything, and a call there would be a
 *   side effect JS does not have. Object.values, Object.entries,
 *   JSON.stringify and Object.assign DO, once each. util.inspect does not,
 *   and prints `[Getter]`. The counter cell pins all six.
 *
 *   NO CACHING. Two reads of the same accessor answer the getter twice.
 *
 * Node IS the oracle: every expectation is this process's own `node <file>`
 * output, so nothing can drift into a golden file. BOTH backends run every
 * case — the runtime half is shared, but the own-names walk is a LIFTED
 * function each lane builds for itself, and a fix green on one lane and
 * absent on the other is the drift this pair exists to catch.
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
  const outDir = join(cacheDir, `dyn-enum-acc-${key}`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name}.js`);
  writeFileSync(file, source, "utf8");
  const result = await compile(file, {
    outPath: join(outDir, exeName(name)),
    outDir,
    sanitize,
    backend,
  });
  // A cell that could not COMPILE did not run. Saying "no failure
  // observed" about a refusal is the same error this file is about.
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

function differential(name: string, source: string): void {
  const stem = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  describe(name, () => {
    for (const backend of BACKENDS) {
      test(
        `matches Node on the ${backend} backend`,
        async () => {
          const outDir = join(cacheDir, `dyn-enum-acc-oracle-${stem}`);
          mkdirSync(outDir, { recursive: true });
          const oracleFile = join(outDir, `${stem}.js`);
          writeFileSync(oracleFile, source, "utf8");
          const want = runNode(oracleFile);
          // A case whose Node output is empty makes the assertion vacuous.
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

/* The receiver every cell below uses. The accessor is defined BETWEEN two
 * ordinary members on purpose: a representation that appended the key, or
 * that lost it, is visible in the very first assertion. */
const ACC = `const o = { a: 1 };
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
o.b = 3;
`;

describe("the key is listed, in position", () => {
  differential(
    "Object-keys-values-entries-list-the-accessor-in-creation-order",
    ACC +
      `console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("values=" + JSON.stringify(Object.values(o)));
console.log("entries=" + JSON.stringify(Object.entries(o)));
console.log("read=" + o.g);
`,
  );

  /* OrdinaryOwnPropertyKeys puts every array-index key ahead of every
   * string key across the WHOLE object, and an accessor is not exempt.
   * This is the cell that says the slot rides the shared projection
   * rather than a second copy of the ordering rule. */
  differential(
    "index-like-accessor-keys-sort-ahead-numerically",
    `const o = {};
o.z = 1;
Object.defineProperty(o, "10", { get() { return "ten"; }, enumerable: true, configurable: true });
o["2"] = "two";
Object.defineProperty(o, "y", { get() { return "why"; }, enumerable: true, configurable: true });
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
`,
  );

  differential(
    "accessors-and-members-interleave-by-creation",
    `const o = {};
o.a = 1;
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
o.b = 3;
Object.defineProperty(o, "h", { get() { return 4; }, enumerable: true, configurable: true });
o.c = 5;
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
`,
  );
});

describe("every surface that reads the member table", () => {
  differential("JSON-stringify-runs-the-getter", ACC + `console.log("json=" + JSON.stringify(o));\n`);

  differential(
    "Object-assign-copies-the-getters-VALUE-not-the-accessor",
    `const o = JSON.parse('{"a":1}');
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
o.b = 3;
const t = Object.assign(JSON.parse("{}"), o);
console.log("tkeys=" + JSON.stringify(Object.keys(t)));
console.log("tjson=" + JSON.stringify(t));
`,
  );

  differential(
    "structuredClone-carries-the-getters-value-across",
    `const o = JSON.parse('{"a":1}');
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
o.b = 3;
const c = structuredClone(o);
console.log("ckeys=" + JSON.stringify(Object.keys(c)));
console.log("cjson=" + JSON.stringify(c));
`,
  );

  /* util.inspect prints `[Getter]` and calls NOTHING — Node's default
   * `getters: false`. The same string scr_cls_props_inspect already gives
   * the same descriptor on a compiled class instance. */
  differential("util-inspect-prints-Getter-without-calling-it", ACC + `console.log(o);\n`);

  differential(
    "deepStrictEqual-compares-by-the-getters-value",
    `const assert = require("node:assert");
const o = JSON.parse('{"a":1}');
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
o.b = 3;
try { assert.deepStrictEqual(o, JSON.parse('{"a":1,"g":2,"b":3}')); console.log("eq=ok"); }
catch (e) { console.log("eq=throw " + e.name); }
`,
  );

  /* The own-names fence refuses a receiver carrying non-enumerable own
   * properties because their names are missing from the keys walk AND
   * their creation order is unrecorded. Both halves of that argument fail
   * for an enumerable accessor — the slot is its membership and its
   * order — so it is exempt, and only it. */
  differential(
    "getOwnPropertyNames-lists-it-rather-than-refusing",
    ACC + `console.log("names=" + JSON.stringify(Object.getOwnPropertyNames(o)));\n`,
  );

  differential(
    "a-nested-accessor-object-serializes-from-its-parent",
    ACC +
      `const outer = { inner: o, tail: 4 };
console.log("json=" + JSON.stringify(outer));
console.log("keys=" + JSON.stringify(Object.keys(outer.inner)));
`,
  );
});

describe("when the getter runs, and how often", () => {
  /* SIX surfaces in one program, each printing the counter after it.
   * Node: keys 0, values 1, JSON 2, inspect 2 (it prints `[Getter]`),
   * assign 3. A representation that snapshotted the value would answer 1
   * for all of them; one that cached would answer 1 and then stop. */
  differential(
    "the-getter-fires-per-surface-and-is-never-cached",
    `let n = 0;
const o = JSON.parse("{}");
Object.defineProperty(o, "g", { get() { n++; return n; }, enumerable: true, configurable: true });
Object.keys(o);
console.log("afterKeys=" + n);
Object.values(o);
console.log("afterValues=" + n);
JSON.stringify(o);
console.log("afterJson=" + n);
console.log(o);
console.log("afterInspect=" + n);
Object.assign(JSON.parse("{}"), o);
console.log("afterAssign=" + n);
`,
  );

  differential(
    "two-reads-answer-the-getter-twice",
    `let n = 0;
const o = {};
Object.defineProperty(o, "g", { get() { n++; return n; }, enumerable: true, configurable: true });
console.log("a=" + o.g);
console.log("b=" + o.g);
console.log("json=" + JSON.stringify(o));
console.log("n=" + n);
`,
  );

  /* A getter that THROWS unwinds the surface that called it, and the key
   * set — which calls nothing — is unaffected. */
  differential(
    "a-throwing-getter-unwinds-the-surface-that-called-it",
    `const o = { a: 1 };
Object.defineProperty(o, "g", { get() { throw new TypeError("boom"); }, enumerable: true, configurable: true });
try { JSON.stringify(o); console.log("json=nothrow"); }
catch (e) { console.log("json=throw " + e.name + " " + e.message); }
console.log("keys=" + JSON.stringify(Object.keys(o)));
try { Object.values(o); console.log("values=nothrow"); }
catch (e) { console.log("values=throw " + e.name); }
`,
  );
});

describe("the setter, and the live cell behind the pair", () => {
  differential(
    "a-write-runs-the-setter-and-creates-no-member",
    `const o = {};
let seen = "none";
Object.defineProperty(o, "g", {
  get() { return "got:" + seen; },
  set(v) { seen = v; },
  enumerable: true,
  configurable: true,
});
o.g = "written";
console.log("read=" + o.g);
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
`,
  );

  /* The shape a live module namespace needs: two bindings over one cell,
   * enumerable, so that a write through the property is visible in the
   * cell and a write to the cell is visible through the property. */
  differential(
    "a-live-cell-reads-and-writes-through-the-property",
    `let cell = 1;
const ns = JSON.parse("{}");
Object.defineProperty(ns, "v", { get() { return cell; }, set(x) { cell = x; }, enumerable: true, configurable: true });
console.log("k=" + JSON.stringify(Object.keys(ns)));
ns.v = 99;
console.log("cell=" + cell);
console.log("json=" + JSON.stringify(ns));
cell = 7;
console.log("after=" + JSON.stringify(ns));
`,
  );

  /* protobufjs's `inquire()`, in the shape it has at the site of zapo's
   * one remaining tagged refusal: `if (m && Object.keys(m).length) return m`.
   * A namespace whose keys do not enumerate answers `null` for a module
   * it resolved correctly — a silent wrong answer manufactured by the fix,
   * at the site the fix is for. This cell is that sentence, executable. */
  differential(
    "the-inquire-idiom-answers-the-namespace-not-null",
    `function nsOf() {
  const ns = JSON.parse("{}");
  let v = 42;
  Object.defineProperty(ns, "answer", { get() { return v; }, set(x) { v = x; }, enumerable: true, configurable: true });
  return ns;
}
function inquire() {
  try {
    const t = nsOf();
    return t && Object.keys(t).length ? t : null;
  } catch (e) { return null; }
}
const m = inquire();
console.log("null=" + (m === null));
console.log("answer=" + (m ? m.answer : "-"));
`,
  );
});

describe("redefinition keeps the property where it is", () => {
  /* enumerable true -> false -> true. Node does not MOVE a property that
   * is redefined, so the key comes back where it was. The slot stays as a
   * position tombstone through the middle state, which is the only record
   * of where "was" is. */
  differential(
    "flipping-enumerable-off-and-on-restores-the-position",
    `const o = {};
o.a = 1;
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
o.z = 3;
Object.defineProperty(o, "g", { enumerable: false });
console.log("k1=" + JSON.stringify(Object.keys(o)));
console.log("j1=" + JSON.stringify(o));
console.log("r1=" + o.g);
Object.defineProperty(o, "g", { enumerable: true });
console.log("k2=" + JSON.stringify(Object.keys(o)));
console.log("j2=" + JSON.stringify(o));
`,
  );

  /* A GENERIC descriptor — flags only, no get/set and no value — does not
   * CONVERT the property. Routing it to the data half installed a data
   * property whose value was undefined, which is a getter silently
   * destroyed by a call that named only an attribute. */
  differential(
    "a-flags-only-descriptor-keeps-the-accessor",
    `const o = { a: 1 };
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
Object.defineProperty(o, "g", { enumerable: false });
console.log("read=" + o.g);
console.log("keys=" + JSON.stringify(Object.keys(o)));
Object.defineProperty(o, "g", { configurable: true });
console.log("read2=" + o.g);
`,
  );

  /* …and the same rule on the DATA side, which is where the omission was
   * older and independent of accessors: a descriptor that omits `value`
   * over an existing property keeps the current one. */
  differential(
    "a-flags-only-descriptor-keeps-the-data-value",
    `const o = { k: 1 };
Object.defineProperty(o, "k", { enumerable: false });
console.log("k=" + o.k);
console.log("keys=" + JSON.stringify(Object.keys(o)));
`,
  );

  differential(
    "redefining-an-accessor-as-a-member-inherits-its-position",
    `const o = { a: 1 };
Object.defineProperty(o, "g", { get() { return 2; }, enumerable: true, configurable: true });
o.z = 3;
Object.defineProperty(o, "g", { value: 42, writable: true, enumerable: true, configurable: true });
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
console.log("g=" + o.g);
`,
  );

  differential(
    "deleting-an-enumerable-accessor-removes-BOTH-halves",
    ACC +
      `console.log("del=" + (delete o.g));
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("read=" + o.g);
console.log("hasOwn=" + Object.hasOwn(o, "g"));
`,
  );

  /* An accessor over an EXISTING member: ES keeps the omitted flags of the
   * property being redefined, and every own member of a dynamic object is
   * enumerable — so a bare `{ get }` there is an ENUMERABLE accessor, and
   * that "effective" reading is what the whole rule turns on. */
  differential(
    "a-bare-get-over-a-member-is-an-ENUMERABLE-accessor",
    `const o = { k: 1 };
Object.defineProperty(o, "k", { get() { return 9; } });
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("read=" + o.k);
console.log("json=" + JSON.stringify(o));
`,
  );
});

describe("the other two spellings, and the controls", () => {
  differential(
    "Object-defineProperties-installs-both-enumerabilities",
    `const o = { a: 1 };
Object.defineProperties(o, {
  g: { get() { return 2; }, enumerable: true, configurable: true },
  h: { get() { return 3; }, enumerable: false, configurable: true },
});
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
console.log("h=" + o.h);
`,
  );

  differential(
    "Object-create-with-an-enumerable-accessor-descriptor",
    `const base = { p: 0 };
const o = Object.create(base, {
  g: { get() { return 2; }, enumerable: true, configurable: true },
  a: { value: 1, enumerable: true, writable: true, configurable: true },
});
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
console.log("g=" + o.g + " p=" + o.p);
`,
  );

  differential(
    "an-enumerable-accessor-on-a-PROTOTYPE-is-not-an-instances-own-key",
    `function F() { this.own = 1; }
Object.defineProperty(F.prototype, "g", { get() { return 2; }, enumerable: true, configurable: true });
const i = new F();
console.log("keys=" + JSON.stringify(Object.keys(i)));
console.log("protokeys=" + JSON.stringify(Object.keys(F.prototype)));
console.log("g=" + i.g);
console.log("json=" + JSON.stringify(i));
`,
  );

  differential(
    "many-accessors-and-a-trailing-member-keep-their-order",
    `const o = {};
for (let i = 0; i < 5; i++) {
  const j = i;
  Object.defineProperty(o, "k" + j, { get() { return j * j; }, enumerable: true, configurable: true });
}
o.tail = "t";
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
`,
  );

  /* THE CONTROL, and it is the load-bearing one: a NON-enumerable
   * accessor was exact before this change and must stay exact. It takes
   * no slot, so `entries` for that object is byte-for-byte what it was.
   * pbjs's oneof accessors are this shape, 2 920 of them in the shipped
   * protobuf bundle, and their whole job is to stay off Object.keys. */
  differential(
    "CONTROL-a-non-enumerable-accessor-still-stays-off-Object-keys",
    `const o = { a: 1 };
Object.defineProperty(o, "g", { get() { return 2; }, configurable: true });
o.b = 3;
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
console.log("read=" + o.g);
console.log("in=" + ("g" in o));
console.log("hasOwn=" + Object.hasOwn(o, "g"));
`,
  );

  differential(
    "CONTROL-an-enumerable-writable-data-descriptor-is-still-an-ordinary-member",
    `const o = { a: 1 };
Object.defineProperty(o, "g", { value: 2, enumerable: true, writable: true, configurable: true });
o.b = 3;
console.log("keys=" + JSON.stringify(Object.keys(o)));
console.log("json=" + JSON.stringify(o));
`,
  );
});
