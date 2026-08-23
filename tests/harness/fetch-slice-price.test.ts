/* The PRICE of zapo's `SC2011` row, re-measured after the static fetch
 * landed — and pinned two-sided, so neither half can move silently.
 *
 * THE ROW: `src/transport/wa-version-fetcher.ts:211` names
 * `WaFetchLatestMobileVersionOptions` as a parameter type; the record it
 * reaches (`WaFetchVersionOptions`, declared at :47) carries a
 * `readonly fetch?: typeof fetch` member, and the whole declaration
 * refuses.
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT WAS WRONG. The received account
 * was "the blockers are three names, `Response`, `RequestInit`,
 * `Request` — three type surfaces, not a language feature". This file's
 * previous revision corrected that to "the type half is not the price: a
 * bare `fetch()` CALL answers SC2012 on its own, so mapping the types
 * would only MOVE the refusal to the call site", and recorded that
 * `Request` "does not resolve at all". Both corrections were measured in a
 * BARE temp directory, and both are lane artifacts:
 *
 *   - `Request` DOES resolve in the lane zapo compiles in. With this
 *     repo's `@types/node` adopted it is undici-types' class and the
 *     refusal is `SC2009` naming the member's type; only with no
 *     `@types/node` in sight does it answer `SC0001`. Pinned below in
 *     both spellings rather than in whichever one this host produces.
 *   - the call and the types were never separable, and the previous
 *     revision was right about that for the wrong reason. They landed
 *     TOGETHER (scr_fetch_static.c and lower-fetch.ts): a static `fetch`
 *     with a static `Response` and `Headers` behind it.
 *
 * WHAT IS CLOSED NOW, and it is most of the priced work: a `fetch()` call
 * compiles and runs in a static build, over the same HTTP/1.1 + TLS client
 * the island fetch already drove, and `Response` and `Headers` have static
 * representations. `tests/harness/fetch-static.test.ts` proves the
 * BEHAVIOUR against Node v25.9.0 on both backends across 64 compared
 * cells; this file only proves the FENCES moved and stayed moved.
 *
 * WHAT STILL BLOCKS THE ROW — two things, each named at its line, and
 * neither of them an HTTP client:
 *
 *   1. `RequestInit` has no static representation (SC2011). It is the one
 *      remaining member type inside `typeof fetch`, and it is what this
 *      row's SC2011 now comes from.
 *   2. `Request` likewise (SC2009 / SC0001 by lane) — it rides in
 *      `typeof fetch`'s INPUT union under `@types/node`, which is why it
 *      is part of the row even though zapo never constructs one.
 *
 * The third used to be `fetch` AS A VALUE, and it CLOSED: a builtin now
 * has a first-class closure form (lower-fnvalue.ts), so that row has
 * changed sides and must keep compiling. It does not close zapo's own
 * line, because `options.fetch ?? fetch` needs the FIELD to be typed
 * `typeof fetch` and that type still refuses through blocker 1.
 *
 * (And a fourth, outside the fetch family entirely: the same function
 * writes `(init as { dispatcher?: unknown }).dispatcher = dispatcher`,
 * which is SC1090 "assignment to non-variables" — an assignment-target
 * feature that has nothing to do with fetch. MEASURED on a reduction of
 * that function with the record and the func type made mappable: it is
 * the ONLY refusal left in the body, so the price of the row is
 * blockers 1 and 2 plus this one, not three more.)
 *
 * Every answer below was cross-checked against the same reductions
 * compiled next to a tsconfig adopting this repo's `@types/node`; where
 * the two lanes differ, BOTH codes are accepted and the difference is the
 * point being recorded.
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

interface Row {
  name: string;
  /** Accepted codes: more than one where the lib set decides which. */
  codes: readonly string[];
  fragments: readonly string[];
  src: string;
}

const BLOCKERS: readonly Row[] = [
  {
    name: "RequestInit in an argument position — the row's remaining type blocker",
    codes: ["SC2011"],
    fragments: ["have no static representation but run in the embedded dynamic engine"],
    src: optionsRecord("readonly hook?: (input: string, init?: RequestInit) => Promise<string>"),
  },
  {
    // The spelling zapo actually uses. It refuses through RequestInit
    // now, not through Response.
    name: "typeof fetch, the spelling zapo uses",
    codes: ["SC2011"],
    fragments: ["have no static representation but run in the embedded dynamic engine"],
    src: optionsRecord("readonly fetchFn?: typeof fetch"),
  },
  {
    // TWO LANES, both real. Bare: the name does not resolve at all.
    // Next to @types/node — zapo's lane — it resolves to undici-types'
    // class and the refusal names the member's type instead.
    name: "Request, in whichever way this lane refuses it",
    codes: ["SC0001", "SC2009"],
    fragments: ["Cannot find name 'Request'", "which does not compile"],
    src: optionsRecord("readonly hook?: (input: Request) => Promise<string>"),
  },
];

