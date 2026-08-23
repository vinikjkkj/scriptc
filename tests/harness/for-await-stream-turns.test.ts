/* The TURN COUNT of a `for await` over a stream, pinned as numbers on both
 * lanes.
 *
 * `Readable.prototype[Symbol.asyncIterator]` is an `async function*`, so a
 * chunk costs the loop the wrapper's `yield` on top of the read. The
 * runtime used to fulfil the parked next() promise the instant the stream
 * could answer, which delivered every chunk early — one microtask turn per
 * chunk off the buffer, a whole phase off `Readable.from(asyncGenerator)`.
 *
 * tests/corpus/5960..5963 score that against Node byte-for-byte, which is
 * the real oracle. What this file adds is a FAILURE THAT NAMES THE NUMBER.
 * An ordering regression reached through the corpus reads as "some
 * interleaving moved"; reached through here it reads as "the buffered chunk
 * costs 1 turn, expected 2" — and it says so per backend, because the C and
 * the LLVM lane emit their own call to scr_stream_next_chunk and a fix that
 * only landed on one of them has shipped in this repository before.
 *
 * The counts are Node v25.9.0's, measured with a microtask ruler rather
 * than read off the spec, and the same program runs under Node here so the
 * pin cannot drift away from the oracle while still agreeing with itself.
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

/* A ruler that counts microtask turns, and one loop per state the
 * iterator's read() can be in. Each line names the turn its chunk landed
 * on, so the assertion below is a count and not an interleaving. */
const PROGRAM = [
  `import { Readable } from "node:stream"`,
  ``,
  `let n = 0`,
  `let era = 0`,
  `function tick(k: number): void {`,
  `  if (k === era && n < 12) {`,
  `    n += 1`,
  `    void Promise.resolve().then(() => { tick(k) })`,
  `  }`,
  `}`,
  `function ruler(): void {`,
  `  era += 1`,
  `  n = 0`,
  `  const k = era`,
  `  void Promise.resolve().then(() => { tick(k) })`,
  `}`,
  ``,
  `async function* three(): AsyncGenerator<string> { yield "a"; yield "b"; yield "c" }`,
  ``,
  `async function main(): Promise<void> {`,
  `  ruler()`,
  `  for await (const c of three()) console.log("gen " + c + " @" + String(n))`,
  `  ruler()`,
  `  for await (const c of Readable.from(["a", "b", "c"])) {`,
  `    console.log("inline " + String(c) + " @" + String(n))`,
  `  }`,
  `  const r = new Readable({ read() {} })`,
  `  setTimeout(() => { ruler(); r.push("p"); r.push(null) }, 5)`,
  `  for await (const c of r) console.log("parked " + String(c) + " @" + String(n))`,
  `}`,
  `void main()`,
  ``,
].join("\n");

/* Node v25.9.0. The generator is the control: two turns per chunk is the
 * cost the stream's wrapper has to match, because the wrapper IS one. */
const EXPECTED = [
  "gen a @2",
  "gen b @4",
  "gen c @6",
  "inline a @2",
  "inline b @4",
  "inline c @6",
  "parked p @3",
  "",
].join("\n");

async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8", timeout: 60_000 });
  return stdout.replace(/\r\n/g, "\n");
}

describe("for-await over a stream: the iterator's turn count", () => {
  const key = createHash("sha256")
    .update(PROGRAM)
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const dir = join(cacheDir, `for-await-turns-${key}`);
  mkdirSync(dir, { recursive: true });
  const src = join(dir, "turns.ts");
  writeFileSync(src, PROGRAM);

  test("node is the oracle and agrees with the pinned counts", async () => {
    expect(await run("node", [src])).toBe(EXPECTED);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend} backend`, async () => {
      const outDir = join(dir, backend);
      mkdirSync(outDir, { recursive: true });
      const result = await compile(src, {
        outPath: join(outDir, exeName("turns")),
        outDir,
        sanitize,
        backend,
      });
      if (!result.ok) {
        throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      }
      expect(await run(result.binaryPath, [])).toBe(EXPECTED);
    });
  }
});
