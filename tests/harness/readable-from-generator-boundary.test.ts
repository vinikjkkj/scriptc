/* The EDGE of `Readable.from` over a generator, pinned spelling by spelling.
 *
 * `Readable.from(asyncGen())` is a PULL source now: one `iterator.next()`
 * per `_read`, stopping the moment `push()` answers false, with the
 * generator closed on destroy so its `finally` blocks run. Corpus 5940,
 * 5941 and 5942 score that against Node — order, back-pressure, close,
 * mid-stream rejection. What this file guards is the OTHER side: the
 * boundary is narrow on purpose, and a narrow boundary is only safe while
 * everything outside it still refuses.
 *
 * The specific way this bridge could go silently wrong is worth naming,
 * because it is the reason the type test is not "any generator". The pump
 * moves the generator's OUT slot into the readable buffer AS A REFERENCE:
 * the buffer holds ScrBytes or ScrStr entries and nothing else. A yield of
 * a number would be read as a pointer — a wrong answer with no diagnostic
 * anywhere, which is the failure this project ranks above every other. So
 * the admitted yield types are pinned from both directions here: the three
 * that must COMPILE, and the shapes that must still refuse WITH the
 * emitter that names the yield type.
 *
 * A plant that starts compiling is not automatically a bug — it may be the
 * feature growing. It is a bug to let that happen without recording it:
 * move the plant into tests/corpus with Node as its oracle.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const IMPORT = "import { Readable } from 'node:stream'";

/** One spelling outside the bridge. `accept` lists the (code, fragment)
 * pairs that identify the emitter which must fire; the plant passes when
 * the compile FAILS and at least one listed pair appears. */
const PLANTS: readonly {
  name: string;
  why: string;
  accept: readonly { code: string; fragment: string }[];
  src: string;
}[] = [
  {
    name: "a SYNCHRONOUS generator source",
    why: "Node's from() wraps a sync iterator in an async one; the runtime pump resumes an ScrGen through the ASYNC protocol (a promise per request, an await allowed between yields) and a synchronous generator has no such handle — a second pump, not a wider type test",
    accept: [{ code: "SC2020", fragment: "Readable.from over a 'Generator<" }],
    src: [
      IMPORT,
      "function* chunks(): Generator<Uint8Array> {",
      "  yield new Uint8Array([1])",
      "}",
      "export function make(): Readable {",
      "  return Readable.from(chunks())",
      "}",
      "console.log(typeof make)",
      "",
    ].join("\n"),
  },
  {
    name: "an async generator yielding NUMBERS",
    why: "the readable buffer holds ScrBytes/ScrStr entries and the pump moves OUT into it as a reference; a number yield would be read as a pointer",
    accept: [{ code: "SC2020", fragment: "async generator yielding 'number'" }],
    src: [
      IMPORT,
      "async function* nums(): AsyncGenerator<number> {",
      "  yield 1",
      "}",
      "export function make(): Readable {",
      "  return Readable.from(nums())",
      "}",
      "console.log(typeof make)",
      "",
    ].join("\n"),
  },
  {
    name: "an async generator yielding RECORDS (Node's objectMode)",
    why: "Node's from() is genuinely objectMode and delivers whole objects; this stream buffer has no object entry, so admitting the type would deliver a struct pointer as a Buffer",
    accept: [{ code: "SC2020", fragment: "async generator yielding" }],
    src: [
      IMPORT,
      "interface Row { readonly id: number }",
      "async function* rows(): AsyncGenerator<Row> {",
      "  yield { id: 1 }",
      "}",
      "export function make(): Readable {",
      "  return Readable.from(rows())",
      "}",
      "console.log(typeof make)",
      "",
    ].join("\n"),
  },
  {
    name: "Readable.from with an options bag",
    why: "the two-argument form carries objectMode/highWaterMark/encoding, and the pump hardcodes Node's from() defaults (objectMode, hwm 1)",
    accept: [{ code: "SC2020", fragment: "Readable.from with 2 arguments" }],
    src: [
      IMPORT,
      "async function* chunks(): AsyncGenerator<Uint8Array> {",
      "  yield new Uint8Array([1])",
      "}",
      "export function make(): Readable {",
      "  return Readable.from(chunks(), { objectMode: false })",
      "}",
      "console.log(typeof make)",
      "",
    ].join("\n"),
  },
  {
    name: "a NESTED async generator as the source",
    why: "the bridge widened Readable.from, not the async-generator lowering: a nested declaration still has no fiber to pull from",
    accept: [{ code: "SC1071", fragment: "async generators (async function*)" }],
    src: [
      IMPORT,
      "export function make(): Readable {",
      "  async function* chunks(): AsyncGenerator<Uint8Array> {",
      "    yield new Uint8Array([1])",
      "  }",
      "  return Readable.from(chunks())",
      "}",
      "console.log(typeof make)",
      "",
    ].join("\n"),
  },
  {
    name: "an AsyncIterable source that is not a generator",
    why: "there is no async-iteration PROTOCOL here, only a generator drive: an AsyncIterable-typed value need not carry an ScrGen handle at all",
    accept: [{ code: "SC2020", fragment: "Readable.from over" }],
    src: [
      IMPORT,
      "declare const src: AsyncIterable<Uint8Array>",
      "export function make(): Readable {",
      "  return Readable.from(src)",
      "}",
      "console.log(typeof make)",
      "",
    ].join("\n"),
  },
];

