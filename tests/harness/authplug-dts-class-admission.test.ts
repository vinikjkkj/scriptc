/* mysql2's `PoolOptions.authPlugins` is `{ [key: string]: AuthPlugin }` where
 *
 *   type AuthPlugin = (meta: { connection: Connection; command: string }) =>
 *     (data: Buffer) => Promise<string> | string | Buffer | Promise<Buffer> | null;
 *
 * and `Connection` is a `declare class` with methods in a .d.ts. Three
 * independent refusals stood in front of it, and all three are exercised
 * here with a local .d.ts that has the same shape (no network, no mysql2):
 *
 *   1. a method spelled as a METHOD (`end(): void`) was refused although the
 *      identical arrow-spelled property was admitted;
 *   2. a body-less .d.ts class instance never mapped, so any record naming
 *      it failed whole (`connection: Connection`);
 *   3. a union with two promise arms beside their own settled values
 *      (`Promise<string> | string | Buffer | Promise<Buffer> | null`) had no
 *      runtime home.
 *
 * Differential against a hand-written JS twin run on the test's own node: an
 * expectation typed into this file would be a second thing that can be wrong.
 * The program builds the Conn value STRUCTURALLY (no value of a non-program
 * class can come from anywhere else in a static build; the literal carries every
 * member the shape has: `end` (an overload set, one merged slot) and `on`
 * (`this`-returning) belong to it, while the generic `query<T>` and the
 * PromiseConstructor-taking `promise` are still declined from it), authors the plugins,
 * reads them back out of the record and calls them, awaiting every return
 * arm. The negative case pins that the promise-union rule did not widen: a
 * promise whose payload is not among the data arms still refuses. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const DECLIB_DTS = `export declare class Conn {
  threadId: number;
  state: string;
  end(cb?: (err: Error | null) => void): void;
  end(options: unknown, cb?: (err: Error | null) => void): void;
  ping(): void;
  escape(v: string): string;
  query<T>(sql: string): T;
  on(event: string, listener: (...args: any[]) => void): this;
  promise(impl?: PromiseConstructor): Conn;
}
export type Plugin = (meta: { connection: Conn; command: string }) =>
  (data: Uint8Array) => Promise<string> | string | Uint8Array | Promise<Uint8Array> | null;
export interface Opts {
  host?: string;
  plugins?: { [key: string]: Plugin };
}
`;

const SRC = `import type { Opts, Conn, Plugin } from "./declib.js";
const conn: Conn = {
  threadId: 7,
  state: "ready",
  end(_a: unknown, _b: ((err: Error | null) => void) | undefined) {},
  ping() {},
  escape(v: string) { return "'" + v + "'"; },
  on(_event: string, _listener: (...args: unknown[]) => void): Conn { return conn; },
} as unknown as Conn;
type R = Promise<string> | string | Uint8Array | Promise<Uint8Array> | null;
const opts: Opts = {
  host: "h",
  plugins: {
    s: (m) => (d): R => m.command + ":" + m.connection.threadId + ":" + m.connection.escape("q") + ":" + d.length,
    b: (_m) => (d): R => d,
    ps: (m) => (d): R => Promise.resolve("p" + m.command + d.length),
    pb: (_m) => (d): R => Promise.resolve(d),
    nul: (_m) => (_d): R => null,
  },
};
async function run(o: Opts): Promise<void> {
  const plugins = o.plugins;
  if (plugins === undefined) { console.log("none"); return; }
  for (const n of ["s", "b", "ps", "pb", "nul", "zz"]) {
    const p: Plugin | undefined = plugins[n];
    if (p === undefined) { console.log(n, "missing"); continue; }
    const r = await p({ connection: conn, command: "go" })(new Uint8Array(3));
    if (r === null) console.log(n, "null");
    else if (typeof r === "string") console.log(n, "string", r);
    else console.log(n, "bytes", r.length);
  }
}
run(opts);
`;

const ORACLE_JS = `const conn = { threadId: 7, escape(v) { return "'" + v + "'"; } };
const plugins = {
  s: (m) => (d) => m.command + ":" + m.connection.threadId + ":" + m.connection.escape("q") + ":" + d.length,
  b: (_m) => (d) => d,
  ps: (m) => (d) => Promise.resolve("p" + m.command + d.length),
  pb: (_m) => (d) => Promise.resolve(d),
  nul: (_m) => (_d) => null,
};
(async () => {
  for (const n of ["s", "b", "ps", "pb", "nul", "zz"]) {
    const p = plugins[n];
    if (p === undefined) { console.log(n, "missing"); continue; }
    const r = await p({ connection: conn, command: "go" })(new Uint8Array(3));
    if (r === null) console.log(n, "null");
    else if (typeof r === "string") console.log(n, "string", r);
    else console.log(n, "bytes", r.length);
  }
})();
`;

describe("a body-less .d.ts class inside an index-signature callback record", () => {
  test("compiles natively, and the program-authored plugins run and await every return arm like Node", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scr-authplug-"));
    writeFileSync(join(dir, "declib.d.ts"), DECLIB_DTS);
    const src = join(dir, "main.ts");
    writeFileSync(src, SRC);
    const exe = process.platform === "win32" ? ".exe" : "";
    const result = await compile(src, { outPath: join(dir, `prog${exe}`), outDir: dir });
    if (!result.ok) {
      throw new Error(
        `expected the shape to compile; got:\n` + result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      );
    }
    const oracle = join(dir, "oracle.js");
    writeFileSync(oracle, ORACLE_JS);
    const want = execFileSync(process.execPath, [oracle], { encoding: "utf8", timeout: 120_000 });
    const got = execFileSync(result.binaryPath, { encoding: "utf8", timeout: 120_000 });
    expect(got).toBe(want);
  }, 240_000);

  test("a promise whose payload is NOT among the data arms still refuses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scr-authplug-neg-"));
    const src = join(dir, "main.ts");
    writeFileSync(
      src,
      `type R = Promise<number> | Promise<string> | boolean;
const f = (n: number): R => n > 1 ? Promise.resolve(n) : true;
async function main(): Promise<void> { const r = await f(2); console.log(typeof r); }
main();
`,
    );
    const result = await compile(src, {
      outPath: join(dir, `prog${process.platform === "win32" ? ".exe" : ""}`),
      outDir: dir,
    });
    expect(result.ok, "a promise payload with no matching data arm must keep its refusal").toBe(false);
  }, 120_000);
});
