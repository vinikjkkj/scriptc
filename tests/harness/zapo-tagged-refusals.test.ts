/* The tagged refusals zapo still carries, pinned as SHAPES.
 *
 * WHY THIS FILE EXISTS: `scripts/tu-census.mjs` over zapo's translation
 * unit reported `REFUSAL.tagged 7 statements / 7 ways to die` at SIX source
 * sites, and that population is the whole distance between the compiler's
 * standing objective ("no [SCxxxx] throws left in the emitted C") and where
 * it stands. TWO of the six have since closed (`Readable.from` over an
 * async generator, and `Object.defineProperty` with a run-time string key
 * on a compiled class instance) and moved to the CLOSED list below, which
 * asserts the opposite direction with the same instrument. It has been re-measured by a dozen blocks and enumerated in
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
 * THE `ws` OPTION-BAG ROWS ARE REDUCED HERE NOW -- and both of them have
 * since CLOSED, so the reduction is on the other side of the file. The note
 * that said they could not be reduced at all is what this file was wrong
 * about. It read: "planted by the
 * BACKEND (emit-ws.ts) on the `globalThis.WebSocket` interning path, not
 * through pushDiag, and need a bag carrying a live `dispatcher`/`agent`" --
 * every clause of which is true, and the conclusion false. The fence is
 * emitted from the ctor wrapper whenever the bag's SHAPE carries the field;
 * a live value is what makes it FIRE at runtime, not what makes it appear in
 * the C. So the plant is fifty lines of the program's own declaration of the
 * API, and the census reads back the same code, the same message and the
 * same emitted host (`sc_wsw_N`) as zapo's own translation unit does.
 *
 * That reduction is also why those rows went from two to one, and then to
 * none. With a shape to compile, `agent` could be measured instead of
 * reasoned about: Node's global WebSocket never reads that member of the bag
 * at all, so the refusal was a refusal where the oracle CONNECTS.
 *
 * `dispatcher` did not fall to a measurement -- the oracle really does hand
 * the whole upgrade away -- but to the observation that the socket a
 * dispatcher answers with, in a COMPILED program, can only ever be a
 * runtime handle. scr_ws_dispatch.c calls the program's `dispatch` and
 * adopts what comes back. The plant is unchanged and now has to carry ZERO
 * refusals, which is the same two-sided contract read the other way round.
 *
 * NOT REDUCED HERE, and why:
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
  bytes: number;
  statements: number;
  byCat: Partial<Record<string, number>>;
  rows: { cat: string; code: string; msg: string }[];
  /** Why the census exited non-zero, verbatim from the script. Read rather
   * than the exit code alone because exit 3 covers two opposite facts --
   * see CLOSED_ZERO_POPULATION below. */
  problems: string[];
}

/** The ONE census problem a CLOSED row may legitimately carry.
 *
 * The census refuses to call a TU with zero failure statements a pass: an
 * empty or wrong input file reads exactly like a perfect one, so it exits 3
 * rather than report a clean count it cannot vouch for. That guard is right,
 * and for a plant whose refusal has CLOSED it is also the strongest possible
 * outcome -- there is nothing left in the TU to count, which is a stricter
 * result than "zero of the tagged kind among many". The `clean-control` test
 * above asserts exactly this exit for exactly this reason.
 *
 * So a CLOSED row accepts exit 0, or exit 3 whose ONLY problem is this one.
 * Every other problem is the instrument saying it does not trust its reading
 * and still fails the row. */
