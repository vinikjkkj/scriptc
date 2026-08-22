/* The tagged refusals zapo still carries, pinned as SHAPES.
 *
 * WHY THIS FILE EXISTS: `scripts/tu-census.mjs` over zapo's translation
 * unit reports `REFUSAL.tagged 7 statements / 7 ways to die` at SIX source
 * sites, and that population is the whole distance between the compiler's
 * standing objective ("no [SCxxxx] throws left in the emitted C") and where
 * it stands. It has been re-measured by a dozen blocks and enumerated in
 * prose, but NOTHING IN THE REPOSITORY PINNED IT: no test compiled any of
 * those shapes, so a widening that turned one of them into a silently WRONG
 * answer -- the failure mode this project ranks above every other, because a
 * refusal is loud and a wrong answer is not -- would have moved the census
 * down and passed every gate on the way.
 *
 * Each plant below is the smallest program that reaches ONE of those
 * emitters. They are reductions of the real sites, verified against the
 * zapo TU's own message text, so a plant that stops refusing means the
 * corresponding zapo site changed too -- deliberately or not.
 *
 * The contract is deliberately two-sided:
 *   - the refusal is STILL THERE (a plant that quietly compiles is either a
 *     closed refusal, which must be recorded here, or a widening that minted
 *     a wrong answer, which must not ship), and
 *   - it is the refusal we think it is: the CODE and the message's
 *     identifying fragment are both asserted, so "still refuses" cannot be
 *     satisfied by some unrelated new refusal.
 * Both lanes are checked. The LLVM lane keeps its own emitter and this
 * project has shipped a fix green on one lane and wrong on the other.
 *
 * NOT REDUCED HERE, and why (both are real zapo rows; neither has a
 * standalone spelling this suite can build):
 *   - the two `ws` option-bag rows (SC2020, WaWebSocket.ts:68) are planted
 *     by the BACKEND (emit-ws.ts) on the `globalThis.WebSocket` interning
 *     path, not through pushDiag, and need a bag carrying a live
 *     `dispatcher`/`agent`;
 *   - `new WebAssembly.Module(...)` (SC1090, spec/proto/index.js:1) needs a
 *     lib that declares `WebAssembly`; under this repo's lib set the name
 *     does not resolve, and the nearest spellings (`new Intl.NumberFormat`,
 *     `new WeakRef`) reach a DIFFERENT arm (the stdlib-class SC2020), so
 *     planting one of those would assert the wrong emitter.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const repoRoot = join(import.meta.dirname, "../..");
const CENSUS = join(repoRoot, "scripts/tu-census.mjs");

interface CensusJson {
  lane: "c" | "llvm";
  byCat: Partial<Record<string, number>>;
  rows: { cat: string; code: string; msg: string }[];
}

/** One zapo refusal, reduced. Each entry of `accept` is a (code, message
 * fragment) pair that identifies ONE emitter; the plant passes when the
 * census sees any of them. Most plants list exactly one arm. A list longer
 * than one is never a weakened assertion by convenience -- it is written
 * only where the SAME construct is known to reach two different emitters
 * depending on how the checker resolves it, and both arms are named so the
 * plant can still never be satisfied by an unrelated refusal. */
const PLANTS: readonly {
  name: string;
  ext: "ts" | "js" | "cjs";
  zapoSite: string;
  accept: readonly { code: string; fragment: string }[];
  src: string;
}[] = [
  {
    name: "defineprop-on-a-compiled-class",
    ext: "ts",
    zapoSite: "src/client/plugins/install.ts:114 -- Object.defineProperty(client, exposeAs, {get})",
    accept: [{ code: "SC2020", fragment: "'Object.defineProperty' is part of the standard library types" }],
    src: [
      "class Client { readonly x: number = 1 }",
      "declare const exposeAs: string",
      "declare const inst: Map<string, unknown>",
      "const client = new Client()",
      "Object.defineProperty(client, exposeAs, {",
      "  get: () => inst.get(exposeAs),",
      "  enumerable: true,",
      "  configurable: false",
      "})",
      "console.log(client.x)",
      "",
    ].join("\n"),
  },
  {
    name: "readable-from-an-async-generator",
    ext: "ts",
    zapoSite: "src/media/sticker/sticker-pack.ts:140 -- Readable.from(zipChunks(entries))",
    accept: [{ code: "SC2020", fragment: "Readable.from over a 'AsyncGenerator" }],
    src: [
      "import { Readable } from 'node:stream'",
      "async function* zipChunks(): AsyncGenerator<Uint8Array> {",
      "  yield new Uint8Array([1, 2, 3])",
      "}",
      "export function make(): Readable {",
      "  return Readable.from(zipChunks())",
      "}",
      "console.log(typeof make)",
      "",
    ].join("\n"),
  },
  {
    name: "an-options-record-carrying-typeof-fetch",
    ext: "ts",
    zapoSite: "src/transport/wa-version-fetcher.ts:211 -- WaFetchLatestMobileVersionOptions = {}",
    accept: [{ code: "SC2011", fragment: "have no static representation but run in the embedded dynamic engine" }],
    src: [
      "interface ProxyTransport { readonly kind: 'undici' }",
      "interface FetchVersionOptions {",
      "  readonly proxy?: ProxyTransport",
      "  readonly timeoutMs?: number",
      "  readonly signal?: AbortSignal",
      "  readonly userAgent?: string",
      "  readonly headers?: Readonly<Record<string, string>>",
      "  readonly fetch?: typeof fetch",
      "}",
      "interface LatestMobileOptions extends FetchVersionOptions {",
      "  readonly url?: string",
      "  readonly versionPattern?: RegExp",
      "}",
      "export async function fetchLatest(options: LatestMobileOptions = {}): Promise<string> {",
      "  return String(options.url ?? 'x')",
      "}",
      "void fetchLatest()",
      "",
    ].join("\n"),
  },
  {
    name: "require-with-a-computed-specifier",
    ext: "cjs",
    zapoSite: "spec/proto/index.js:1 -- protobufjs inquire()'s require(moduleName)",
    // TWO ARMS, both real and both measured. With the project's
    // @types/node adopted (zapo's build, and any entry compiled next to a
    // tsconfig that pulls the node types in) the reference resolves to the
    // NAMED `Require` surface and the fence is the named-surface SC2020.
    // Compiled bare -- as this suite's temp dir is, with no tsconfig -- the
    // same reference resolves to the STRUCTURAL call/`main`/`resolve` type
    // and the fence is the unmappable-TYPE SC2011 instead. Same site, same
    // construct, same refusal: only the blame differs, so both are named
    // rather than pinning whichever one this host happens to produce.
    accept: [
      { code: "SC2020", fragment: "'Require' is typed by @types/node" },
      { code: "SC2011", fragment: "(id: string): any" },
    ],
    src: [
      "function inquire(moduleName) {",
      "  try {",
      "    var mod = require(moduleName)",
      "    if (mod && (mod.length || Object.keys(mod).length)) return mod",
      "  } catch (e) { /* Node's MODULE_NOT_FOUND -- protobufjs swallows it */ }",
      "  return null",
      "}",
      "console.log('inquire', String(inquire('long')))",
      "",
    ].join("\n"),
  },
];

