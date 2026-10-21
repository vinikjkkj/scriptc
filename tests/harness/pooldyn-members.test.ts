/* The seam of the real mysql2 entry: `rawPool as unknown as MysqlPool`, a double
 * assertion that narrows mysql2's `Pool` (a body-less `declare class`, mapped as a
 * record) to the three members the application declares structurally. Each test
 * pins ONE mechanism the cast needed, as a differential: the same TypeScript runs
 * on the test's own node (type-stripped, the only oracle that cannot disagree with
 * itself) and as a compiled binary on BOTH backends' default lane, and the output
 * must be identical. No mysql2 is needed: the local .d.ts spells the same member
 * shapes (the merged generic `execute`, the recursive `ExecuteValues` union with
 * Date and Blob arms, a promise-returning `getConnection`). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const repoNodeTypes = join(import.meta.dirname, "../..", "node_modules/@types/node");

async function differential(label: string, dts: string, src: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `scr-pooldyn-${label}-`));
  mkdirSync(join(dir, "node_modules/@types"), { recursive: true });
  symlinkSync(repoNodeTypes, join(dir, "node_modules/@types/node"), "junction");
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true } }));
  writeFileSync(join(dir, "declib.d.ts"), dts);
  const main = join(dir, "main.ts");
  writeFileSync(main, src);
  const exe = process.platform === "win32" ? ".exe" : "";
  const want = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", main], {
    encoding: "utf8",
    timeout: 120_000,
  });
  // Both backends: the C reference lane and the LLVM lane must agree with Node.
  for (const backend of ["c", "llvm"] as const) {
    const result = await compile(main, { outPath: join(dir, `prog-${backend}${exe}`), outDir: dir, backend });
    if (!result.ok) {
      throw new Error(`expected ${label} to compile on ${backend}; got:\n` + result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    const got = execFileSync(result.binaryPath, { encoding: "utf8", timeout: 120_000 });
    expect(got, backend).toBe(want);
    expect(got.length).toBeGreaterThan(0);
  }
}


describe("a double assertion narrows a body-less .d.ts class to a structural interface", () => {
  test("the pool seam: execute, getConnection and end stay callable through the narrowed record", async () => {
    // The application declares `{ execute(sql, values?: readonly unknown[]): Promise<[unknown,
    // unknown]>; getConnection(): Promise<tx>; end() }` and casts the library's pool to it.
    // Three conversions had no rule: a dyn parameter into the recursive `EV` union (whose Blob
    // arm no dyn value can be), the erased-generic array result into a `[unknown, unknown]`
    // tuple, and the nested connection record into its narrower structural view.
    await differential(
      "pool-seam",
      `export type EV =
  | string | number | bigint | boolean | Date | null | Blob | Uint8Array
  | EV[]
  | { [key: string]: EV };
export interface QO { sql: string; timeout?: number }
export interface Row { [column: string]: unknown }
export interface Field { name: string }
export declare class Conn {
  threadId: number;
  release(): void;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  execute<T extends Row[]>(sql: string, values?: EV): Promise<[T, Field[]]>;
  execute<T extends Row[]>(options: QO, values?: EV): Promise<[T, Field[]]>;
}
export declare class Pool {
  config: { limit: number; host: string };
  getConnection(): Promise<Conn>;
  end(): Promise<void>;
  execute<T extends Row[]>(sql: string, values?: EV): Promise<[T, Field[]]>;
  execute<T extends Row[]>(options: QO, values?: EV): Promise<[T, Field[]]>;
  on(event: string, listener: (...args: any[]) => void): this;
}
`,
      `import type { Pool, Conn, EV, QO, Row, Field } from "./declib.js";
const log: string[] = [];
const conn: Conn = {
  threadId: 7,
  release(): void { log.push("release"); },
  beginTransaction: async (): Promise<void> => { log.push("begin"); },
  commit: async (): Promise<void> => { log.push("commit"); },
  rollback: async (): Promise<void> => { log.push("rollback"); },
  execute: (async (sql: string | QO, values?: EV): Promise<[Row[], Field[]]> => {
    log.push("conn.execute " + (typeof sql === "string" ? sql : sql.sql) + " " + (values === undefined ? "none" : "given"));
    return [[{ id: 2 }], [{ name: "id" }]];
  }) as unknown as Conn["execute"],
};
const pool: Pool = {
  config: { limit: 3, host: "h" },
  getConnection: async (): Promise<Conn> => { log.push("getConnection"); return conn; },
  end: async (): Promise<void> => { log.push("end"); },
  execute: (async (sql: string | QO, values?: EV): Promise<[Row[], Field[]]> => {
    log.push("pool.execute " + (typeof sql === "string" ? sql : sql.sql) + " " + (values === undefined ? "none" : "given"));
    const none: Field[] = [];
    return [[{ id: 1, name: "a" }], none];
  }) as unknown as Pool["execute"],
  on: ((_e: string, _l: unknown): Pool => pool) as unknown as Pool["on"],
};

type SqlOut = [unknown, unknown];
interface MysqlExec { execute(sql: string, values?: readonly unknown[]): Promise<SqlOut>; }
interface MysqlTxConn extends MysqlExec { beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>; release(): void; }
interface MysqlPool extends MysqlExec { getConnection(): Promise<MysqlTxConn>; end(): Promise<void>; }
const mp: MysqlPool = pool as unknown as MysqlPool;

async function main(): Promise<void> {
  const out = await mp.execute("select ?", [1, "x", null]);
  console.log(JSON.stringify(out[0]), JSON.stringify(out[1]));
  const c = await mp.getConnection();
  const o2 = await c.execute("select 2");
  console.log(JSON.stringify(o2[0]), JSON.stringify(o2[1]));
  await c.beginTransaction();
  await c.commit();
  c.release();
  await mp.end();
  console.log(log.join("|"));
}
main().then(() => console.log("done"));
`,
    );
  }, 480_000);

  test("every extra member rides the overflow store and stays callable through dyn", async () => {
    // The members `MysqlPool` does not name (a `string | symbol` event slot, `eventNames()` and its
    // symbol result, `listeners(): Function[]`, a config record holding an index-signature record of
    // closures, a symbol-keyed member) are carried, not dropped: read back through `unknown` they
    // answer what Node answers, and the symbol-keyed one is not an own enumerable key. Key ORDER is
    // sorted away here on purpose: it is a recorded defect of the overflow design (the pooldyn
    // report), not a property this test pins.
    await differential(
      "pool-extras",
      `export type EV =
  | string | number | bigint | boolean | Date | null | Blob | Uint8Array
  | EV[]
  | { [key: string]: EV };
export interface Row { [column: string]: unknown }
export interface Field { name: string }
export interface Opts { limit: number; plugins: { [name: string]: (n: number) => string } }
export declare class Pool {
  config: Opts;
  threadId: number;
  [Symbol.asyncDispose](): Promise<void>;
  getConnection(): Promise<number>;
  end(): Promise<void>;
  execute<T extends Row[]>(sql: string, values?: EV): Promise<[T, Field[]]>;
  on(event: string | symbol, listener: (...args: any[]) => unknown): this;
  eventNames(): (string | symbol)[];
  listeners(event: string | symbol): Function[];
}
`,
      `import type { Pool, EV, Row, Field, Opts } from "./declib.js";
const marker = Symbol("m");
const slots: ((...args: unknown[]) => unknown)[] = [];
const names: (string | symbol)[] = [];
const pool: Pool = {
  config: { limit: 3, plugins: { a: (n: number) => "a" + n, b: (n: number) => "b" + n } },
  threadId: 9,
  [Symbol.asyncDispose]: async (): Promise<void> => {},
  getConnection: async (): Promise<number> => 5,
  end: async (): Promise<void> => {},
  execute: (async (sql: string, values?: EV): Promise<[Row[], Field[]]> => {
    const none: Field[] = [];
    return [[{ id: sql.length }], none];
  }) as unknown as Pool["execute"],
  on: ((e: string | symbol, l: (...args: unknown[]) => unknown): Pool => { names.push(e); slots.push(l); return pool; }) as unknown as Pool["on"],
  eventNames: (): (string | symbol)[] => names,
  listeners: ((_e: string | symbol): ((...args: unknown[]) => unknown)[] => slots) as unknown as Pool["listeners"],
};
pool.on("x", () => 1).on(marker, () => 2);

type SqlOut = [unknown, unknown];
interface MysqlPool { execute(sql: string, values?: readonly unknown[]): Promise<SqlOut>; end(): Promise<void>; }
const mp: MysqlPool = pool as unknown as MysqlPool;
const bag = mp as unknown as { [k: string]: unknown };

async function main(): Promise<void> {
  console.log(Object.keys(bag).sort().join(","));
  console.log(typeof bag["on"], typeof bag["eventNames"], typeof bag["listeners"], bag["threadId"]);
  const cfg = bag["config"] as Opts;
  console.log(cfg.limit, Object.keys(cfg.plugins).join(","), cfg.plugins["b"](2));
  const en = bag["eventNames"] as () => (string | symbol)[];
  const list = en();
  console.log(list.length, list[0], list[1] === marker);
  const ls = bag["listeners"] as (e: string | symbol) => ((...args: unknown[]) => unknown)[];
  const fns = ls("x");
  console.log(fns.length, fns[0](), fns[1]());
  const o = await mp.execute("select 1");
  console.log(JSON.stringify(o[0]), JSON.stringify(o[1]));
  await mp.end();
}
main().then(() => console.log("done"));
`,
    );
  }, 480_000);
});

describe("the checked-dynamic tree carries the values mysql2's Pool is made of", () => {
  test("a Symbol crosses into unknown by reference: typeof, identity, String(), template, JSON, inspect", async () => {
    await differential(
      "symbol-dyn",
      `export declare const marker: symbol;\n`,
      `const a = Symbol("a");
const b = Symbol.for("k");
const xs: unknown[] = [a, b, "s", 3];
for (const x of xs) console.log(typeof x);
console.log(xs[0] === a, xs[1] === Symbol.for("k"), xs[0] === xs[1]);
function ev(e: string | symbol): string {
  return typeof e === "string" ? "s:" + e : "sym";
}
console.log(ev(xs[0] as string | symbol), ev(xs[2] as string | symbol), ev("x"), ev(b));
const s2 = xs[0] as symbol;
console.log(s2 === a, s2 === b, s2.description, (xs[1] as symbol).description);
const names: (string | symbol)[] = ["x", a, "y"];
const back: unknown = names;
const arr = back as (string | symbol)[];
console.log(arr.length, arr[1] === a, ev(arr[0]));
const sd: unknown = Symbol("desc");
const sn: unknown = Symbol();
console.log(String(sd), String(sn), String(Symbol.for("reg")));
try { console.log(\`\${sd}\`); } catch (e) { console.log((e as Error).name, (e as Error).message); }
try { console.log("" + (sd as string)); } catch (e) { console.log((e as Error).name); }
console.log(JSON.stringify([1, sd, 2]), JSON.stringify(sd));
console.log(sd, [sd, 1]);
console.log(sd !== undefined, !!sd, typeof sd);
`,
    );
  }, 480_000);

  test("a Date crosses into unknown by reference: identity, a Date arm of a union, an array of Dates", async () => {
    await differential(
      "date-dyn",
      `export declare const marker: symbol;\n`,
      `const d = new Date(86400000);
const e = new Date(86400000);
const u: unknown = d;
console.log(typeof u, u === d, u === e, (u as Date).getTime());
type V = string | number | Date | null;
const vs: unknown[] = [d, "s", 4, null];
for (const x of vs) {
  const v = x as V;
  console.log(v === null ? "null" : v === d ? "same-date" : "other");
}
const back = vs[0] as Date;
console.log(back === d, back.toISOString());
const list: unknown = [d, e];
console.log((list as Date[]).length, (list as Date[])[1] === e);
`,
    );
  }, 480_000);

  test("an array of functions and an index-signature record of closures cross into unknown", async () => {
    await differential(
      "closures-dyn",
      `export declare const marker: symbol;\n`,
      `type Fn = (n: number) => number;
const fs: Fn[] = [(n) => n + 1, (n) => n * 2];
const u: unknown = fs;
const back = u as Fn[];
console.log(typeof u, back.length, back[0](5), back[1](5), back[0] === fs[0]);
const plugins: { [name: string]: (n: number) => string } = { a: (n) => "a" + n, b: (n) => "b" + n };
const pu: unknown = plugins;
const pb = pu as { [name: string]: (n: number) => string };
console.log(Object.keys(pb).join(","), pb["a"](1), pb["b"](2));
`,
    );
  }, 480_000);
});
