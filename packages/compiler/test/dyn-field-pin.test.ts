/* The dyn pin: an INFERRED class field that untyped code writes a value of
 * another type becomes a checked-dynamic slot, and every other field keeps
 * its typed layout.
 *
 * The pin is decided from what the first discovery pass saw (which classes
 * crossed into a dyn box, what was written through them under which key) and
 * applied by loading the program again with the field's initializer cast to
 * `any`. The corpus program (8822) proves the OUTPUT; what only the emitted
 * layout can prove is the other half of the contract -- that a field the
 * program's untyped writes AGREE with is not slowed down by a dyn box -- so
 * this reads the emitted struct. A parser that reads zero fields is
 * refused, for the reason dyn-class-box.test.ts spells out. */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

async function structOf(source: string, cls: string, ext = "js"): Promise<Map<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-dynpin-"));
  const src = join(dir, `main.${ext}`);
  await writeFile(src, source, "utf8");
  const res = await compile(src, { outPath: join(dir, "program"), outDir: dir, backend: "c", emitOnly: true });
  if (!res.ok) throw new Error(`refused: ${res.diagnostics[0]?.message ?? "?"}`);
  const c = await readFile(res.cPath, "utf8");
  const m = new RegExp(`struct sc_o_${cls} \\{[^\\n]*\\n([\\s\\S]*?)\\n\\};`).exec(c);
  if (m === null) throw new Error(`no struct for class ${cls} in the emitted C`);
  const out = new Map<string, string>();
  for (const line of m[1]!.split("\n")) {
    const f = /^\s*([\w *]+?)\s*\*?\s*sc_fld_(\w+);/.exec(line);
    if (f !== null) out.set(f[2]!, f[1]!.trim());
  }
  // A parser that matched nothing is a test gone blind, not a pass.
  expect(out.size, `the field parser read nothing out of:\n${m[1]}`).toBeGreaterThan(0);
  return out;
}

describe("the dyn pin of inferred class fields", () => {
  test("a field an untyped write contradicts is dyn; one it agrees with stays typed", async () => {
    const f = await structOf(`
class Box { constructor() { this.n = 1; this.s = "a"; this.keep = 5; } }
function setN(x) { x.n = "str"; }
function setKeep(x) { x.keep = 6; }
const b = new Box();
setN(b); setKeep(b);
console.log(b.n, b.s, b.keep);
`, "Box");
    expect(f.get("n")).toBe("ScrDyn");
    expect(f.get("keep")).toBe("double");
    expect(f.get("s")).toBe("ScrStr");
  });

  test("an untyped value written under a computed key may contradict every field", async () => {
    const f = await structOf(`
class Box { constructor() { this.n = 1; this.s = "a"; } }
function put(x, k, v) { x[k] = v; }
const b = new Box();
put(b, "n", "str");
console.log(b.n, b.s);
`, "Box");
    expect(f.get("n")).toBe("ScrDyn");
    expect(f.get("s")).toBe("ScrDyn");
  });

  test("a class that never reaches an untyped slot keeps every field typed", async () => {
    const f = await structOf(`
class Box { constructor() { this.n = 1; this.s = "a"; } }
function put(o, k, v) { o[k] = v; }
const bag = {};
put(bag, "n", "str");
const b = new Box();
console.log(b.n, b.s, bag.n);
`, "Box");
    expect(f.get("n")).toBe("double");
    expect(f.get("s")).toBe("ScrStr");
  });

  test("a JSDoc type claim is the author's annotation, not an inference", async () => {
    const f = await structOf(`
class Box {
  constructor() {
    /** @type {number} */
    this.n = 1;
    this.s = "a";
  }
}
function setBoth(x) { x.n = 2; x.s = 3; }
const b = new Box();
setBoth(b);
console.log(b.n, b.s);
`, "Box");
    expect(f.get("n")).toBe("double");
    expect(f.get("s")).toBe("ScrDyn");
  });

  test("a diagnostic after a pinned edit points at the author's own text", async () => {
    // The reload serves edited text; a refusal AFTER the edit must still land
    // on the construct as written (offsets map back across the inserted cast).
    const source = `class C { x = 1; y = "s" }
function setX(o: any) { o.x = "str" }
const c = new C()
setX(c)
const v = c as unknown as { x: number; y: string }
console.log(JSON.stringify(Object.values(v)))
`;
    const dir = await mkdtemp(join(tmpdir(), "scriptc-dynpin-"));
    const src = join(dir, "main.ts");
    await writeFile(src, source, "utf8");
    const res = await compile(src, { outPath: join(dir, "program"), outDir: dir, backend: "c", emitOnly: true });
    expect(res.ok).toBe(false);
    const d = res.diagnostics.find((x) => x.message.includes("Object.values"));
    expect(d, "the Object.values refusal").toBeDefined();
    expect(source.slice(d!.loc.start, d!.loc.end)).toBe("Object.values(v)");
  });
});