/** The shapes INSIDE the boundary. If any of these stops compiling, every
 * plant above passes for the wrong reason — the bridge would be gone and
 * the refusals would read as "still correctly fenced". Each drives the
 * stream too: an unreferenced export is never lowered, and a control that
 * is never lowered proves nothing (the async-generator boundary suite
 * learned that one the expensive way). */
const CONTROLS: readonly { name: string; src: string }[] = [
  {
    name: "Uint8Array chunks",
    src: [
      IMPORT,
      "async function* chunks(): AsyncGenerator<Uint8Array> {",
      "  yield new Uint8Array([1, 2])",
      "}",
      "async function main(): Promise<void> {",
      "  for await (const c of Readable.from(chunks())) console.log(String(c))",
      "}",
      "main()",
      "",
    ].join("\n"),
  },
  {
    name: "Buffer chunks",
    src: [
      IMPORT,
      "async function* chunks(): AsyncGenerator<Buffer> {",
      "  yield Buffer.from('hi')",
      "}",
      "async function main(): Promise<void> {",
      "  for await (const c of Readable.from(chunks())) console.log(String(c))",
      "}",
      "main()",
      "",
    ].join("\n"),
  },
  {
    name: "string chunks",
    src: [
      IMPORT,
      "async function* chunks(): AsyncGenerator<string> {",
      "  yield 'a'",
      "}",
      "async function main(): Promise<void> {",
      "  for await (const c of Readable.from(chunks())) console.log(String(c))",
      "}",
      "main()",
      "",
    ].join("\n"),
  },
  {
    name: "an await between yields, piped rather than iterated",
    src: [
      IMPORT,
      "async function tenth(n: number): Promise<number> { return n * 10 }",
      "async function* chunks(): AsyncGenerator<Uint8Array> {",
      "  const v = await tenth(1)",
      "  yield new Uint8Array([v])",
      "}",
      "const s = Readable.from(chunks())",
      "s.on('data', (c: Uint8Array) => { console.log(String(c[0])) })",
      "",
    ].join("\n"),
  },
];

interface Row {
  code: string;
  message: string;
}

async function diagnose(name: string, src: string): Promise<{ ok: boolean; rows: Row[] }> {
  const lab = await mkdtemp(join(tmpdir(), "scriptc-from-edge-"));
  const dir = join(lab, name.replace(/[^a-z0-9]+/gi, "-"));
  await mkdir(dir, { recursive: true });
  const file = join(dir, "plant.ts");
  await writeFile(file, src, "utf8");
  // No backend pin and no bestEffort: every plant must fail in the
  // FRONTEND. A plant that only failed in a backend would still have
  // produced a lowering, and a lowering is exactly what must not exist.
  const res = await compile(file, { outPath: join(dir, "program"), outDir: dir });
  return {
    ok: res.ok,
    rows: res.ok ? [] : res.diagnostics.map((d) => ({ code: d.code ?? "", message: d.message ?? "" })),
  };
}

const brief = (rows: Row[]): string =>
  rows.map((r) => `${r.code}: ${r.message}`).join(" | ").slice(0, 600);

describe("the Readable.from generator boundary", () => {
  test.for(CONTROLS.map((c) => [c.name, c] as const))(
    "the control compiles: %s",
    async ([, c]) => {
      const { ok, rows } = await diagnose(`control-${c.name}`, c.src);
      expect(
        ok,
        `the IN-boundary control "${c.name}" did not compile (${brief(rows)}). Every plant below then passes vacuously.`,
      ).toBe(true);
    },
    600_000,
  );

  test.for(PLANTS.map((p) => [p.name, p] as const))("%s still refuses", async ([, p]) => {
    const { ok, rows } = await diagnose(p.name, p.src);
    expect(
      ok,
      `${p.name} COMPILED. It is outside the Readable.from bridge (${p.why}), so either a fence leaked and this ` +
        `shape now produces code nobody has scored against Node, or the feature grew -- in which case move this ` +
        `plant into tests/corpus with Node as its oracle rather than deleting it.`,
    ).toBe(false);
    const hit = rows.some((r) => p.accept.some((a) => r.code === a.code && r.message.includes(a.fragment)));
    expect(
      hit,
      `${p.name} refused, but with none of the expected emitters. Expected one of ` +
        `${p.accept.map((a) => `${a.code} ~ "${a.fragment}"`).join(" / ")}; got ${brief(rows)}.`,
    ).toBe(true);
  }, 600_000);
});
