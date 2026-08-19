/* The two `ws` init-bag refusals must carry `[SCxxxx at file:line]`.
 *
 * They are the only refusals a scriptc BACKEND raises on its own: the ctor
 * wrapper is interned per construct-SIGNATURE type and reached through a
 * closure value, so there is no diagnostic and no source location at the
 * site that throws. For as long as that meant "no bracket", they were
 * invisible to every bracket-keyed instrument this project owns — a grep, a
 * trap census, a reader — and in zapo's own translation unit they were BOTH
 * of the untagged rows the census reported (`agent` and `dispatcher`).
 * Only scripts/tu-census.mjs, which classifies by emitted HOST rather than
 * by bracket, could see them at all.
 *
 * The lowering now donates the site of the `globalThis.WebSocket` READ that
 * interned the wrapper. That is not the `new` that will refuse — one
 * wrapper serves every construct — but it is the one real source location
 * on the path, and it is in the function that builds the bag.
 *
 * Both backends must agree byte for byte: they build these messages from
 * duplicated literals, so a tag added to one lane and not the other is
 * exactly the drift this file exists to catch.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/** The bag zapo dials with: two lowered fields and the two proxy fields
 * that have no lowering. Both are written and undefined, which is what
 * makes the wrapper carry a runtime `if (present) throw` for each. */
const PROGRAM = `
interface WSEventLike { readonly code?: number; readonly reason?: string; readonly wasClean?: boolean; readonly data?: unknown }
interface RawWS {
  binaryType: string
  readyState: number
  onopen: ((e: WSEventLike) => void) | null
  onclose: ((e: WSEventLike) => void) | null
  onerror: ((e: WSEventLike) => void) | null
  onmessage: ((e: WSEventLike) => void) | null
  close(code?: number, reason?: string): void
  send(data: string | ArrayBuffer | Uint8Array): void
}
interface RawWSInit {
  readonly protocols?: string | readonly string[]
  readonly headers?: Readonly<Record<string, string>>
  readonly dispatcher?: object
  readonly agent?: object
}
type RawWSCtor = new (url: string, protocols?: string | readonly string[] | RawWSInit) => RawWS
function globalWs(): RawWSCtor {
  const c = (globalThis as typeof globalThis & { WebSocket?: RawWSCtor }).WebSocket
  if (!c) { throw new Error("no global WebSocket") }
  return c
}
const WS = globalWs()
const w = new WS("ws://127.0.0.1:1/", { headers: { "X-P": "1" }, dispatcher: undefined, agent: undefined })
w.onclose = (e) => { console.log("close", e.code) }
`;

/** The line `globalThis.WebSocket` is read on, 1-based, counted the way the
 * lowering counts it. Derived from the PROGRAM text so a later edit to the
 * program cannot silently point the assertion at nothing. */
const READ_LINE = PROGRAM.split("\n").findIndex((l) => l.includes("}).WebSocket")) + 1;

async function emitBoth(): Promise<{ c: string; ll: string }> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-wstag-"));
  const src = join(dir, "main.ts");
  await writeFile(src, PROGRAM, "utf8");
  const out: Record<string, string> = {};
  for (const backend of ["c", "llvm"] as const) {
    const res = await compile(src, {
      outPath: join(dir, `program-${backend}`),
      outDir: dir,
      backend,
    });
    if (!res.ok) {
      throw new Error(`${backend} refused the ws program: ${res.diagnostics[0]?.message ?? "?"}`);
    }
    out[backend] = await readFile(res.cPath, "utf8");
  }
  return { c: out.c!, ll: out.llvm! };
}

describe("the ws init-bag refusals are tagged", () => {
  test("both fields, both backends, and the two lanes agree", async () => {
    const { c, ll } = await emitBoth();
    // The read site the lowering donates, spelled as the census greps it.
    const tail = `[SC2020 at `;
    for (const [lane, text] of [["c", c], ["ll", ll]] as const) {
      for (const field of ["dispatcher", "agent"]) {
        const needle =
          `carries '${field}', which has no scriptc lowering yet -- only protocols and headers do ${tail}`;
        expect(text, `${lane}: ${field} refusal is present and tagged`).toContain(needle);
        // …and the bracket names the READ's line, not some other line.
        const at = text.slice(text.indexOf(needle) + needle.length);
        const site = at.slice(0, at.indexOf("]"));
        expect(site.endsWith(`main.ts:${READ_LINE}`), `${lane}: ${field} site is ${site}`).toBe(true);
      }
      // No untagged survivor of the same family in either lane.
      const untagged = [...text.matchAll(/which has no scriptc lowering yet -- only protocols and headers do(.{0,3})/g)];
      expect(untagged.length, `${lane}: refusal count`).toBe(2);
      for (const m of untagged) {
        expect(m[1]!.startsWith(" [S"), `${lane}: every refusal carries a bracket`).toBe(true);
      }
    }
  }, 600_000);
});