/** Rows that HAVE closed. A closed fence does not just leave this file —
 * it changes sides, and now has to keep COMPILING. That is what stops the
 * next change from quietly putting the refusal back, and it is the only
 * reading that keeps a price file honest as the price falls. */
const CLOSED: readonly { name: string; src: string; provedBy: string }[] = [
  {
    name: "a fetch call compiles on its own",
    provedBy: "tests/harness/fetch-static.test.ts (64 cells against Node, both backends)",
    src:
      "async function go(): Promise<void> {\n" +
      "  const r = await fetch('http://127.0.0.1:1/')\n  console.log(r.status)\n}\n" +
      "void go().catch(() => { console.log('rejected') })\n",
  },
  {
    name: "Response in the return position",
    provedBy: "tests/corpus/5980, 5981, 5982",
    src: optionsRecord("readonly hook?: (input: string) => Promise<Response>"),
  },
  {
    name: "Headers in the return position",
    provedBy: "tests/corpus/5981",
    src: optionsRecord("readonly hook?: (input: string) => Promise<Headers>"),
  },
  {
    name: "a Response value read for status and ok",
    provedBy: "tests/corpus/5980",
    src:
      "async function go(): Promise<void> {\n" +
      "  const r = await fetch('http://127.0.0.1:1/')\n" +
      "  console.log(r.ok, r.status, r.statusText, r.redirected, r.url)\n" +
      "  console.log(r.headers.get('content-type'))\n" +
      "  console.log((await r.text()).length)\n}\n" +
      "void go().catch(() => { console.log('rejected') })\n",
  },
  {
    // The third blocker, and the one no type mapping could reach: a
    // builtin had no closure form here. It has one now -- an interned
    // zero-capture closure over a synthesized module function, the
    // shape String/Number/Boolean already used -- so this row changed
    // sides and now has to keep COMPILING.
    //
    // It does NOT close zapo's own line. `options.fetch ?? fetch`
    // needs the FIELD to be typed `typeof fetch`, and that type still
    // refuses through RequestInit -- the BLOCKED row above.
    name: "fetch as a VALUE",
    provedBy:
      "tests/harness/builtin-fn-value.test.ts (38 fetch cells against Node, both backends) " +
      "and tests/corpus/6020, 6021",
    src:
      "const g = fetch\nasync function go(): Promise<void> {\n" +
      "  const r = await g('http://example.com')\n  console.log(r.status)\n}\nvoid go()\n",
  },
];

/** The controls: a function type IS a legal record member, and these two
 * standard types in the same position map today. A future change that
 * "fixed" a row by refusing every function-typed member would take these
 * down and this file would say so. */
const COMPILES: readonly { name: string; src: string }[] = [
  { name: "a function member over URL", src: optionsRecord("readonly hook?: (input: URL) => Promise<string>") },
  {
    name: "a function member carrying AbortSignal",
    src: optionsRecord("readonly hook?: (input: string, signal?: AbortSignal) => Promise<string>"),
  },
  { name: "a plain function member", src: optionsRecord("readonly hook?: (input: string) => number") },
];

let lab = "";
interface Built {
  ok: boolean;
  diags: { code: string; message: string }[];
}
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
  for (const p of CLOSED) BUILT.set(`O:${p.name}`, await build(p.name, p.src));
  for (const p of COMPILES) BUILT.set(`C:${p.name}`, await build(p.name, p.src));
}, 1_800_000);

describe("the fetch slice, priced", () => {
  test.for(BLOCKERS.map((p) => [p.name, p] as const))("still blocks: %s", ([, p]) => {
    const b = BUILT.get(`X:${p.name}`)!;
    expect(b.ok, `${p.name} compiled, but this row is supposed to refuse`).toBe(false);
    const seen = b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | ");
    expect(
      b.diags.some((d, i) => p.codes.includes(d.code) && p.fragments.some((f) => d.message.includes(f)) && i >= 0),
      `${p.name} refuses, but not with one of ${p.codes.join("/")} carrying one of the recorded ` +
        `fragments. Saw: ${seen}`,
    ).toBe(true);
  });

  test.for(CLOSED.map((p) => [p.name, p] as const))("CLOSED, and must stay closed: %s", ([, p]) => {
    const b = BUILT.get(`O:${p.name}`)!;
    expect(
      b.ok,
      `${p.name} refuses again. This row was closed by the static fetch and is proved by ` +
        `${p.provedBy}; a refusal here is a regression, not a re-measurement. Diagnostics: ` +
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
