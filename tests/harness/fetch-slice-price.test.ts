/* The PRICE of zapo's `SC2011` row, pinned so the next reader gets it
 * from a measurement instead of from a paragraph.
 *
 * The row: `src/transport/wa-version-fetcher.ts:211` declares an options
 * record with a `readonly fetch?: typeof fetch` member, and the record
 * has no static representation. The received account of it -- carried in
 * three consecutive briefs -- was "the blockers are already bisected to
 * exactly three names, `Response`, `RequestInit`, `Request`, so this is
 * three type surfaces, not a language feature". Both halves are wrong,
 * and this file is the bisection that says so.
 *
 *   Response      SC2011   blocks, as recorded
 *   RequestInit   SC2011   blocks, as recorded
 *   Headers       SC2011   blocks, and is NOT in the received list --
 *                          though the compiler's own ISLAND_AMBIENT_TYPES
 *                          does list it
 *   Request       SC0001   `Cannot find name 'Request'` -- it is not a
 *                          type surface awaiting a static representation,
 *                          it is a name this lib set does not resolve at
 *                          all, bare or as `globalThis.Request`
 *   fetch(...)    SC2012   and this is the half that decides the price: a
 *                          fetch CALL in a static build refuses even with
 *                          no record in sight. `fetch` exists in this
 *                          compiler only as an island global behind
 *                          requireDynamicApi, so mapping the three types
 *                          MOVES the refusal to the call site. The
 *                          missing feature is an HTTP/1.1 + TLS client
 *                          with the Response/body/stream surface behind
 *                          it, not three type mappings.
 *
 * The controls matter as much as the blockers: a function type IS a legal
 * record member today, and `AbortSignal` and `URL` in the same position
 * compile. A future change that "fixed" this row by refusing every
 * function-typed member would take those down and this file would say so.
 *
 * Compiled in a BARE temp directory with no tsconfig. Every answer above
 * was cross-checked against the same reductions compiled next to a
 * tsconfig that adopts this repo's @types/node (typeof fetch resolving to
 * SC2011 rather than SC0001 is the discriminator that says the node types
 * were really in play); all five agreed, so the codes below are compiler
 * facts and not lib-set accidents of the temp directory.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

/** One record member, spelled into the same options-record shape zapo's
 * `WaFetchLatestMobileVersionOptions` has. */
function optionsRecord(member: string): string {
  return (
    `interface Opts {\n  readonly timeoutMs?: number\n  ${member}\n}\n` +
    "export function f(o: Opts = {}): number { return o.timeoutMs === undefined ? 0 : 1 }\n" +
    "console.log(f())\n"
  );
}

const BLOCKERS: readonly { name: string; code: string; fragment: string; src: string }[] = [
  {
    name: "Response in the return position",
    code: "SC2011",
    fragment: "have no static representation but run in the embedded dynamic engine",
    src: optionsRecord("readonly hook?: (input: string) => Promise<Response>"),
  },
  {
    name: "RequestInit in an argument position",
    code: "SC2011",
    fragment: "have no static representation but run in the embedded dynamic engine",
    src: optionsRecord("readonly hook?: (input: string, init?: RequestInit) => Promise<string>"),
  },
  {
    // Not named by any brief this row has travelled with, and the one the
    // compiler's own ISLAND_AMBIENT_TYPES does list.
    name: "Headers, which the received bisection omits",
    code: "SC2011",
    fragment: "have no static representation but run in the embedded dynamic engine",
    src: optionsRecord("readonly hook?: (input: string) => Promise<Headers>"),
  },
  {
    // `typeof fetch` is the spelling zapo actually uses; it lands on the
    // same fence as its parts.
    name: "typeof fetch, the spelling zapo uses",
    code: "SC2011",
    fragment: "have no static representation but run in the embedded dynamic engine",
    src: optionsRecord("readonly fetchFn?: typeof fetch"),
  },
  {
    // NOT SC2011. `Request` does not resolve, so it cannot be a type
    // surface awaiting a static representation.
    name: "Request does not resolve at all",
    code: "SC0001",
    fragment: "Cannot find name 'Request'",
    src: optionsRecord("readonly hook?: (input: Request) => Promise<string>"),
  },
  {
    name: "Request does not resolve through globalThis either",
    code: "SC0001",
    fragment: "Namespace 'globalThis' has no exported member 'Request'",
    src: optionsRecord("readonly hook?: (input: globalThis.Request) => Promise<string>"),
  },
  {
    // The half that sets the price: no record, no member, just the call.
    name: "a fetch call refuses on its own",
    code: "SC2012",
    fragment: "'fetch' runs in the embedded dynamic engine, which this build does not include",
    src:
      "async function go(): Promise<void> {\n" +
      "  const r = await fetch('http://example.com')\n  console.log(typeof r)\n}\n" +
      "void go()\n",
  },
];

/** The controls: a function type IS a legal record member, and these two
 * standard types in the same position map today. */
const COMPILES: readonly { name: string; src: string }[] = [
  {
    name: "a function member over URL",
    src: optionsRecord("readonly hook?: (input: URL) => Promise<string>"),
  },
  {
    name: "a function member carrying AbortSignal",
    src: optionsRecord("readonly hook?: (input: string, signal?: AbortSignal) => Promise<string>"),
  },
  {
    name: "a plain function member",
    src: optionsRecord("readonly hook?: (input: string) => number"),
  },
];

let lab = "";
interface Built { ok: boolean; diags: { code: string; message: string }[] }
const BUILT = new Map<string, Built>();

async function build(name: string, src: string): Promise<Built> {
  const dir = join(lab, name.replace(/[^a-z0-9]+/gi, "-"));
  await mkdir(dir, { recursive: true });
  const file = join(dir, "main.ts");
  await writeFile(file, src, "utf8");
  const res = await compile(file, { outPath: join(dir, exeName("program")), outDir: dir, backend: "c" });
  return { ok: res.ok, diags: (res.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message })) };
}

beforeAll(async () => {
  lab = await mkdtemp(join(tmpdir(), "scriptc-fetch-slice-"));
  for (const p of BLOCKERS) BUILT.set(`X:${p.name}`, await build(p.name, p.src));
  for (const p of COMPILES) BUILT.set(`C:${p.name}`, await build(p.name, p.src));
}, 1_800_000);

describe("the fetch slice, priced", () => {
  test.for(BLOCKERS.map((p) => [p.name, p] as const))("blocks: %s", ([, p]) => {
    const b = BUILT.get(`X:${p.name}`)!;
    expect(b.ok, `${p.name} compiled, but this row is supposed to refuse`).toBe(false);
    expect(
      b.diags.some((d) => d.code === p.code && d.message.includes(p.fragment)),
      `${p.name} refuses, but not with ${p.code} / "${p.fragment}". Saw: ` +
        b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
    ).toBe(true);
  });

  test.for(COMPILES.map((p) => [p.name, p] as const))("does not over-fire: %s", ([, p]) => {
    const b = BUILT.get(`C:${p.name}`)!;
    expect(
      b.ok,
      `${p.name} must still compile -- a function type is a legal record member. Diagnostics: ` +
        b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
    ).toBe(true);
  });
});
