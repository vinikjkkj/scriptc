/* SEED PIN: which seeded container sites are built dyn-flavoured, and which
 * stay typed boxes. See src/frontend/seed-pin.ts for the doctrine.
 *
 * Every case loads a one-file JavaScript program with the pass OFF
 * (SCRIPTC_SEED_PIN=0), asks computeSeedPins what it would pin, and then
 * loads the same program with the pass ON and asks again: the second answer
 * must be EMPTY (a pinned site's container is `any`-typed, so the pass is
 * idempotent). The pinned cases are the positive control for the stay-typed
 * ones: the same harness answers 1 for them. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { applySeedPins, computeSeedPins } from "../src/frontend/seed-pin.js";

function pinsOf(source: string): { before: number; after: number } {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-seedpin-"));
  const entry = join(dir, "main.js");
  writeFileSync(entry, source);
  const realError = console.error;
  console.error = (): void => {};
  const saved = process.env["SCRIPTC_SEED_PIN"];
  try {
    process.env["SCRIPTC_SEED_PIN"] = "0";
    const off = loadProgram(entry);
    const before = [...computeSeedPins(off.program).values()].reduce((n, l) => n + l.length, 0);
    off.dispose();
    delete process.env["SCRIPTC_SEED_PIN"];
    const on = loadProgram(entry);
    const after = [...computeSeedPins(on.program).values()].reduce((n, l) => n + l.length, 0);
    on.dispose();
    return { before, after };
  } finally {
    console.error = realError;
    if (saved === undefined) delete process.env["SCRIPTC_SEED_PIN"];
    else process.env["SCRIPTC_SEED_PIN"] = saved;
  }
}

const PUT = "function put(m, k, v) { m.set(k, v); }\n";

/* ---- PINNED: the positive controls -------------------------------------- */

test("a seeded const handed to an untyped writer is pinned", () => {
  expect(pinsOf(`${PUT}const m = new Map([["a", 1]]);\nput(m, "b", "x");\nconsole.log(m.size);\n`)).toEqual({ before: 1, after: 0 });
});

test("a seeded Set handed to an untyped writer is pinned", () => {
  expect(pinsOf(`function add(s, v) { s.add(v); }\nconst s = new Set([1]);\nadd(s, "x");\nconsole.log(s.size);\n`)).toEqual({ before: 1, after: 0 });
});

test("a field, a return value, an argument and a let are pinned", () => {
  const got = pinsOf(
    `class A { constructor() { this.m = new Map([["a", 1]]); } }\n` +
      `function f() { return new Map([["a", 1]]); }\n` +
      `function g(x) { return x; }\n` +
      `g(new Map([["a", 1]]));\n` +
      `let l = new Map([["a", 1]]);\n` +
      `console.log(new A(), f(), l);\n`,
  );
  expect(got.before).toBe(4);
  expect(got.after).toBe(0);
});

test("a direct store of another type is pinned", () => {
  expect(pinsOf(`const m = new Map([["a", 1]]);\nm.set("b", "x");\nconsole.log(m.size);\n`)).toEqual({ before: 1, after: 0 });
});

test("a class-keyed seeded WeakMap is pinned", () => {
  expect(
    pinsOf(`class K {}\nconst k = new K();\nconst w = new WeakMap([[k, 1]]);\nconsole.log(w.get(k));\n`),
  ).toEqual({ before: 1, after: 0 });
});

test("a callee that WRITES the container makes it escape", () => {
  expect(pinsOf(`function w(m) { m.set("z", 1); }\nconst m = new Map([["a", 1]]);\nw(m);\nconsole.log(m.size);\n`)).toEqual({ before: 1, after: 0 });
});

/* ---- STAYS TYPED --------------------------------------------------------- */

test("a const with member operations of the inferred types stays typed", () => {
  expect(
    pinsOf(
      `const m = new Map([["a", 1]]);\nm.set("b", 2);\nlet t = 0;\nfor (const [k, v] of m) t += v;\n` +
        `console.log(t, m.get("a"), m.has("b"), m.size, [...m.keys()], typeof m);\n`,
    ),
  ).toEqual({ before: 0, after: 0 });
});

