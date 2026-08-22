/* The EDGE of the async-generator lowering, pinned spelling by spelling.
 *
 * A declaration-scope `async function*` lowers onto the runtime's scr_agen_*
 * fiber protocol, and `for await` over one drives it (tests/corpus/5930 ..
 * 5933 score that against Node). The boundary is deliberately narrow, and a
 * narrow boundary is only safe while everything OUTSIDE it still REFUSES.
 *
 * That is what this file is for. The failure mode this project ranks above
 * every other is a refusal replaced by a silently wrong answer, and an async
 * generator has more ways to be silently wrong than almost anything else in
 * the language: a dropped yield, a resume one microtask early, a swallowed
 * mid-stream rejection, an early exit that skips a `finally`. None of those
 * shows up as a crash -- the program prints plausible output and is wrong.
 * So every spelling the lowering does NOT cover is planted here with the
 * code and the identifying fragment of the message it must still produce,
 * and a plant that stops refusing fails this test instead of shipping.
 *
 * A plant that starts COMPILING is not automatically a bug -- it may be the
 * feature growing. It is a bug to let that happen without recording it: move
 * the plant out of this file and into tests/corpus with Node as its oracle.
 *
 * Two of the fences here are OLDER than async generators and are pinned
 * anyway, because they are what actually stops the shape today and a change
 * to either would silently widen this feature: the generator-METHOD fence
 * (plant 2) and the stdlib-member fence that catches the direct resume
 * surface (plants 7 and 8). Each plant names the emitter it expects, so
 * "still refuses" can never be satisfied by an unrelated new refusal.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

/** One spelling outside the boundary. `accept` lists the (code, fragment)
 * pairs that identify the emitter which must fire; the plant passes when the
 * compile FAILS and at least one listed pair appears among its diagnostics.
 * A list longer than one entry is never a convenience -- it is written only
 * where the same source shape is known to reach two emitters depending on
 * how the checker resolves it. */
const PLANTS: readonly {
  name: string;
  why: string;
  accept: readonly { code: string; fragment: string }[];
  src: string;
}[] = [
  {
    name: "a generic async generator",
    why: "each monomorphized instance would be its own async generator; the collection site refuses before instantiation",
    accept: [{ code: "SC1071", fragment: "generic async generators" }],
    src: [
      "async function* generic<T>(v: T): AsyncGenerator<T, void, void> {",
      "  yield v",
      "}",
      "async function main(): Promise<void> {",
      "  for await (const x of generic(1)) console.log(x)",
      "}",
      "main()",
      "",
    ].join("\n"),
  },
  {
    name: "an async generator CLASS METHOD",
    why: "the pre-existing generator-method fence (a fiber-spawning method reached through dynamic dispatch); it never had to distinguish the two flavours and still does not",
    accept: [{ code: "SC1071", fragment: "generator methods" }],
    src: [
      "class Holder {",
      "  async *chunks(): AsyncGenerator<number, void, void> {",
      "    yield 1",
      "  }",
      "}",
      "async function main(): Promise<void> {",
      "  const h = new Holder()",
      "  for await (const v of h.chunks()) console.log(v)",
      "}",
      "main()",
      "",
    ].join("\n"),
  },
  {
    name: "an async generator OBJECT-LITERAL method",
    why: "the lowering keys on a function DECLARATION -- what carries a stable emitted name for the spawn wrapper and the settle thunk",
    accept: [{ code: "SC1071", fragment: "async generators (async function*)" }],
    src: [
      "const bag = {",
      "  async *chunks(): AsyncGenerator<number, void, void> {",
      "    yield 1",
      "  },",
      "}",
      "console.log(typeof bag)",
      "",
    ].join("\n"),
  },
  {
    name: "an async generator FUNCTION EXPRESSION",
    why: "same reason as the object-literal method: no declaration, no stable emitted name",
    accept: [{ code: "SC1071", fragment: "async generators (async function*)" }],
    src: [
      "const expr = async function* (): AsyncGenerator<number, void, void> {",
      "  yield 1",
      "}",
      "console.log(typeof expr)",
      "",
    ].join("\n"),
  },
  {
    name: "a NESTED async generator",
    why: "a closure over the enclosing frame, which this argument pack does not carry",
    accept: [{ code: "SC1071", fragment: "async generators (async function*)" }],
    src: [
      "async function outer(): Promise<void> {",
      "  async function* nested(): AsyncGenerator<number, void, void> {",
      "    yield 1",
      "  }",
      "  for await (const v of nested()) console.log(v)",
      "}",
      "outer()",
      "",
    ].join("\n"),
  },
  {
    name: "'yield*' inside an async generator",
    why: "the delegation desugar drives its delegate through the SYNCHRONOUS resume protocol, and an async delegate answers promises -- the loop would read a promise as an IteratorResult",
    accept: [{ code: "SC1071", fragment: "'yield*' inside an async generator" }],
    src: [
      "async function* inner(): AsyncGenerator<number, void, void> {",
      "  yield 1",
      "}",
      "async function* deleg(): AsyncGenerator<number, void, void> {",
      "  yield* inner()",
      "}",
      "async function main(): Promise<void> {",
      "  for await (const v of deleg()) console.log(v)",
      "}",
      "main()",
      "",
    ].join("\n"),
  },
  {
    name: "a direct .next() on an async generator",
    why: "the runtime keeps NO request queue: only the compiler's own strictly-sequential for-await desugar may resume one. Two overlapping requests would overwrite the in-flight promise and drop a settlement -- scr_agen_arm aborts rather than let that happen, and this fence is why that abort is unreachable",
    accept: [{ code: "SC2020", fragment: "AsyncGenerator<number, void, void>.next" }],
    src: [
      "async function* ok(): AsyncGenerator<number, void, void> {",
      "  yield 1",
      "}",
      "async function direct(): Promise<void> {",
      "  const g = ok()",
      "  const r = await g.next()",
      "  console.log(r.done)",
      "}",
      "direct()",
      "",
    ].join("\n"),
  },
  {
    name: "a direct .return() on an async generator",
    why: "same queue-free reason as .next()",
    accept: [{ code: "SC2020", fragment: "AsyncGenerator<number, void, void>.return" }],
    src: [
      "async function* ok(): AsyncGenerator<number, void, void> {",
      "  yield 1",
      "}",
      "async function early(): Promise<void> {",
      "  const g = ok()",
      "  await g.return()",
      "}",
      "early()",
      "",
    ].join("\n"),
  },
  {
    name: "'for await' over an AsyncIterable that is not a generator",
    why: "there is no async-iteration PROTOCOL here, only a generator drive: an AsyncIterable-typed value need not have a ScrGen handle to resume at all",
    accept: [{ code: "SC1070", fragment: "'for await'" }],
    src: [
      "declare const src: AsyncIterable<number>",
      "async function overIterable(): Promise<void> {",
      "  for await (const v of src) console.log(v)",
      "}",
      "overIterable()",
      "",
    ].join("\n"),
  },
  {
    name: "'for await' over an array of promises",
    why: "same: no [Symbol.asyncIterator] protocol, and an array is not a generator object",
    accept: [{ code: "SC1070", fragment: "'for await'" }],
    src: [
      "declare const src: readonly Promise<number>[]",
      "async function overPromises(): Promise<void> {",
      "  for await (const v of src) console.log(v)",
      "}",
      "overPromises()",
      "",
    ].join("\n"),
  },
];

