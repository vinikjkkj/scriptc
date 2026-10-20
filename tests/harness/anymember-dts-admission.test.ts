/* A bare `any` RECORD MEMBER declared in a shipped .d.ts (mysql2's
 * `PoolOptions.debug: any` is the motivating shape) admits a native
 * `dyn` (ScrDyn) representation instead of refusing the whole record --
 * types.ts's mapRecordTypeInner, gated on every declaration of the member
 * being in a declaration file. No instrument before this file had real
 * coverage of either direction:
 *
 *   - the ADMISSION itself (the record compiles, and a typeof-narrowed
 *     function held in the member is CALLABLE directly off the property
 *     access -- lowerRecordFieldCall's own dyn-callee branch, a second,
 *     independent fix in the same change), and
 *
 *   - the BOUNDARY (a program-authored member of the identical shape, no
 *     .d.ts anywhere, must keep refusing -- the pinned regression this
 *     admission was built not to break is
 *     tests/diagnostics/any-outside-an-index-signature-still-has-no-
 *     representation.ts, but that fixture predates this feature and only
 *     exercises the refusal side; it was never wired to this gate by
 *     name).
 *
 * The local tests/corpus sweep is NOT this instrument: its 1876 programs
 * contain zero bare-`any` record members backed by a real .d.ts (every
 * `: any` member reachable at a corpus-sweep audit was traced to an index
 * signature, a local binding, or an @dynamic file), so a corpus-sweep
 * green is not evidence either way about this gate. This file is the
 * explicit coverage the corpus is structurally blind to.
 *
 * Differential against process.execPath, like every other compile+run
 * harness test here: an expectation typed into this file would be a
 * second thing that can be wrong and would rot silently.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const DECLIB_DTS = `export interface PoolOptionsLike {
  host: string;
  port: number;
  debug: any;
}
`;

// Mirrors declib's shape structurally so the ONLY difference between the
// admitted and refused cases is provenance (a .d.ts declaration vs. a
// plain .ts one) -- never the member's spelling, the construction, the
// call shape, or where `makePool` itself is implemented (always PROGRAM-
// authored and local -- the .d.ts carries only the TYPE, matching mysql2:
// the program never implements PoolOptions, only consumes it).
function poolSrc(typeDecl: string): string {
  return `${typeDecl}
function makePool(opts: PoolOptionsLike): PoolOptionsLike { return opts; }
function describe(opts: PoolOptionsLike): string {
  if (typeof opts.debug === "boolean") return opts.debug ? "debug:on" : "debug:off";
  if (typeof opts.debug === "function") {
    const r = opts.debug("hi");
    return "debug:fn:" + String(r);
  }
  return "debug:other";
}
const p = makePool({ host: "localhost", port: 3306, debug: true });
console.log(p.host, p.port, describe(p));
const q = makePool({ host: "127.0.0.1", port: 3307, debug: (msg: string) => "echo:" + msg });
console.log(q.host, q.port, describe(q));
`;
}

// The oracle is a hand-authored JS twin of poolSrc's logic -- node cannot
// run main.ts directly (interfaces and `: Type` annotations are not
// universally strippable across supported node versions without relying
// on experimental flags), and an expectation typed into this file would
// be a second thing that can be wrong and would rot silently.
const ORACLE_JS = `function makePool(opts) { return opts; }
function describe(opts) {
  if (typeof opts.debug === "boolean") return opts.debug ? "debug:on" : "debug:off";
  if (typeof opts.debug === "function") {
    const r = opts.debug("hi");
    return "debug:fn:" + String(r);
  }
  return "debug:other";
}
const p = makePool({ host: "localhost", port: 3306, debug: true });
console.log(p.host, p.port, describe(p));
const q = makePool({ host: "127.0.0.1", port: 3307, debug: (msg) => "echo:" + msg });
console.log(q.host, q.port, describe(q));
`;

describe("a bare `any` record member declared in a shipped .d.ts", () => {
  test("admits a native (no --dynamic) record, and the typeof-narrowed function member is directly callable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scr-anymember-dts-"));
    // The .d.ts carries ONLY the type -- exactly PoolOptions' own shape:
    // mysql2 ships types, never this program's logic. `makePool` stays
    // program-authored (poolSrc defines it) either way; the ONLY variable
    // between this test and the negative one below is whether the
    // interface's OWN declaration lives in a .d.ts or a .ts.
    writeFileSync(join(dir, "declib.d.ts"), DECLIB_DTS);
    const src = join(dir, "main.ts");
    writeFileSync(src, poolSrc('import type { PoolOptionsLike } from "./declib.js";\n'));
    const exeSuffix = process.platform === "win32" ? ".exe" : "";

    const result = await compile(src, {
      outPath: join(dir, `prog${exeSuffix}`),
      outDir: dir,
    });
    if (!result.ok) {
      throw new Error(
        `expected the admitted shape to compile; got:\n` +
          result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      );
    }

    const oracleSrc = join(dir, "oracle.js");
    writeFileSync(oracleSrc, ORACLE_JS);
    const want = execFileSync(process.execPath, [oracleSrc], { encoding: "utf8", timeout: 120_000 });

    let got = "";
    let stderr = "";
    let status = 0;
    try {
      got = execFileSync(result.binaryPath, { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      got = err.stdout ?? "";
      stderr = err.stderr ?? "";
    }
    expect(status, `exited ${status}; stderr:\n${stderr}`).toBe(0);
    expect(got).toBe(want);
  }, 120_000);

  test("the IDENTICAL shape, program-authored (no .d.ts anywhere), still refuses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scr-anymember-plain-"));
    const src = join(dir, "main.ts");
    writeFileSync(
      src,
      poolSrc(`interface PoolOptionsLike {
  host: string;
  port: number;
  debug: any;
}
`),
    );
    const result = await compile(src, {
      outPath: join(dir, `prog${process.platform === "win32" ? ".exe" : ""}`),
      outDir: dir,
    });
    expect(result.ok, "a program-authored bare-`any` member must still refuse").toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === "SC2011")).toBe(true);
    }
  }, 120_000);
});