test("a callee that only READS the container keeps it typed", () => {
  expect(
    pinsOf(`function sum(m) { let t = 0; for (const v of m.values()) t += v; return t + m.size; }\nconst m = new Map([["a", 1]]);\nconsole.log(sum(m));\n`),
  ).toEqual({ before: 0, after: 0 });
});

test("console.log and Array.from of the container keep it typed", () => {
  expect(pinsOf(`const s = new Set([1, 2]);\nconsole.log(s, Array.from(s));\n`)).toEqual({ before: 0, after: 0 });
});

test("an ANNOTATED container (JSDoc) is never pinned", () => {
  expect(
    pinsOf(`/** @type {Map<string, number>} */\nconst m = new Map([["a", 1]]);\n${PUT}put(m, "b", 2);\nconsole.log(m.size);\n`),
  ).toEqual({ before: 0, after: 0 });
});

test("a JSDoc @type on a field assignment is never pinned", () => {
  expect(
    pinsOf(`class B { constructor() { /** @type {Map<string, number>} */ this.m = new Map([["a", 1]]); } }\nconsole.log(new B());\n`),
  ).toEqual({ before: 0, after: 0 });
});

test("a container that also flows into an ANNOTATED typed sink stays typed", () => {
  expect(
    pinsOf(
      `/** @param {Map<string, number>} y */\nfunction typed(y) { return y.size; }\n${PUT}const m = new Map([["a", 1]]);\nput(m, "b", 2);\nconsole.log(typed(m));\n`,
    ),
  ).toEqual({ before: 0, after: 0 });
});

test("a container of RECORDS receiving a foreign type is pinned", () => {
  expect(pinsOf(`${PUT}const m = new Map([["a", { n: 1 }]]);\nput(m, "b", 2);\nconsole.log(m.size);\n`)).toEqual({ before: 1, after: 0 });
});

test("a container of RECORDS written only with that record type stays typed", () => {
  expect(
    pinsOf(`const m = new Map([["a", { n: 1 }]]);\nm.set("b", { n: 2 });\nconsole.log(m.size, m.get("a").n);\n`),
  ).toEqual({ before: 0, after: 0 });
});

test("a container of ARRAYS is not pinned (a seed entry would be copied)", () => {
  expect(pinsOf(`${PUT}const xs = [1];\nconst m = new Map([["a", xs]]);\nput(m, "b", 2);\nconsole.log(m.size);\n`)).toEqual({ before: 0, after: 0 });
});

test("a plain-object keyed WeakMap is not pinned", () => {
  expect(pinsOf(`const k = {};\nconst w = new WeakMap([[k, 1]]);\nconsole.log(w.get(k));\n`)).toEqual({ before: 0, after: 0 });
});

/* ---- COMPOSES WITH js-desugar -------------------------------------------- */

test("a pinned site after a tsc helper (`(this && this.__h) || function`) is wrapped on the DESUGARED text", () => {
  // js-desugar rewrites the helper declaration, so the text the checker saw
  // (where the pin offsets come from) differs from the disk text. The second
  // load must pin that same text. Without the composition it threw
  // "seed pin: the text of ... changed between the two loads".
  const got = pinsOf(
    `var __pick = (this && this.__pick) || function (m, k) { return k.map(function (x) { return m.get(x); }); };\n` +
      `function run(keys) { return __pick(new Map([["a", 1], ["b", 2]]), keys).join("&"); }\n` +
      `console.log(run(["a", "b"]));\n`,
  );
  expect(got).toEqual({ before: 1, after: 0 });
});

/* ---- THE RE-SERVE -------------------------------------------------------- */

test("applySeedPins wraps exactly the seed, adds no line, and refuses a moved offset", () => {
  const text = `const m = new Map([["a", 1]]);\n`;
  const pin = { start: 18, end: 28, text: `[["a", 1]]`, why: "t" };
  const out = applySeedPins(text, [pin]);
  expect(out).toBe(`const m = new Map(/** @type {any} */ ([["a", 1]]));\n`);
  expect(out!.split("\n").length).toBe(text.split("\n").length);
  expect(applySeedPins(`xx${text}`, [pin])).toBeNull();
});
