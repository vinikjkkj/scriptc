/* Checked-cast FAILURE behavior — scriptc-only, deliberately NOT in the
 * differential corpus.
 *
 * The testing split for the dynamic boundary:
 * - tests/corpus/1000..1007 cover VALID casts differentially (Node and the
 *   native binary agree byte-for-byte — under Node a valid `as` is a no-op).
 * - A LYING cast cannot be tested differentially: Node never checks an `as`
 *   (it silently proceeds on mismatched data), while scriptc THROWS — the
 *   headline documented divergence (SEMANTICS.md). So mismatch programs are
 *   compiled and run here with scriptc ALONE: assert exit code 1 and that
 *   stderr carries the TypeError with the offending PATH.
 * - Exact parse-error message strings are asserted in the runtime C tests
 *   (packages/runtime/test/test_json.c), not here.
 *
 * SCRIPTC_SAN=1 builds these with ASan + the RC audit, turning every failure
 * path (partially-built records/arrays released mid-validation, dyn values
 * unwinding through catch) into a leak/double-free test.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Compiles an inline program and runs the binary, tolerating nonzero exit.
 * `ext` selects the source lane: "cjs" for the JS lane's per-site checked
 * lowerings (dyn member dispatch exists only there). */
async function compileAndRun(name: string, source: string, ext: "ts" | "cjs" = "ts", dynamic = false): Promise<RunResult> {
  const key = createHash("sha256")
    .update(source)
    .update(sanitize ? "san" : "plain")
    .update(dynamic ? "dyn" : "")
    .digest("hex")
    .slice(0, 16);
  const outDir = join(cacheDir, `dyncheck-${key}`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name}.${ext}`);
  writeFileSync(file, source);
  // Pinned: the exact TypeError text and path rendering of failed checked
  // casts are C-reference pins; lane identity stays fixed so a diff means
  // the dyn boundary changed, never that the default backend moved.
  const result = await compile(file, { outPath: join(outDir, exeName(name)), outDir, sanitize, backend: "c", dynamic });
  if (!result.ok) {
    throw new Error(
      "dyncheck program failed to compile:\n" +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }
  try {
    const { stdout, stderr } = await execFileAsync(result.binaryPath, [], { encoding: "utf8" });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof e.code !== "number") throw err;
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code };
  }
}

describe(`dynamic-boundary checks (scriptc-only${sanitize ? ", sanitized" : ""})`, () => {
  test("wrong-typed field throws with the path", async () => {
    const r = await compileAndRun(
      "wrong-type",
      `type Config = { host: string; port: number };
const c = JSON.parse('{"host":"h","port":"eighty"}') as Config;
console.log("unreachable", c.host);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Uncaught TypeError: expected number at $.port, got string");
  });

  test("missing field throws as undefined", async () => {
    const r = await compileAndRun(
      "missing-field",
      `type Config = { host: string; port: number };
const c = JSON.parse('{"host":"h"}') as Config;
console.log("unreachable", c.port);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected number at $.port, got undefined");
  });

  test("optional field: a PRESENT wrong-typed key throws with the arms named", async () => {
    // (A MISSING key producing the undefined arm is corpus-tested
    // differentially — 1009-json-optional-fields; this covers the failure
    // wording when the key IS there but fits no arm.)
    const r = await compileAndRun(
      "optional-present-wrong",
      `type Cfg = { host: string; port?: number };
const c = JSON.parse('{"host":"h","port":"eighty"}') as Cfg;
console.log("unreachable", c.host);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(
      "Uncaught TypeError: expected number | undefined at $.port, got string",
    );
  });

  test("JSON null matches nothing", async () => {
    const r = await compileAndRun(
      "null-value",
      `const n = JSON.parse("null") as number;
console.log("unreachable", n);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected number at $, got null");
  });

  test("JSON null misses a null-armed union's OTHER arm with the arms named", async () => {
    // (JSON null MATCHING a null arm is corpus-tested differentially —
    // 1008-json-null-arms; this covers the failure wording.)
    const r = await compileAndRun(
      "null-arm-miss",
      `type Rec = { a: string | null };
const x = JSON.parse('{"a": 5}') as Rec;
console.log("unreachable", x.a === null);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected null | string at $.a, got number");
  });

  test("union with no matching arm throws with all arms named", async () => {
    const r = await compileAndRun(
      "union-no-match",
      `type Shape = { kind: "circle"; r: number } | { h: number; kind: "rect"; w: number };
const s = JSON.parse('{"kind":"circle"}') as Shape; // r missing: matches NO arm
console.log("unreachable", s.kind);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected object | object at $, got object");
  });

  test("nested paths point at the offending element", async () => {
    const r = await compileAndRun(
      "nested-path",
      `type Deploy = { server: { host: string; ports: number[] } };
const d = JSON.parse('{"server":{"host":"h","ports":[80,443,"oops"]}}') as Deploy;
console.log("unreachable", d.server.host);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(
      "Uncaught TypeError: expected number at $.server.ports[2], got string",
    );
  });

  test("RECURSIVE shapes validate depth-first: the path names the deep offender", async () => {
    // The named-recursive-shape walker calls itself per level (JSON input
    // is a tree, so the recursion terminates); a failure three knots down
    // still renders the full path.
    const r = await compileAndRun(
      "recursive-path",
      `interface TreeNode { label: string; children: TreeNode[] }
const t = JSON.parse('{"label":"r","children":[{"label":"a","children":[{"label":7,"children":[]}]}]}') as TreeNode;
console.log("unreachable", t.label);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(
      "Uncaught TypeError: expected string at $.children[0].children[0].label, got number",
    );
  });

  test("array where a record is expected names the mismatch at the root", async () => {
    const r = await compileAndRun(
      "root-kind",
      `type Config = { port: number };
const c = JSON.parse("[1,2,3]") as Config;
console.log("unreachable", c.port);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected object at $, got array");
  });

  test("a failed check is CATCHABLE and execution recovers", async () => {
    const r = await compileAndRun(
      "catchable",
      `type Config = { port: number };
function load(raw: string): number {
  try {
    return (JSON.parse(raw) as Config).port;
  } catch {
    return -1;
  }
}
console.log(load('{"port":8080}'), load('{"port":"x"}'), load('{"port":1}'));
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("8080 -1 1\n");
    expect(r.stderr).toBe("");
  });

  test("width tolerance really is check-and-extract: extras dropped, no throw", async () => {
    const r = await compileAndRun(
      "width-tolerant",
      `type Slim = { a: number };
const s = JSON.parse('{"a":1,"b":{"huge":[1,2,3]},"c":"ignored"}') as Slim;
console.log(s.a, JSON.stringify(s));
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('1 {"a":1}\n');
  });

  test("tuple targets validate arity exactly", async () => {
    const r = await compileAndRun(
      "tuple-arity",
      `const rows = JSON.parse('[["a",1],["b",2,3]]') as [string, number][];
console.log("unreachable", rows.length);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected array of length 2 at $[1], got array");
  });

  test("tuple positions fail with index paths and per-position types", async () => {
    const r = await compileAndRun(
      "tuple-pos",
      `type Span = { range: [number, number] };
const s = JSON.parse('{"range":[0,"nine"]}') as Span;
console.log("unreachable", s.range[0]);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected number at $.range[1], got string");
  });

  test("an object where a tuple is expected names the array shape", async () => {
    const r = await compileAndRun(
      "tuple-kind",
      `const t = JSON.parse('{"0":"a","1":1}') as [string, number];
console.log("unreachable", t[1]);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected array at $, got object");
  });

  test("tuple failure-path RC stress: partial tuples release on unwind", async () => {
    const r = await compileAndRun(
      "tuple-rc-failure",
      `let recovered = 0;
for (let i = 0; i < 100; i = i + 1) {
  try {
    const rows = JSON.parse('[["ok","fine"],["bad",7]]') as [string, string][];
    recovered = recovered - rows.length;
  } catch {
    recovered = recovered + 1;
  }
}
console.log(recovered);
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("100\n");
  });

  test("failure-path RC stress: repeated mismatches through catch stay clean", async () => {
    // Meaningful mostly under SCRIPTC_SAN=1 (ASan + RC audit at exit): every
    // iteration builds a partial record/array that must release on unwind.
    const r = await compileAndRun(
      "rc-failure-stress",
      `type Entry = { tags: string[]; v: number };
let recovered = 0;
for (let i = 0; i < 100; i = i + 1) {
  try {
    const e = JSON.parse('{"tags":["a","b",7],"v":1}') as Entry; // tags[2] wrong
    recovered = recovered - e.v;
  } catch {
    recovered = recovered + 1;
  }
  try {
    const e2 = JSON.parse('{"tags":[],"v":"no"}') as Entry; // v wrong, after tags built
    recovered = recovered - e2.v;
  } catch {
    recovered = recovered + 1;
  }
}
console.log(recovered);
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("200\n");
  });

  test("index-signature shapes CAPTURE extras — and a wrong-typed extra throws with its key path", async () => {
    // Width tolerance becomes width capture on index-signature shapes: the
    // extras must fit the signature's value type. (The capture SUCCESS
    // path is corpus-tested differentially — 909-records-index-json.)
    const r = await compileAndRun(
      "index-capture-wrong",
      `const bag = JSON.parse('{"a":"1","b":7}') as Record<string, string>;
console.log("unreachable", bag["a"]);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected string at $.b, got number");
  });

  test("a dynamic write colliding with a declared field validates: mismatch throws, field untouched", async () => {
    // JS would store anything under the key; scriptc validates against
    // the declared slot's type instead (SEMANTICS.md divergence) — and the
    // throw is catchable with the field's own type in the message.
    const r = await compileAndRun(
      "index-write-collision",
      `interface P { input?: string; [k: string]: unknown }
const p: P = { input: "1" };
const k = "in" + "put";
try {
  p[k] = 42;
  console.log("unreachable");
} catch (e) {
  if (e instanceof TypeError) console.log("caught:", e.message);
}
console.log("kept:", p.input !== undefined ? p.input : "gone");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("caught: expected string | undefined at $.input, got number\nkept: 1\n");
  });

  test("overflow churn through failed collisions stays clean", async () => {
    // Meaningful mostly under SCRIPTC_SAN=1: every iteration hands ownership
    // of a fresh dyn value to the write helper, which must release it on
    // the validation-failure path.
    const r = await compileAndRun(
      "index-write-rc",
      `interface P { host: string; [k: string]: unknown }
const p: P = { host: "h" };
const k = "ho" + "st";
let recovered = 0;
for (let i = 0; i < 100; i = i + 1) {
  try {
    p[k] = i; // number into the string slot: throws, value released
  } catch {
    recovered = recovered + 1;
  }
  p["ok" + i] = "v" + i; // and a successful overflow insert each round
}
console.log(recovered, p.host);
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("100 h\n");
  });

  /* ── the checked-dynamic FUNCTION boundary ─────────────────────────
   * Happy paths (boxing, exact unwrap identity, adaptation, mustCall
   * end-to-end) are corpus-tested differentially (1650-1654). What CANNOT
   * be tested against Node lives here: JS never checks an `as`, and where
   * Node would coerce a mismatched argument, scriptc throws (SEMANTICS.md
   * 117 — loud, never silently wrong). */

  test("casting a non-function dyn value to a function type throws with the kind", async () => {
    const r = await compileAndRun(
      "dynfn-cast-nonfn",
      `const u: unknown = 42;
const f = u as (x: number) => number;
console.log("unreachable", f(1));
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected function at $, got number");
  });

  test("a boxed function's thunk validates arguments per declared param, positionally", async () => {
    const r = await compileAndRun(
      "dynfn-arg-mismatch",
      `function twice(x: number): number { return x * 2; }
const u: unknown = twice;
const s = u as (x: string) => unknown;
s("nope");
console.log("unreachable");
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected number at $[0], got string");
  });

  test("a MISSING argument is undefined and fails a required param's check", async () => {
    // JS arity: the thunk fills undefined; a number param can't hold it.
    const r = await compileAndRun(
      "dynfn-missing-arg",
      `function twice(x: number): number { return x * 2; }
const u: unknown = twice;
const zero = u as () => unknown;
zero();
console.log("unreachable");
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected number at $[0], got undefined");
  });

  test("an adapter validates the RESULT into the target's return type", async () => {
    const r = await compileAndRun(
      "dynfn-result-mismatch",
      `function greet(): string { return "hi"; }
const u: unknown = greet;
const asNum = u as () => number;
console.log("unreachable", asNum());
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected number at $, got string");
  });

  test("boundary TypeErrors are catchable and calls keep working after", async () => {
    const r = await compileAndRun(
      "dynfn-recover",
      `function twice(x: number): number { return x * 2; }
const u: unknown = twice;
const bad = u as (x: string) => unknown;
let caught = 0;
for (let i = 0; i < 50; i = i + 1) {
  try {
    bad("no");
  } catch {
    caught = caught + 1;
  }
}
const good = u as (x: number) => number;
console.log(caught, good(21));
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("50 42\n");
  });

  test("adapter/box churn stays clean (RC stress across the boundary)", async () => {
    // Meaningful mostly under SCRIPTC_SAN=1: every round boxes a fresh
    // closure, adapts it, calls through, and drops everything.
    const r = await compileAndRun(
      "dynfn-rc",
      `function makeAdder(n: number): (x: number) => number {
  return (x: number) => x + n;
}
let total = 0;
for (let i = 0; i < 100; i = i + 1) {
  const u: unknown = makeAdder(i);
  const f = u as (x: number) => unknown;
  total = total + (f(1) as number);
}
console.log(total);
`,
    );
    expect(r.exitCode).toBe(0);
    // sum of (1 + i) for i in 0..99
    expect(r.stdout).toBe("5050\n");
  });

  test("a lying `any` into a typed slot throws catchably where Node proceeds silently", async () => {
    // The static-any lane's exit stance (the checked cast's rule applied
    // to implicit any→typed flows): Node assigns the mismatched value and
    // carries on; scriptc throws the catchable TypeError. Loud, never a
    // silent wrong answer — the divergence is deliberate and documented.
    const r = await compileAndRun(
      "any-lying-exit",
      `const a: any = "not a number";
try {
  const n: number = a;
  console.log("unreachable", n);
} catch (e) {
  console.log((e as Error).name);
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("TypeError\nrecovered\n");
  });

  test("a lying cast into a union that cannot represent the value throws the stranded trap catchably", async () => {
    // The stranded-source trap (coerceToExpected): a checker-approved
    // value no union arm can hold — a unit smuggled through `null!` / `as
    // any`, or a scalar cast at a record union — compiles to the
    // catchable TypeError where Node lets the impossible value ride
    // (divergence 38's stance; the Node-exact families live in corpus
    // 2253).
    const r = await compileAndRun(
      "union-stranded-trap",
      `type U = { foo: number } | { bar: string };
try {
  const u: U = null!;
  console.log("unreachable", typeof u);
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("not representable in the target union"));
}
try {
  const w: U = 4 as any as U;
  console.log("unreachable", typeof w);
} catch (e) {
  console.log("scalar:", (e as Error).name);
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("TypeError true\nscalar: TypeError\nrecovered\n");
  });

  test("a LYING type predicate on a union property read throws the stranded trap catchably", async () => {
    // Reading a property the union answers only after NARROWING re-tags
    // the value into the arms the checker named at the site
    // (lowerUnionProperty; corpus 3301 covers the sound narrowings
    // differentially). A user type predicate is the checker's word, not a
    // proof: when it lies, the arm it admitted is not the arm the value
    // carries, and the re-tag's stranded case throws the catchable
    // TypeError instead of peeking a payload that has no such field. Node
    // reads undefined off the object, so this cannot be differential.
    const r = await compileAndRun(
      "union-read-lying-predicate",
      `interface Img { readonly kind: "img"; readonly media: string; readonly width: number }
interface Vid { readonly kind: "vid"; readonly media: string; readonly seconds: number }
interface Txt { readonly kind: "txt"; readonly text: string }
type Content = Img | Vid | Txt;
function lies(c: Content): c is Img | Vid { return true; }
function read(c: Content): string { return lies(c) ? c.media : "none"; }
console.log(read({ kind: "img", media: "ok.png", width: 1 }));
try {
  console.log("unreachable", read({ kind: "txt", text: "no media" }));
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("not representable in the target union"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("ok.png\nTypeError true\nrecovered\n");
  });

  test("a LYING type predicate narrowing to ONE arm throws instead of serving the sibling arm's slot", async () => {
    // The checker's union NARROWING bridge (maybeNarrow), not the property
    // read above: a single-arm narrowing types the reference as a record,
    // so the read never reaches lowerUnionProperty and the bridge extracts
    // the arm directly. That extraction used to be a bare peek with no tag
    // test, and this is the shape where that was worse than a crash: `Txt`
    // and `Img` have the SAME runtime layout (a string discriminant and a
    // string payload), so peeking a Txt through Img's struct served
    // `Txt.text` where the source asked for `Img.media` — a silent
    // type-confused read, exit 0, no diagnostic. Node prints undefined, so
    // it cannot be differential; corpus 3311 pins the honest direction.
    const r = await compileAndRun(
      "union-narrow-lying-predicate-sibling-slot",
      `interface Txt { readonly kind: "txt"; readonly text: string }
interface Img { readonly kind: "img"; readonly media: string }
type M = Txt | Img;
function lies(m: M): m is Img { return true; }
function read(m: M): string { return lies(m) ? m.media : "no media"; }
console.log(read({ kind: "img", media: "MEDIA" }));
try {
  console.log("unreachable", read({ kind: "txt", text: "TEXT NOT MEDIA" }));
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("not representable in the target union"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("MEDIA\nTypeError true\nrecovered\n");
  });

  test("a LYING type predicate over arms of DIFFERENT width throws instead of dereferencing the payload", async () => {
    // The same bridge, the shape that segfaulted. Two of the three source
    // arms have identical IR records, so the union carries TWO arms and a
    // predicate admitting both narrows to a single record type — the
    // bridge's extraction. Reading `payload` (a string) out of the arm
    // that actually holds `other` (a number) loaded a double as a string
    // pointer and dereferenced it: SIGSEGV, on both backends, with no
    // scriptc diagnostic at all. The tag test turns it into the catchable
    // TypeError, and the honest predicate beside it is unchanged.
    const r = await compileAndRun(
      "union-narrow-lying-predicate-payload-deref",
      `interface A { readonly type: "a"; readonly payload: string }
interface B { readonly type: "b"; readonly payload: string }
interface C { readonly type: "c"; readonly other: number }
type U = A | B | C;
function honest(u: U): u is A | B { return u.type !== "c"; }
function lying(u: U): u is A | B { return true; }
function readHonest(u: U): string { return honest(u) ? u.payload : "none"; }
function readLying(u: U): string { return lying(u) ? u.payload : "none"; }
console.log(readHonest({ type: "a", payload: "P" }));
console.log(readHonest({ type: "c", other: 1 }));
try {
  console.log("unreachable", readLying({ type: "c", other: 1 }));
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("not representable in the target union"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("P\nnone\nTypeError true\nrecovered\n");
  });

  test("a LYING type predicate narrowing to a SIBLING subclass throws instead of serving its slot", async () => {
    // The checker's CLASS narrowing bridge (maybeNarrow), the same
    // statement as the two union tests above one layer down. `Dog` and
    // `Cat` both extend `Animal` and both add one string, so the two
    // structs have the SAME width and put their own field at the same
    // offset behind the shared prefix. A bare reinterpret of a Cat as a
    // Dog therefore answered `Cat.sound` where the source asked for
    // `Dog.breed` — a plausible string, exit 0, no diagnostic, on both
    // backends. Node prints undefined for the missing property, so this
    // cannot be differential; corpus 3321 pins the honest direction.
    const r = await compileAndRun(
      "class-narrow-lying-predicate-sibling-field",
      `class Animal { readonly name: string; constructor(name: string) { this.name = name; } }
class Dog extends Animal { readonly breed: string; constructor(n: string, b: string) { super(n); this.breed = b; } }
class Cat extends Animal { readonly sound: string; constructor(n: string, s: string) { super(n); this.sound = s; } }
function lies(a: Animal): a is Dog { return true; }
function honest(a: Animal): a is Dog { return a instanceof Dog; }
function read(a: Animal): string { return lies(a) ? a.breed : "not a dog"; }
console.log(read(new Dog("rex", "BREED")));
console.log(honest(new Cat("tom", "MEOW")) ? "?" : "honest says no");
try {
  console.log("unreachable", read(new Cat("tom", "MEOW")));
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not a 'Dog'"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("BREED\nhonest says no\nTypeError true\nrecovered\n");
  });

  test("a LYING type predicate narrowing the BASE to a wider subclass throws instead of reading off the end", async () => {
    // The same bridge, the shape that segfaulted. A `Base` instance is
    // physically SHORTER than the `Wide` struct, so reinterpreting one as
    // the other and reading `s` loaded a pointer from past the end of the
    // allocation and dereferenced it: SIGSEGV under LLVM (exit 139) and a
    // garbage read under C, with no scriptc diagnostic either way. The
    // instanceof interval test turns it into the catchable TypeError, and
    // the honest narrowing beside it is unchanged.
    const r = await compileAndRun(
      "class-narrow-lying-predicate-base-is-shorter",
      `class Base { readonly a: string; constructor(a: string) { this.a = a; } }
class Wide extends Base { readonly n: number; readonly s: string;
  constructor(a: string, n: number, s: string) { super(a); this.n = n; this.s = s; } }
function lies(b: Base): b is Wide { return true; }
function read(b: Base): string { return lies(b) ? b.s : "narrow"; }
function readHonest(b: Base): string { return b instanceof Wide ? b.s : "narrow"; }
console.log(read(new Wide("x", 1, "S")));
console.log(readHonest(new Base("y")));
try {
  console.log("unreachable", read(new Base("y")));
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not a 'Wide'"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("S\nnarrow\nTypeError true\nrecovered\n");
  });

  test("a LYING type predicate narrowing a METHOD receiver throws instead of running the subclass body", async () => {
    // The bridge does not only feed field reads: the narrowed receiver is
    // what a method call dispatches on, so believing a lie ran the WRONG
    // BODY over the wrong layout. Base printed `woof CAT` for `a.bark()`
    // on a `Cat` (Node: "a.bark is not a function") and `DCAT4` for the
    // virtual `a.who()` (Node: `CCAT4`, the Cat's own override) — the
    // second is the alarming one, because the call devirtualized to the
    // subclass body on the strength of the narrowing alone. Both throw
    // catchably now; the honest narrowing beside them is unchanged.
    const r = await compileAndRun(
      "class-narrow-lying-predicate-method-receiver",
      `class A { readonly x: string; constructor(x: string) { this.x = x; } who(): string { return "A" + this.x; } }
class D extends A { readonly y: string; constructor(x: string, y: string) { super(x); this.y = y; }
  who(): string { return "D" + this.y; } bark(): string { return "woof " + this.y; } }
class C extends A { readonly z: string; constructor(x: string, z: string) { super(x); this.z = z; }
  who(): string { return "C" + this.z; } }
function lies(a: A): a is D { return true; }
function callIt(a: A): string { return lies(a) ? a.bark() : "no"; }
function virt(a: A): string { return lies(a) ? a.who() : "no"; }
function honest(a: A): string { return a instanceof D ? a.who() : a.who(); }
console.log(callIt(new D("1", "DOG")));
console.log(honest(new C("2", "CAT")));
try {
  console.log("unreachable", callIt(new C("2", "CAT")));
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not a 'D'"));
}
try {
  console.log("unreachable", virt(new C("4", "CAT4")));
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not a 'D'"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("woof DOG\nCCAT\nTypeError true\nTypeError true\nrecovered\n");
  });

  test("a WIDER record in a bound-emit payload slot throws instead of dereferencing the surplus field", async () => {
    // `emit.bind(x)` into a generic key-map slot lowers to a dispatcher
    // that tests the event NAME and then pulls the payload's arm out of
    // the slot's element union — a CONTAINER ELEMENT read of an array the
    // caller filled. It used to take that arm on the name test's word.
    //
    // No cast and no lying predicate is needed to break it, which is what
    // makes this family different from the narrowing bridges: `Wide` is
    // ASSIGNABLE to `Base`, so naming 'alpha' with a Wide value is plain
    // type-safe TypeScript. The value carries Wide's arm; the alpha branch
    // asked for Base's. `Wide` sorts `extra` (a double) where `Base` puts
    // `kind` (a string pointer), so the read loaded a double and
    // dereferenced it: SIGSEGV on BOTH backends, exit 139, no diagnostic.
    // Node prints the property it does have, so this cannot be
    // differential; corpus 3331 pins the honest direction.
    const r = await compileAndRun(
      "bound-emit-payload-wider-record",
      `import { EventEmitter } from "node:events";
interface Base { readonly kind: string }
interface Wide { readonly extra: number; readonly kind: string }
interface Ev { alpha: (p: Base) => void; beta: (p: Wide) => void }
interface Sink { readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void }
class Bus extends EventEmitter { sink(): Sink { return { emitEvent: this.emit.bind(this) }; } }
const bus = new Bus();
bus.on("alpha", (p: Base) => { console.log("alpha kind=" + p.kind); });
bus.on("beta", (p: Wide) => { console.log("beta extra=" + String(p.extra)); });
const s = bus.sink();
s.emitEvent("alpha", { kind: "A" });
s.emitEvent("beta", { extra: 7, kind: "B" });
const w: Wide = { extra: 99, kind: "LIED" };
try {
  s.emitEvent("alpha", w);
  console.log("unreachable");
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not representable"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("alpha kind=A\nbeta extra=7\nTypeError true\nrecovered\n");
  });

  test("a wider record whose surplus field is a STRING returns the wrong field, so it throws too", async () => {
    // The quiet flavour of the same read: `aaa` sorts before `kind`, so
    // the wrong-arm peek does not run off anything — it reads a perfectly
    // valid ScrStr at the offset `Base.kind` occupies and hands the
    // listener the WRONG STRING. Exit 0, both backends, no diagnostic and
    // nothing for a crash reporter. That is the shape a segfault would at
    // least have announced.
    const r = await compileAndRun(
      "bound-emit-payload-wrong-string",
      `import { EventEmitter } from "node:events";
interface Base { readonly kind: string }
interface Wide { readonly aaa: string; readonly kind: string }
interface Ev { alpha: (p: Base) => void; beta: (p: Wide) => void }
interface Sink { readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void }
class Bus extends EventEmitter { sink(): Sink { return { emitEvent: this.emit.bind(this) }; } }
const bus = new Bus();
bus.on("alpha", (p: Base) => { console.log("alpha kind=" + p.kind); });
bus.on("beta", (p: Wide) => { console.log("beta aaa=" + p.aaa); });
const s = bus.sink();
s.emitEvent("alpha", { kind: "A" });
const w: Wide = { aaa: "WRONG-FIELD", kind: "RIGHT-FIELD" };
try {
  s.emitEvent("alpha", w);
  console.log("unreachable");
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not representable"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("alpha kind=A\nTypeError true\nrecovered\n");
  });

  test("the nested regroup helper's TAIL is tested too, not assumed", async () => {
    // An event whose payload is itself a UNION cannot come out of the
    // element union with one narrow (the mapping flattened its arms in),
    // so the dispatcher calls a regroup helper: test each of the event
    // union's arms in turn, extract, re-wrap. The LAST arm used to be an
    // unconditional tail on the grounds that the caller's type says the
    // value is one of them — which is the same trust, one level in, and a
    // scope-walking analyser credits the tail as proven-by-exclusion
    // because the arms above it return.
    //
    // Here the element union carries 4 arms and the event's carries 2, so
    // a WideP (assignable to P, hence a legal 'gamma') fails the P test
    // and used to be regrouped as a Q: the listener printed `q=LIED`
    // where Node prints `p=LIED`. Silent, exit 0, both backends.
    const r = await compileAndRun(
      "bound-emit-regroup-tail",
      `import { EventEmitter } from "node:events";
interface P { readonly p: string }
interface Q { readonly q: string }
interface WideP { readonly zzz: number; readonly p: string }
interface R { readonly r: string }
interface Ev { gamma: (v: P | Q) => void; delta: (v: WideP) => void; eps: (v: R) => void }
interface Sink { readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void }
class Bus extends EventEmitter { sink(): Sink { return { emitEvent: this.emit.bind(this) }; } }
const bus = new Bus();
bus.on("gamma", (v: P | Q) => { console.log("gamma " + ("p" in v ? "p=" + v.p : "q=" + v.q)); });
bus.on("delta", (v: WideP) => { console.log("delta p=" + v.p); });
bus.on("eps", (v: R) => { console.log("eps r=" + v.r); });
const s = bus.sink();
s.emitEvent("gamma", { p: "P" });
s.emitEvent("gamma", { q: "Q" });
const w: WideP = { zzz: 5, p: "LIED" };
try {
  s.emitEvent("gamma", w);
  console.log("unreachable");
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not representable"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("gamma p=P\ngamma q=Q\nTypeError true\nrecovered\n");
  });

  test("a unit smuggled into a PLAIN non-nullable slot throws the stranded trap catchably", async () => {
    // The stranded-UNIT trap without a union in sight: `null!` / `null as
    // any as T` into a plain typed slot (string, array, class, function).
    // Node lets the impossible value ride until it is used; the flow
    // throws here instead (divergence 38's stance extended — SEMANTICS.md
    // 335).
    const r = await compileAndRun(
      "plain-stranded-unit-trap",
      `try {
  const s: string = null!;
  console.log("unreachable", s.length);
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("not representable in a 'string' slot"));
}
try {
  const a: number[] = undefined!;
  console.log("unreachable", a.length);
} catch (e) {
  console.log("array:", (e as Error).name);
}
try {
  const f: () => number = null!;
  console.log("unreachable", f());
} catch (e) {
  console.log("func:", (e as Error).name);
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("TypeError true\narray: TypeError\nfunc: TypeError\nrecovered\n");
  });

  test("a checker-approved function mismatch strands per piece: mismatched params compile at the flow, void results trap after the call", async () => {
    // funcCoerceAdapter's stranded dispositions. Param strand: an array
    // literal of arrows collapses to one element signature — the
    // mismatched arm compiles at the FLOW and could only throw if
    // invoked (the collapsed union types the call's parameter 'never', so
    // honest code cannot invoke it — narrowingUnionToUnion's shape).
    // Result strand: a 'never' thrower behind a typed-result slot — the
    // call runs, the throw wins before the stranded-result trap could
    // fire, so the flow is exact.
    const r = await compileAndRun(
      "func-stranded-adapter",
      `const cases = [
  (v: string) => { console.log("s", v.length); },
  (v: number) => { console.log("n", v + 1); },
];
console.log("assigned", cases.length);
function fail(msg: string): never { throw new Error(msg); }
const h: (s: string) => number[] = fail;
try {
  h("boom");
} catch (e) {
  console.log("never:", (e as Error).message);
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("assigned 2\nnever: boom\nrecovered\n");
  });

  test("a dyn write through a NAMED record's copy REFUSES rather than landing on the copy", async () => {
    // The crossing into an any/unknown slot copies a record (the static
    // and dynamic representations are different memory), so a write
    // through the copy cannot reach the object the caller still names --
    // Node prints "2 2" here. This used to answer "1 2", the silent
    // divergence; scr_dyn_static_copy_refuse replaced it with a loud one
    // ("loud beats lost") and every mutating dyn entry point shares it.
    // Aliasing the original is the real fix and is not built yet; until
    // it is, THIS is the behaviour, and nothing else pinned it.
    const r = await compileAndRun(
      "any-record-copy",
      `const base = { a: 1 };
const boxed: any = base;
boxed.a = 2;
console.log(base.a, boxed.a);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(
      "assigning a property through a value that crossed into an 'unknown' (dynamic) slot",
    );
  });

  test("an uninitialized `any` binding is the dyn undefined, not a trap", async () => {
    // The undefined-init rule: dyn slots are never NULL. (Node-agreeing
    // reads are corpus-tested — 2040; this pins the non-trap guarantee on
    // the module-global path with a captured reader.)
    const r = await compileAndRun(
      "any-uninit-global",
      `let cell: any;
function read(): any {
  return cell;
}
console.log(typeof read(), read() === undefined);
cell = 3;
console.log(typeof read(), read() === undefined);
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("undefined true\nnumber false\n");
  });
});

describe(`native-handle boundary fences (scriptc-only${sanitize ? ", sanitized" : ""})`, () => {
  // Handles cross the checked-dynamic boundary as SCR_DYN_HANDLE boxes;
  // the SUCCESS surface is corpus-tested differentially (1795-1798).
  // These pin the honesty ladder — texts Node never prints, because
  // under Node the members exist (the loud fence IS the divergence).

  const serverPreamble = `'use strict';
const http = require('http');
function wrap(fn) {
  return function() {
    return fn.apply(this, arguments);
  };
}
const server = http.createServer();
`;
  const listenAndHit = `
server.listen(0, '127.0.0.1', wrap(function() {
  http.get({ host: '127.0.0.1', port: server.address().port, path: '/' }, wrap(function(res) {}));
}));
`;

  test("a real-but-unmodeled member on a dyn handle throws the loud ladder", async () => {
    // writeContinue stays unmodeled (cork/uncork/flushHeaders graduated
    // to real dispatches — the ladder's exemplar moves with the surface).
    const r = await compileAndRun(
      "handle-unmodeled-member",
      serverPreamble +
        `server.on('request', wrap(function(req, res) {
  res.writeContinue();
}));
` + listenAndHit,
      "cjs",
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(
      "'ServerResponse.prototype.writeContinue' on a dynamic value is not supported yet",
    );
  });

  test("an expando write on a dyn handle throws the loud ladder (identity would break)", async () => {
    const r = await compileAndRun(
      "handle-expando-write",
      serverPreamble +
        `server.on('request', wrap(function(req, res) {
  req.custom = 1;
}));
` + listenAndHit,
      "cjs",
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("setting 'custom' on a dynamic IncomingMessage is not supported yet");
  });

  test("an unmodeled event registration on a dyn handle throws the loud ladder", async () => {
    const r = await compileAndRun(
      "handle-unmodeled-event",
      serverPreamble +
        `server.on('request', wrap(function(req, res) {
  req.on('nonsense', wrap(function() {}));
}));
` + listenAndHit,
      "cjs",
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(
      "listening for 'nonsense' on a dynamic IncomingMessage is not supported yet",
    );
  });

  test("a handle-targeted dynCheck failure names the class", async () => {
    const r = await compileAndRun(
      "handle-wrong-target",
      `import type { IncomingMessage } from "node:http";
const u: unknown = "not a request";
const req = u as IncomingMessage;
console.log("unreachable", req.url);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected IncomingMessage at $, got string");
  });

  test("a non-function listener on a dyn handle throws Node's ERR_INVALID_ARG_TYPE", async () => {
    const r = await compileAndRun(
      "handle-bad-listener",
      serverPreamble +
        `server.on('request', wrap(function(req, res) {
  try {
    req.on('data', 5);
  } catch (e) {
    console.log('caught: ' + String(e));
  }
  res.end('done');
  server.close();
}));
` + listenAndHit,
      "cjs",
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(
      'caught: TypeError [ERR_INVALID_ARG_TYPE]: The "listener" argument must be of type function. Received type number (5)',
    );
  });

  /* ── the jsval→dyn crossing's honesty ladder (SCR_DYN_JSVAL) ────────
   * The armed rows (typeof/truthiness/String()/===, the narrowing tests,
   * the identity round trip; the routed-ops lane's keyed read/write,
   * calls, method dispatch, Object statics, JSON.stringify) are
   * corpus-tested differentially (2578, 2579, 2582-2585, npm
   * jsval-into-dyn). These pin the LOUD fences of every dyn walk still
   * un-armed over an island-held value — the retired fence box answered
   * typeof "function" and .length 0 SILENTLY here; a wrong answer is
   * never acceptable, a named refusal is. All --dynamic. */

  // A JS-lane `any` producer: JSDoc-`any` returns are ISLAND values under
  // --dynamic (a bare record literal would infer a typed record and take
  // the deep-copy path instead; a local initialized FROM an island value
  // also stays island-world by the ratified runtime-world dispatch — the
  // crossing needs a real dyn slot: a param, a literal member, a return).
  const wrapPreamble = `const eng: any = { a: 1, list: [1, 2, 3] };
const u: unknown = eng;
`;

  test("a keyed read on an island-held unknown routes to the engine (the retired .length fence)", async () => {
    const r = await compileAndRun(
      "jsval-key-read",
      `/** @returns {any} */
function mint() { return { a: 1, list: [1, 2, 3] }; }
const eng = mint();
/** @param {object} bag */
function probe(bag) { console.log(bag.list.length, bag.a, bag.missing === undefined); }
probe(eng);
`,
      "cjs",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("3 1 true\n");
  });

  test("the collapsed (string | object)[] slot compiles and the element read routes", async () => {
    // Appendix-A repro 4's exit, one lane further along: the union-arm
    // SC2009 fence is RETIRED — `(string | object)[]` maps to the
    // checked-dynamic representation wholesale (every arm dyn-subsumable),
    // the island plugins array WRAPS at the slot (dynFromJsval), and the
    // element read rides the routed keyed-read arm: the engine answers,
    // the scalar normalizes, and typeof prints Node's answer.
    const r = await compileAndRun(
      "jsval-collapsed-union-slot",
      `const eng: any = ["p1", { languages: ["js"] }];
function firstPlugin(ps: (string | object)[]): void {
  console.log(typeof ps[0]);
}
firstPlugin(eng);
`,
      "ts",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("string\n");
  });

  test("a method call on an island-held unknown runs the engine's own prototype", async () => {
    // scr_dyn_invoke's JSVAL arm routes to scr_jsval_call_method — the
    // ENGINE's Array.prototype.slice runs (JS-exact), and the result
    // wraps back for further routed reads.
    const r = await compileAndRun(
      "jsval-method",
      `/** @returns {any} */
function mint() { return [{ languages: ["js"] }]; }
const eng = mint();
/** @param {object} plugins */
function walk(plugins) { return plugins.slice(); }
console.log(\`\${walk(eng).length}\`);
`,
      "cjs",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1\n");
  });

  test("JSON.stringify of an island-held unknown is the engine's own stringify", async () => {
    const r = await compileAndRun(
      "jsval-stringify",
      wrapPreamble + `console.log(JSON.stringify(u));
`,
      "ts",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"a":1,"list":[1,2,3]}\n');
  });

  test("structuredClone of an island-held unknown fences loudly", async () => {
    const r = await compileAndRun(
      "jsval-clone",
      wrapPreamble + `const c = structuredClone(u);
console.log("unreachable", typeof c);
`,
      "ts",
      true,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(
      "structuredClone on an island value held in 'unknown' is not supported yet",
    );
  });

  test("Object.keys over an island-held unknown walks the engine object", async () => {
    const r = await compileAndRun(
      "jsval-keys",
      `/** @returns {any} */
function mint() { return { a: 1, b: 2 }; }
const eng = mint();
/** @param {object} bag */
function keys(bag) { return Object.keys(bag); }
console.log(keys(eng).length, keys(eng).join(","));
`,
      "cjs",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("2 a,b\n");
  });

  test("deepStrictEqual over island-held values: identity passes, structure fences", async () => {
    const r = await compileAndRun(
      "jsval-deepeq",
      `import assert from "node:assert";
const eng: any = { a: 1 };
const other: any = { a: 1 };
const u1: unknown = eng;
const u2: unknown = eng;
assert.deepStrictEqual(u1, u2); // the same engine value: honest true
console.log("identity ok");
const u3: unknown = other;
assert.deepStrictEqual(u1, u3); // distinct values: the structural walk fences
console.log("unreachable");
`,
      "ts",
      true,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("identity ok");
    expect(r.stderr).toContain(
      "deepStrictEqual on an island value held in 'unknown' is not supported yet",
    );
  });

  test("util.inspect (console.log) of an island-held unknown fences with the engine typeof", async () => {
    const r = await compileAndRun(
      "jsval-inspect",
      wrapPreamble + `console.log(u);
`,
      "ts",
      true,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(
      "util.inspect of a composite 'any' value (typeof 'object') is not supported yet",
    );
  });

  test("destructuring and for-of over an island-held unknown drain the engine's own iterator", async () => {
    // The iteration arm (lane dom-jsval-long-tail): dyn.iterPack's JSVAL
    // arm drains the ENGINE's iterator protocol — the wrapped engine
    // array destructures and iterates with Node's answers, and a
    // non-iterable engine value throws V8's for-of spelling instead of
    // the retired island fence.
    const r = await compileAndRun(
      "jsval-iterate",
      `/** @returns {any} */
function mint() { return { list: [10, 20], num: 7 }; }
const eng = mint();
/** @param {object} bag */
function walk(bag) {
  const [first] = bag.list;
  console.log(\`first \${first}\`);
  let sum = 0;
  for (const x of bag.list) sum += x;
  console.log(\`sum \${sum}\`);
  try {
    for (const x of bag.num) console.log(x);
  } catch (err) {
    console.log(\`caught: \${err.message}\`);
  }
}
walk(eng);
`,
      "cjs",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("first 10\nsum 30\ncaught: bag.num is not iterable\n");
  });

  test("a keyed write through an island-held unknown lands on the real engine object", async () => {
    // Aliasing preserved: the island-side reader sees the write made
    // through the wrapped alias (the retired setting-fence row).
    const r = await compileAndRun(
      "jsval-key-write",
      `/** @returns {any} */
function mint() { return { a: 1 }; }
const eng = mint();
/** @param {object} bag */
function poke(bag) { bag.a = 2; bag.fresh = "x"; }
poke(eng);
console.log(\`\${eng.a} \${eng.fresh}\`);
`,
      "cjs",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("2 x\n");
  });

  test("'in' over an island-held unknown fences (never a silent false)", async () => {
    const r = await compileAndRun(
      "jsval-in",
      `/** @returns {any} */
function mint() { return { a: 1 }; }
const eng = mint();
/** @param {object} bag */
function has(bag) { return "a" in bag; }
console.log(has(eng));
`,
      "cjs",
      true,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("'in' on an island value held in 'unknown' is not supported yet");
  });

  test("a wrapped island value RC-balances through catch-and-continue fences", async () => {
    // The fence throws are catchable; the wrapped cell must release
    // cleanly through the unwind (the SAN lane's RC audit is the check).
    // The crossing rides a real dyn PARAM slot — a local initialized from
    // an island value stays island-world by the runtime-world dispatch.
    const r = await compileAndRun(
      "jsval-fence-unwind",
      `const eng: any = { a: 1 };
let caught = 0;
function probe(u: unknown): void {
  try {
    structuredClone(u);
  } catch (e) {
    if (e instanceof Error) caught++;
  }
}
for (let i = 0; i < 100; i++) probe(eng);
console.log("done", caught);
`,
      "ts",
      true,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("done 100\n");
  });

  test("a non-callable value under a METHOD field throws with the path", async () => {
    // The func LEAF: the target's field is callable, the JSON's is a
    // number. Node's `as` would sail through and only fail at the call
    // site (or not at all); the check names the field.
    // (The VALID direction is corpus-tested differentially —
    // 2734-dyncheck-func-leaf.)
    const r = await compileAndRun(
      "func-leaf-not-callable",
      `type Box = { name: string; f: () => number };
const bad = JSON.parse('{"name":"x","f":1}') as Box;
console.log("unreachable", bad.name);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Uncaught TypeError: expected function at $.f, got number");
  });

  test("a method-carrying union arm declines a lookalike object", async () => {
    // protobufjs's Long shape: the JSON has every DATA field of the object
    // arm and a number where the method belongs, so no arm fits and the
    // union fails as a whole rather than picking the arm on field names.
    const r = await compileAndRun(
      "func-arm-lookalike",
      `type Long = { high: number; low: number; toNumber: () => number; unsigned: boolean };
type Stamp = number | Long | null;
const s = JSON.parse('{"high":0,"low":1,"toNumber":2,"unsigned":false}') as Stamp;
console.log("unreachable", s === null ? "n" : "y");
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Uncaught TypeError: expected number | null | object at $, got object");
  });

  test("a '.filter' whose INFERRED predicate delegates to a lying guard throws instead of re-tagging", async () => {
    // `.filter` over a union-element array re-tags every survivor to the
    // narrowed arm. For a WRITTEN `v is T` that re-tag was already checked;
    // for an INFERRED one it was not, on the grounds that "the test just
    // passed for v". The test passing says the callback returned true, not
    // which arm the value holds — and the arrow below has no annotation, so
    // the predicate is the checker's inference over a body that is nothing
    // but a call to a guard that lies.
    //
    // The element union is the worst case for that by construction: the arm
    // being claimed and the arm the value holds are both arms of the SAME
    // union, which is the precondition the emit dispatcher's hazard needed.
    // `Miss` sorts `kind` where `Hit` puts `a`, so the wrong-arm peek read a
    // perfectly valid ScrStr at another field's offset and printed the WRONG
    // STRING — exit 0, both backends, no diagnostic. Node hands the callback
    // the object it was given and answers `undefined`, so this cannot be
    // differential; corpus 3341 pins the honest direction.
    const r = await compileAndRun(
      "filter-inferred-predicate-lies",
      `interface Hit { readonly a: string; readonly kind: string }
interface Miss { readonly kind: string; readonly z: string }
function isHit(v: Hit | Miss): v is Hit { return true; }
const xs: (Hit | Miss)[] = [{ a: "HIT-A", kind: "hit" }, { kind: "MISS-KIND", z: "MISS-Z" }];
try {
  const hits = xs.filter((v) => isHit(v));
  for (const h of hits) console.log("kept a=" + h.a);
  console.log("unreachable");
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not representable"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    // `.filter` builds the whole result before the loop over it runs, so the
    // throw lands inside the filter and the honest first element never prints.
    expect(r.stdout).toBe("TypeError true\nrecovered\n");
  });

  test("the same '.filter' re-tag over a NUMBER-carrying arm segfaulted, and now throws", async () => {
    // The loud flavour of the same read. `Miss` sorts a double where `Hit`
    // puts a string pointer, so the re-tagged element loaded the double and
    // dereferenced it: SIGSEGV on BOTH backends, exit 139, from a program
    // whose only untruth is an ordinary `v is T` guard the checker believed.
    const r = await compileAndRun(
      "filter-inferred-predicate-lies-segv",
      `interface Hit { readonly a: string; readonly kind: string }
interface Miss { readonly b: number; readonly kind: string }
function isHit(v: Hit | Miss): v is Hit { return true; }
const xs: (Hit | Miss)[] = [{ a: "HIT-A", kind: "hit" }, { b: 42, kind: "miss" }];
try {
  const hits = xs.filter((v) => isHit(v));
  for (const h of hits) console.log("kept a=" + h.a);
  console.log("unreachable");
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not representable"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("TypeError true\nrecovered\n");
  });

  // `Record<string, unknown>` flowing into a declared all-optional record.
  // tsc admits the assignment through the index-signature hole WITHOUT
  // checking any value type, so the map may genuinely hold anything; the
  // keyed read that reshapes it is a VALIDATED extraction, and the two
  // shapes that fail it print the value under Node. The agreeing half is
  // corpus 3621.
  test("Record<string, unknown> keyed read: a wrong-typed value throws with the arms named", async () => {
    const r = await compileAndRun(
      "keyread-unknown-wrong-type",
      `type U = { readonly name?: string };
const m: Record<string, unknown> = {};
m.name = 42;
console.log("before");
console.log(JSON.stringify({ updates: m } as { updates?: U }));
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("before\n");
    expect(r.stderr).toContain("Uncaught TypeError: expected string | undefined at $, got number");
  });

  test("Record<string, unknown> keyed read: a NULL value is not the undefined arm", async () => {
    // zapo's own `updates.picture = input.picture === null ? null : ...`
    // reaches this: the spec type says `picture?: string`, and null is not
    // one of its arms. Node hands the null straight through; the extraction
    // refuses it, which is the loud half of divergence 38 and strictly
    // better than main's unconditional throw at the same site.
    const r = await compileAndRun(
      "keyread-unknown-null",
      `type U = { readonly picture?: string };
const m: Record<string, unknown> = {};
m.picture = null;
console.log("before");
console.log(JSON.stringify({ updates: m } as { updates?: U }));
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("before\n");
    expect(r.stderr).toContain("Uncaught TypeError: expected string | undefined at $, got null");
  });

  // `o as Derived` on a class instance. Node never checks an `as`, so a
  // base instance simply reads `undefined` off the missing field; scriptc
  // takes the instanceof-gated bridge, exactly as it does for `u as Arm`
  // on a union. The agreeing half is corpus 3622. Before this bridge
  // existed the RECEIVER spelling did not throw at all — it raised SC9001,
  // an internal compiler error.
  test("class `as` downcast: a BASE instance throws instead of reading off the end", async () => {
    const r = await compileAndRun(
      "class-as-lying-base",
      `class P { p: string = "p" }
class Q extends P { q: string = "q" }
class R extends Q { r: string = "r" }
const q: Q = new Q();
console.log("before");
console.log((q as R).r);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("before\n");
    expect(r.stderr).toContain(
      "Uncaught TypeError: a 'Q' value is not a 'R' (a value narrowed or asserted past it still held another class)",
    );
  });

  test("class `as` downcast: a SIBLING subclass throws rather than answering its own field", async () => {
    // The dangerous one. S and R have the same width and put their own
    // field at the same offset, so an unchecked reinterpret would print
    // "SIBLING-SECRET" as `R.r` and nothing would crash.
    const r = await compileAndRun(
      "class-as-lying-sibling",
      `class P { p: string = "p" }
class Q extends P { q: string = "q" }
class R extends Q { r: string = "r" }
class S extends Q { s: string = "SIBLING-SECRET" }
const q: Q = new S();
try {
  console.log((q as R).r);
  console.log("unreachable");
} catch (e) {
  console.log((e as Error).name, (e as Error).message.includes("is not a 'R'"));
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("TypeError true\nrecovered\n");
  });
  /* A field an ACCESSOR provides. The materializing read is JS's [[Get]] MINUS
   * accessors, so a getter-provided member read as ABSENT: a REQUIRED field
   * threw where Node answers the getter's value, and an OPTIONAL one built the
   * undefined arm SILENTLY. The AGREEING half is differential (corpus 4801);
   * what lives here is the half Node cannot be asked about, because Node never
   * checks an `as` at all. */
  test("a getter answering the WRONG TYPE still fails, with the path", async () => {
    const r = await compileAndRun(
      "accessor-wrong-type",
      `type Named = { name: string };
const o = JSON.parse("{}");
Object.defineProperty(o as object, "name", {
  get(): number { return 7; },
  enumerable: false,
  configurable: true,
});
console.log("before");
console.log((o as Named).name);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("before\n");
    expect(r.stderr).toContain("Uncaught TypeError: expected string at $.name, got number");
  });

  test("a THROWING getter propagates its own error out of the cast", async () => {
    // Node runs the getter at the READ; a materializing cast runs it at the
    // CAST. Both throw the getter's own error and neither swallows it — the
    // point of the pending check on the accessor read.
    const r = await compileAndRun(
      "accessor-throws",
      `type Named = { name: string };
const o = JSON.parse("{}");
Object.defineProperty(o as object, "name", {
  get(): string { throw new Error("getter said no"); },
  enumerable: false,
  configurable: true,
});
try {
  console.log((o as Named).name);
  console.log("unreachable");
} catch (e) {
  console.log("caught:", (e as Error).message);
}
console.log("recovered");
`,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("caught: getter said no\nrecovered\n");
  });

  test("a SET-only accessor reads as undefined, and undefined is not a string", async () => {
    // JS answers `undefined` for a set-only accessor — an absent getter is not
    // an error, and it is not an absence of the property either. The cast then
    // fails for the ordinary reason, never for a made-up one.
    const r = await compileAndRun(
      "accessor-set-only",
      `type Named = { name: string };
const o = JSON.parse("{}");
Object.defineProperty(o as object, "name", {
  set(_v: string): void { /* no getter */ },
  enumerable: false,
  configurable: true,
});
console.log((o as Named).name);
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected string at $.name, got undefined");
  });

  test("a UNION arm whose record needs an accessor still reports no-arm-matched", async () => {
    // The MATCHER is deliberately unchanged: it returns bool and holds no
    // exception path, so it cannot run a getter. It therefore stays a SUBSET
    // of what the builder accepts, which is what keeps the union invariant
    // ("the matched arm's builder can no longer fail") true. The visible
    // consequence is that a union arm is not selected on an accessor-only
    // field — a known, LOUD limitation, recorded here so it cannot regress
    // into a silent one.
    const r = await compileAndRun(
      "accessor-union-arm",
      `type Arm = { name: string };
type U = Arm | number;
const o = JSON.parse("{}");
Object.defineProperty(o as object, "name", {
  get(): string { return "g"; },
  enumerable: false,
  configurable: true,
});
const u = o as U;
console.log(typeof u === "number" ? "number" : "record");
`,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Uncaught TypeError: expected");
  });

});