const CLOSED_ZERO_POPULATION = "ZERO-POPULATION:";

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
  /** Fragments that must appear in NO tagged refusal of this plant. Where a
   * site once carried two refusals and one has since been withdrawn, the
   * survivor keeps the plant honest in the "still refuses" direction and
   * this keeps it honest in the other: without it, putting the withdrawn
   * refusal back would leave every assertion above green. */
  forbid?: readonly string[];
  src: string;
}[] = [
  {
    name: "the-undici-dispatcher-written-onto-a-fetch-init",
    ext: "ts",
    zapoSite:
      "src/transport/wa-version-fetcher.ts:133 -- " +
      "(init as { dispatcher?: unknown }).dispatcher = dispatcher",
    accept: [{ code: "SC2020", fragment: "'RequestInit.dispatcher'" }],
    // THE ROW THAT REPLACED THE RECORD, one statement instead of a whole
    // declaration -- and it is a different KIND of refusal, which is why
    // it is planted rather than described. The record's blocker was a
    // missing type; this is a missing CAPABILITY, measured against the
    // oracle rather than assumed: Node v25.9.0's `fetch(url, {
    // dispatcher })` really does call a plain object's
    // `dispatch(opts, handler)` and wait for the handler's callbacks. So
    // there is nothing here to drop quietly, and dropping it would be a
    // proxy silently ignored.
    //
    // It used to answer SC1090 "assignment to non-variables", which named
    // neither the value nor the reason, and which is why the row was
    // filed under the assignment-target family for three blocks running.
    // The fragment below is the whole correction: the refusal names the
    // member.
    src: [
      "declare const dispatcher: { dispatch: (a: unknown, b: unknown) => unknown } | undefined",
      "export async function go(url: string): Promise<number> {",
      "  const init: RequestInit = { method: 'GET' }",
      "  if (dispatcher) {",
      "    ;(init as { dispatcher?: unknown }).dispatcher = dispatcher",
      "  }",
      "  return (await fetch(url, init)).status",
      "}",
      "void go('http://127.0.0.1:1/x').catch(() => console.log('caught'))",
      "",
    ].join("\n"),
  },
  {
    name: "require-with-a-computed-specifier",
    ext: "cjs",
    zapoSite: "spec/proto/index.js:1 -- protobufjs inquire()'s require(moduleName)",
    // ONE ARM now, and the change is the point. This used to reach the
    // callee-as-a-VALUE fence, which named whatever the checker had made
    // of the `require` binding: with @types/node adopted the named
    // `Require` surface (SC2020), compiled bare the structural
    // call/`main`/`resolve` type (SC2011). Both spellings of "we cannot
    // lower the require FUNCTION".
    //
    // The require is lowered now (require-node-parity.test.ts), and what
    // is left is a narrower and much later refusal: the specifier is a
    // RUN-TIME string, so the verdict runs, and for a specifier the build
    // could not rule out the answer would have to be the module's exports
    // AS A VALUE — which is the SC1090 module-namespace wall. That is the
    // refusal this plant now carries, at the same site, with the same
    // code. What the plant no longer proves is reachability: the
    // specifier 'long' resolves to nothing, so the RUN takes Node's
    // MODULE_NOT_FOUND path and the fence is emitted-but-not-taken.
    accept: [
      { code: "SC2020", fragment: "'require() with a run-time specifier'" },
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

/** Rows that HAVE closed. A closed refusal does not just leave this file —
 * it changes sides. The plant stays, compiled by the same instrument on
 * both lanes, and now has to carry ZERO tagged refusals: that is what
 * distinguishes "the bridge landed" from "the refusal moved somewhere else
 * in the same program", and it is the only reading that keeps the file's
 * two-sided contract intact as the population shrinks.
 *
 * It does NOT assert the answer is right — the census reads emitted C, not
 * behaviour. Correctness is the corpus's job, and each row names the
 * programs that carry it. */
const CLOSED: readonly {
  name: string;
  ext: "ts" | "js" | "cjs";
  zapoSite: string;
  provedBy: string;
  src: string;
}[] = [
  {
    name: "an-options-record-carrying-typeof-fetch",
    ext: "ts",
    zapoSite: "src/transport/wa-version-fetcher.ts:47 -- WaFetchVersionOptions.fetch?: typeof fetch",
    provedBy:
      "tests/harness/request-init.test.ts (25 cells against Node on both backends, including an " +
      "INJECTED fetch through exactly this option), tests/harness/builtin-fn-value.test.ts (the " +
      "`typeof fetch` record differential and the 38 fetch-as-a-value cells)",
    // The SAME record that carried the refusal, now carrying none -- and
    // with the BODY that was hidden behind it. The declaration used to
    // poison before a single statement of the function was lowered, so
    // "zero tagged refusals" here is a claim about the body as well as
    // about the record, which is exactly what the old plant could not say.
    //
    // What is NOT in this plant, deliberately: zapo's
    // `(init as { dispatcher?: unknown }).dispatcher = d`. That still
    // refuses, at its own line, and it is a PLANT of its own above --
    // folding it in here would let this row pass while the site it stands
    // for still carried a refusal.
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
      "async function sourceText(url: string, options: FetchVersionOptions): Promise<string> {",
      "  const fetchImpl = options.fetch ?? fetch",
      "  const headers: Record<string, string> = { 'user-agent': options.userAgent ?? 'ua' }",
      "  if (options.headers) {",
      "    for (const key in options.headers) { headers[key.toLowerCase()] = options.headers[key]! }",
      "  }",
      "  const init: RequestInit = { method: 'GET', headers }",
      "  const response = await fetchImpl(url, init)",
      "  if (!response.ok) { throw new Error('http ' + String(response.status)) }",
      "  return await response.text()",
      "}",
      "export async function fetchLatest(options: LatestMobileOptions = {}): Promise<string> {",
      "  return await sourceText(options.url ?? 'http://127.0.0.1:1/x', options)",
      "}",
      "void fetchLatest().catch(() => console.log('caught'))",
      "",
    ].join("\n"),
  },
  {
    name: "the-ws-option-bag-with-a-proxy-dispatcher",
    ext: "ts",
    zapoSite:
      "src/transport/WaWebSocket.ts:68 -- the globalThis.WebSocket read that interns the ctor " +
      "wrapper for the init bag built at :559 and constructed at :565",
    provedBy:
      "tests/corpus/6060 (a real proxy dispatcher carrying an upgrade end to end), 6061 (the " +
      "three ways one fails to deliver) and 6062 (the other call arm and a mandatory slot) -- " +
      "Node is the oracle on both lanes -- and tests/harness/ws-dispatcher.test.ts, which " +
      "measures what the ORACLE hands a dispatcher and demands back, because every key, order " +
      "and arity scr_ws_dispatch.c builds is a claim about undici that no differential can check",
    // The SAME fifty lines that carried the refusal, now carrying none.
    // What the census must see here is ZERO: the delegation replaced the
    // fence rather than moving it, and the `forbid` this entry used to
    // need on the withdrawn `agent` half is now the whole assertion.
    src: [
      "interface WaProxyDispatcher { dispatch(...args: readonly unknown[]): unknown }",
      "interface WaProxyAgent { readonly addRequest: (a: unknown, b: unknown) => void }",
      "interface RawWsEvent {",
      "  readonly code?: number",
      "  readonly reason?: string",
      "  readonly wasClean?: boolean",
      "  readonly data?: unknown",
      "}",
      "interface RawWebSocket {",
      "  binaryType: string",
      "  readyState: number",
      "  onopen: ((ev: RawWsEvent) => void) | undefined",
      "  onmessage: ((ev: RawWsEvent) => void) | undefined",
      "  onclose: ((ev: RawWsEvent) => void) | undefined",
      "  onerror: ((ev: RawWsEvent) => void) | undefined",
      "  send: (data: string) => void",
      "  close: (code?: number, reason?: string) => void",
      "}",
      "interface WaRawWebSocketInit {",
      "  readonly protocols?: string | readonly string[]",
      "  readonly headers?: Readonly<Record<string, string>>",
      "  readonly dispatcher?: WaProxyDispatcher",
      "  readonly agent?: WaProxyAgent",
      "}",
      "type RawWebSocketConstructor = new (",
      "  url: string,",
      "  protocols?: string | readonly string[] | WaRawWebSocketInit,",
      ") => RawWebSocket",
      "declare const wsUrl: string",
      "declare const wsHeaders: Readonly<Record<string, string>> | undefined",
      "declare const wsDispatcher: WaProxyDispatcher | undefined",
      "declare const wsAgent: WaProxyAgent | undefined",
      "function resolveWebSocketConstructor(): RawWebSocketConstructor {",
      "  const ctor = (globalThis as typeof globalThis & { WebSocket?: RawWebSocketConstructor })",
      "    .WebSocket",
      "  if (!ctor) { throw new Error('global WebSocket is not available in this runtime') }",
      "  return ctor",
      "}",
      "export function dial(): RawWebSocket {",
      "  const ctor = resolveWebSocketConstructor()",
      "  const init: WaRawWebSocketInit = {",
      "    protocols: ['a'],",
      "    headers: wsHeaders,",
      "    dispatcher: wsDispatcher,",
      "    agent: wsAgent,",
      "  }",
      "  return new ctor(wsUrl, init)",
      "}",
      "console.log(typeof dial)",
      "",
    ].join("\n"),
  },
  {
    name: "defineprop-on-a-compiled-class",
    ext: "ts",
    zapoSite: "src/client/plugins/install.ts:114 -- Object.defineProperty(client, exposeAs, {get})",
    provedBy:
      "tests/corpus/5990-5995 (the answer, the attributes, the key order, the descriptor shapes, " +
      "the loud refusal and the receivers - Node is the oracle on both lanes) and " +
      "tests/harness/class-runtime-property-table.test.ts (the shapes that must stay LOUD, which " +
      "no differential can assert because Node answers where this refuses)",
    // Reduced from zapo's own lines, INCLUDING the `Map<string, unknown>`
    // the getter reads: `instances.get(exposeAs)` is where the second
    // wall was, and a plant that used a `Map<string, string>` instead
    // would carry zero refusals while zapo still carried one.
    src: [
      "class Client { readonly x: number = 1 }",
      "const inst = new Map<string, unknown>()",
      "const exposeAs = process.argv.length > 99 ? 'zz' : 'plug'",
      "const client = new Client()",
      "if (!(exposeAs in client)) {",
      "  Object.defineProperty(client, exposeAs, {",
      "    get: () => inst.get(exposeAs),",
      "    enumerable: true,",
      "    configurable: false",
      "  })",
      "}",
      "console.log(client.x, exposeAs in client)",
      "",
    ].join("\n"),
  },
  {
    name: "readable-from-an-async-generator",
    ext: "ts",
    zapoSite: "src/media/sticker/sticker-pack.ts:140 -- Readable.from(zipChunks(entries))",
    provedBy: "tests/corpus/5940, 5941 and 5942 (order, back-pressure, close, errors — Node is the oracle)",
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
];

/** The negative control. A refusal count is only meaningful next to a
 * program the same instrument reads as zero. */
const CLEAN = "function add(a: number, b: number): number { return a + b }\nconsole.log(add(1, 2))\n";

interface CensusRun {
  json: CensusJson | null;
  /** The census's OWN exit code. It is not decoration: the script closes on
   * an accounting invariant -- every "[SCxxxx at ...]" tag in the
   * translation unit must belong to exactly one coded throw -- and exits
   * non-zero when that fails. A fence emitted through a strLit ARGUMENT is
   * interned as a static ScrStr as well as inlined into the call, so its tag
   * lands in the TU twice; the count of refusals is still right, and the
   * instrument that has to notice is this one. Measured, not predicted: it
   * is exactly what happened while this file was being extended. */
  exit: number;
}

function censusOf(tu: string): CensusRun {
  const j = `${tu}.refusal-shapes.json`;
  let exit = 0;
  try {
    execFileSync(process.execPath, [CENSUS, tu, "--quiet", "--json", j], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
  } catch (e) {
    /* a non-zero census still writes its JSON; the assertions below judge it */
    exit = (e as { status?: number }).status ?? -1;
  }
  return {
    json: existsSync(j) ? (JSON.parse(readFileSync(j, "utf8")) as CensusJson) : null,
    exit,
  };
}

const LANES = ["c", "llvm"] as const;
const CEN = new Map<string, CensusRun>();

beforeAll(async () => {
  const lab = await mkdtemp(join(tmpdir(), "scriptc-refusal-shapes-"));
  const all = [
    ...PLANTS.map((p) => ({ name: p.name, ext: p.ext, src: p.src })),
    ...CLOSED.map((p) => ({ name: p.name, ext: p.ext, src: p.src })),
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
      const run = CEN.get(`clean-control:${backend}`)!;
      // NOT exit 0, and that is the census being careful rather than
      // broken: a TU with ZERO failure statements "reads exactly like an
      // empty or wrong input file", so the script refuses to call it a
      // pass. Exit 3 is that guard, and asserting it here keeps the
      // control honest -- the control's whole job is to be the program
      // with nothing in it. The PLANTS below do assert exit 0.
      expect(run.exit, `clean-control:${backend}: the census answered ${run.exit}, not its zero-population guard`).toBe(3);
      const d = run.json;
      expect(d, `clean-control:${backend}: the census produced no JSON`).not.toBeNull();
      // Exit 3 alone would also be satisfied by a BROKEN accounting
      // invariant, which is the opposite fact. Name the reason.
      expect(
        d!.problems,
        `clean-control:${backend}: exit 3 for something other than the zero-population guard`,
      ).toEqual([expect.stringContaining(CLOSED_ZERO_POPULATION)]);
      expect(d, `clean-control:${backend}: the census produced no JSON`).not.toBeNull();
      expect(d!.lane, `clean-control:${backend}: wrong lane`).toBe(backend);
      for (const c of ["REFUSAL.tagged", "REFUSAL.untagged", "REFUSAL.uncoded"]) {
        expect(d!.byCat[c] ?? 0, `clean-control:${backend} reports ${c}`).toBe(0);
      }
    }
  });

  test.for(CLOSED.map((p) => [p.name, p] as const))("%s (CLOSED)", ([, p]) => {
    for (const backend of LANES) {
      const run = CEN.get(`${p.name}:${backend}`)!;
      const d = run.json;
      expect(d, `${p.name}:${backend}: the census produced no JSON`).not.toBeNull();
      if (run.exit !== 0) {
        // See CLOSED_ZERO_POPULATION. Anything else, and the count below is
        // read off an instrument that has said it does not trust itself.
        expect(
          d!.problems,
          `${p.name}:${backend}: the census itself failed (exit ${run.exit}) for a reason a CLOSED row ` +
            `does not get to ignore`,
        ).toEqual([expect.stringContaining(CLOSED_ZERO_POPULATION)]);
        // …and the guard exists because an empty or wrong FILE reads the
        // same way, so say which of the two this is rather than assuming.
        expect(d!.statements, `${p.name}:${backend}: ZERO-POPULATION with a non-zero statement count`).toBe(0);
        expect(
          d!.bytes,
          `${p.name}:${backend}: the census read an EMPTY translation unit — that is the case the ` +
            `zero-population guard is really for, and it is not a closed refusal`,
        ).toBeGreaterThan(1024);
      }
      expect(d!.lane, `${p.name}:${backend}: wrong lane`).toBe(backend);
      const tagged = d!.rows.filter((r) => r.cat === "REFUSAL.tagged");
      expect(
        tagged.map((r) => `${r.code} ${r.msg.slice(0, 90)}`),
        `${p.name}:${backend} refuses again -- zapo's ${p.zapoSite} closed and must stay closed. ` +
          `Behaviour is pinned by ${p.provedBy}`,
      ).toEqual([]);
    }
  });

  test.for(PLANTS.map((p) => [p.name, p] as const))("%s", ([, p]) => {
    for (const backend of LANES) {
      const run = CEN.get(`${p.name}:${backend}`)!;
      expect(run.exit, `${p.name}:${backend}: the census itself failed (exit ${run.exit})`).toBe(0);
      const d = run.json;
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
      // Direction 3, for a site where one refusal has been WITHDRAWN: it
      // must not have come back. Direction 1 only counts refusals and
      // direction 2 only matches the survivor, so between them a
      // resurrected sibling passes unnoticed.
      for (const gone of p.forbid ?? []) {
        expect(
          tagged.filter((r) => r.msg.includes(gone)).map((r) => `${r.code} ${r.msg.slice(0, 90)}`),
          `${p.name}:${backend} refuses again on "${gone}" -- that refusal was withdrawn ` +
            `because the oracle does not refuse there, so this is now a program Node runs ` +
            `and scriptc does not`,
        ).toEqual([]);
      }
    }
  });
});