/** The negative control. A refusal count is only meaningful next to a
 * program the same instrument reads as zero. */
const CLEAN = "function add(a: number, b: number): number { return a + b }\nconsole.log(add(1, 2))\n";

function censusOf(tu: string): CensusJson | null {
  const j = `${tu}.refusal-shapes.json`;
  try {
    execFileSync(process.execPath, [CENSUS, tu, "--quiet", "--json", j], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
  } catch {
    /* a non-zero census still writes its JSON; the assertions below judge it */
  }
  return existsSync(j) ? (JSON.parse(readFileSync(j, "utf8")) as CensusJson) : null;
}

const LANES = ["c", "llvm"] as const;
const CEN = new Map<string, CensusJson | null>();

beforeAll(async () => {
  const lab = await mkdtemp(join(tmpdir(), "scriptc-refusal-shapes-"));
  const all = [
    ...PLANTS.map((p) => ({ name: p.name, ext: p.ext, src: p.src })),
    { name: "clean-control", ext: "ts" as const, src: CLEAN },
  ];
  for (const p of all) {
    for (const backend of LANES) {
      const dir = join(lab, `${p.name}-${backend}`);
      await mkdir(dir, { recursive: true });
      const src = join(dir, `${p.name}.${p.ext}`);
      await writeFile(src, p.src, "utf8");
      const res = await compile(src, {
        outPath: join(dir, "program"),
        outDir: dir,
        backend,
        // the plants are unlowerable in exactly one spot each; without this
        // the refusal is a compile ERROR and there is no TU to census
        bestEffort: true,
      });
      if (!res.ok) {
        throw new Error(
          `${p.name} did not build on the ${backend} lane even best-effort: ` +
            `${res.diagnostics[0]?.code ?? "?"} ${res.diagnostics[0]?.message?.slice(0, 200) ?? "?"}`,
        );
      }
      expect(res.backend, `${p.name}: asked for ${backend}, got ${res.backend}`).toBe(backend);
      CEN.set(`${p.name}:${backend}`, censusOf(res.cPath));
    }
  }
}, 1_800_000);

describe("zapo's tagged refusals, as shapes", () => {
  test("the control program carries no refusal of any kind, on either lane", () => {
    for (const backend of LANES) {
      const d = CEN.get(`clean-control:${backend}`);
      expect(d, `clean-control:${backend}: the census produced no JSON`).not.toBeNull();
      expect(d!.lane, `clean-control:${backend}: wrong lane`).toBe(backend);
      for (const c of ["REFUSAL.tagged", "REFUSAL.untagged", "REFUSAL.uncoded"]) {
        expect(d!.byCat[c] ?? 0, `clean-control:${backend} reports ${c}`).toBe(0);
      }
    }
  });

  test.for(PLANTS.map((p) => [p.name, p] as const))("%s", ([, p]) => {
    for (const backend of LANES) {
      const d = CEN.get(`${p.name}:${backend}`);
      expect(d, `${p.name}:${backend}: the census produced no JSON`).not.toBeNull();
      expect(d!.lane, `${p.name}:${backend}: wrong lane`).toBe(backend);
      const tagged = d!.rows.filter((r) => r.cat === "REFUSAL.tagged");
      // Direction 1: it still refuses. A plant that compiles clean is a
      // CLOSED refusal (update this file and say so) or a widening that
      // replaced a loud failure with a quiet wrong answer.
      expect(
        tagged.length,
        `${p.name}:${backend} no longer carries ANY tagged refusal -- zapo's ${p.zapoSite} ` +
          `either closed (record it here) or now answers WRONG silently`,
      ).toBeGreaterThan(0);
      // Direction 2: it is the refusal we think it is.
      const hit = tagged.filter((r) =>
        p.accept.some((a) => r.code === a.code && r.msg.includes(a.fragment)),
      );
      expect(
        hit.length,
        `${p.name}:${backend} refuses, but with none of the expected emitters ` +
          `[${p.accept.map((a) => `${a.code} / "${a.fragment}"`).join(", ")}]. ` +
          `Saw: ${tagged.map((r) => `${r.code} ${r.msg.slice(0, 90)}`).join(" | ")}`,
      ).toBeGreaterThan(0);
    }
  });
});