/** The control: the ONE shape that is INSIDE the boundary. If this stops
 * compiling, every plant above passes for the wrong reason -- the feature
 * would be gone and the refusals would read as "still correctly fenced". */
const CONTROL = [
  "async function* chunks(): AsyncGenerator<number, void, void> {",
  "  yield 1",
  "  yield 2",
  "}",
  "async function main(): Promise<void> {",
  "  for await (const v of chunks()) console.log(v)",
  "}",
  "main()",
  "",
].join("\n");

interface Row {
  code: string;
  message: string;
}

async function diagnose(name: string, src: string): Promise<{ ok: boolean; rows: Row[] }> {
  const lab = await mkdtemp(join(tmpdir(), "scriptc-agen-edge-"));
  const dir = join(lab, name.replace(/[^a-z0-9]+/gi, "-"));
  await mkdir(dir, { recursive: true });
  const file = join(dir, "plant.ts");
  await writeFile(file, src, "utf8");
  // No backend pin and no bestEffort: every plant must fail in the FRONTEND,
  // which is itself part of what is asserted. A plant that only failed in a
  // backend would still have produced a lowering, and a lowering is exactly
  // what must not exist for these shapes.
  const res = await compile(file, { outPath: join(dir, "program"), outDir: dir });
  return {
    ok: res.ok,
    rows: res.ok ? [] : res.diagnostics.map((d) => ({ code: d.code ?? "", message: d.message ?? "" })),
  };
}

const brief = (rows: Row[]): string =>
  rows.map((r) => `${r.code}: ${r.message}`).join(" | ").slice(0, 600);

describe("the async-generator boundary", () => {
  test("the control compiles: a declaration-scope async generator driven by for-await", async () => {
    const { ok, rows } = await diagnose("control", CONTROL);
    expect(
      ok,
      `the IN-boundary control did not compile (${brief(rows)}). Every plant below then passes vacuously.`,
    ).toBe(true);
  }, 600_000);

  test.for(PLANTS.map((p) => [p.name, p] as const))("%s still refuses", async ([, p]) => {
    const { ok, rows } = await diagnose(p.name, p.src);
    expect(
      ok,
      `${p.name} COMPILED. It is outside the async-generator lowering (${p.why}), so either a fence leaked and ` +
        `this shape now produces code nobody has scored against Node, or the feature grew -- in which case move ` +
        `this plant into tests/corpus with Node as its oracle rather than deleting it.`,
    ).toBe(false);
    const hit = rows.some((r) => p.accept.some((a) => r.code === a.code && r.message.includes(a.fragment)));
    expect(
      hit,
      `${p.name} refused, but with none of the expected emitters. Expected one of ` +
        `${p.accept.map((a) => `${a.code} ~ "${a.fragment}"`).join(" / ")}; got ${brief(rows)}.`,
    ).toBe(true);
  }, 600_000);
});
