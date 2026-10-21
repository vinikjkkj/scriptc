/* mysql2's `Connection` (and PoolConnection / Pool) is a body-less `declare
 * class` whose members the record shape used to EXCLUDE when they were
 * generic, overloaded, optional-generic or took a standard-library
 * constructor. Excluding a member is best effort: a program that names it is
 * refused although the type "maps". Each test below pins ONE mechanism that
 * lets a family of members map and be CALLED natively, as a differential:
 * the same TypeScript runs on the test's own node (type-stripped, the only
 * oracle that cannot disagree with itself) and as a compiled binary, and the
 * output must be identical. No mysql2 is needed: the local .d.ts spells the
 * same member shapes, and the program builds the value structurally (a static
 * build has no other producer of a value of a non-program class). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

// The program's own `node_modules/@types/node` (pointing at the repo's) and a
// tsconfig.json beside the entry: without them the compiler stands up its ambient fallback, whose
// EventEmitter has none of the generic surface these tests are about. The
// program itself stays in a tmpdir because Node refuses to strip types from a
// file under node_modules, and the Node run is the oracle.
const repoNodeTypes = join(import.meta.dirname, "../..", "node_modules/@types/node");

async function differential(label: string, dts: string, src: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `scr-connfull-${label}-`));
  mkdirSync(join(dir, "node_modules/@types"), { recursive: true });
  symlinkSync(repoNodeTypes, join(dir, "node_modules/@types/node"), "junction");
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true } }));
  writeFileSync(join(dir, "declib.d.ts"), dts);
  const main = join(dir, "main.ts");
  writeFileSync(main, src);
  const exe = process.platform === "win32" ? ".exe" : "";
  const result = await compile(main, { outPath: join(dir, `prog${exe}`), outDir: dir });
  if (!result.ok) {
    throw new Error(`expected ${label} to compile; got:\n` + result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  const want = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", main], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const got = execFileSync(result.binaryPath, { encoding: "utf8", timeout: 120_000 });
  expect(got).toBe(want);
  expect(got.length).toBeGreaterThan(0);
}

describe("a body-less .d.ts class: every member is a slot the program can call", () => {
  test("a listener slot spelled `(...args: any[]) => void` takes typed closures through the dyn pack", async () => {
    await differential(
      "listener",
      `export declare class Conn {
  threadId: number;
  on(event: string, listener: (...args: any[]) => void): this;
}
`,
      `import type { Conn } from "./declib.js";
const seen: string[] = [];
const c: Conn = {
  threadId: 3,
  on(event: string, listener: (...args: unknown[]) => void): Conn {
    listener(1, "a");
    return c;
  },
};
c.on("x", (n: number) => console.log("got", n));
c.on("two", (n: number, s: string) => console.log("two", n, s));
c.on("none", () => console.log("none"));
console.log(c.threadId, seen.length);
`,
    );
  }, 240_000);

  test("an EventEmitter subclass: the whole inherited generic surface is a slot the program fills and calls", async () => {
    // Every member below comes from @types/node's `class EventEmitter` and is
    // generic over an unconstrained `K` that the default event map erases from
    // the signature, takes `(...args: any[]) => void` listeners, answers
    // `this` (the record's own shape) or `Function[]`. Each used to be dropped
    // from the shape, so a program naming one was refused although the type
    // "mapped". The program implements the surface and calls all of it.
    await differential(
      "emitter",
      `import { EventEmitter } from "events";
export declare class EvConn extends EventEmitter {
  threadId: number;
  ping(): void;
}
`,
      `import type { EvConn } from "./declib.js";
type L = (...args: unknown[]) => void;
type Slot = { name: string; fn: L; once: boolean };
let slots: Slot[] = [];
const keyOf = (e: string | symbol): string => (typeof e === "string" ? e : "<symbol>");
function collect(eventName: string | symbol): ((...args: unknown[]) => unknown)[] {
  const k = keyOf(eventName);
  const out: ((...args: unknown[]) => unknown)[] = [];
  for (const s of slots) if (s.name === k) out.push(s.fn);
  return out;
}
const c: EvConn = {
  threadId: 9,
  ping(): void { console.log("ping"); },
  addListener(eventName: string | symbol, listener: L): EvConn { slots.push({ name: keyOf(eventName), fn: listener, once: false }); return c; },
  on(eventName: string | symbol, listener: L): EvConn { slots.push({ name: keyOf(eventName), fn: listener, once: false }); return c; },
  once(eventName: string | symbol, listener: L): EvConn { slots.push({ name: keyOf(eventName), fn: listener, once: true }); return c; },
  prependListener(eventName: string | symbol, listener: L): EvConn { slots.unshift({ name: keyOf(eventName), fn: listener, once: false }); return c; },
  prependOnceListener(eventName: string | symbol, listener: L): EvConn { slots.unshift({ name: keyOf(eventName), fn: listener, once: true }); return c; },
  off(eventName: string | symbol, listener: L): EvConn { const k = keyOf(eventName); slots = slots.filter((s) => !(s.name === k && s.fn === listener)); return c; },
  removeListener(eventName: string | symbol, listener: L): EvConn { const k = keyOf(eventName); slots = slots.filter((s) => !(s.name === k && s.fn === listener)); return c; },
  removeAllListeners(eventName?: string | symbol): EvConn { if (eventName === undefined) slots = []; else { const k = keyOf(eventName); slots = slots.filter((s) => s.name !== k); } return c; },
  setMaxListeners(n: number): EvConn { return c; },
  getMaxListeners(): number { return 10; },
  listeners(eventName: string | symbol): ((...args: unknown[]) => unknown)[] { return collect(eventName); },
  rawListeners(eventName: string | symbol): ((...args: unknown[]) => unknown)[] { return collect(eventName); },
  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    const k = keyOf(eventName);
    const hit = slots.filter((s) => s.name === k);
    slots = slots.filter((s) => !(s.name === k && s.once));
    for (const s of hit) s.fn(...args);
    return hit.length > 0;
  },
  listenerCount(eventName: string | symbol, listener: ((...args: unknown[]) => unknown) | undefined): number { const k = keyOf(eventName); return slots.filter((s) => s.name === k && (listener === undefined || s.fn === listener)).length; },
  eventNames(): (string | symbol)[] { return slots.map((s) => s.name); },
};
const a = (n: number): void => console.log("a", n);
c.on("x", a);
c.once("x", (n: number, s: string) => console.log("once", n, s));
c.prependListener("x", () => console.log("first"));
console.log(c.listenerCount("x", undefined), c.listeners("x").length, c.eventNames().length);
console.log(c.emit("x", 1, "s"));
console.log(c.emit("x", 2, "t"));
c.off("x", a);
c.removeAllListeners("x");
console.log(c.emit("x", 3, "u"), c.listenerCount("x", undefined), c.getMaxListeners());
c.on("y", a).on("y", (n: number) => console.log("b", n));
console.log(c.listenerCount("y", undefined), c.listeners("y").length, c.rawListeners("y").length);
c.removeAllListeners("y");
console.log(c.listenerCount("y", undefined), c.threadId);
c.ping();
`,
    );
  }, 240_000);

  test("an overload set is one merged slot: every overload stays callable", async () => {
    // `end(cb?)` / `end(options, cb?)` and `escapeId(string)` / `escapeId(string[])`
    // (mysql2's Connection). The member is ONE closure whose parameters are the
    // union of the overloads' (a dyn where one spells `any`), and a call through
    // any overload coerces into its slice of it.
    await differential(
      "overload",
      `export type Cb = (err: Error | null) => void;
export declare class OvConn {
  threadId: number;
  end(callback?: Cb): void;
  end(options: any, callback?: Cb): void;
  escapeId(value: string): string;
  escapeId(values: string[]): string;
}
`,
      `import type { OvConn } from "./declib.js";
type Cb = (err: Error | null) => void;
const calls: string[] = [];
function endImpl(a: unknown, b: Cb | undefined): void {
  calls.push("end");
  if (typeof a === "function") (a as Cb)(null);
  if (b !== undefined) b(null);
}
function escapeIdImpl(v: string | string[]): string {
  if (typeof v === "string") return "\`" + v + "\`";
  return v.map((x) => "\`" + x + "\`").join(".");
}
const c: OvConn = {
  threadId: 4,
  end: endImpl as unknown as OvConn["end"],
  escapeId: escapeIdImpl as unknown as OvConn["escapeId"],
};
c.end();
c.end((e) => console.log("end cb", e === null));
c.end({ force: true }, (e) => console.log("end opts cb", e === null));
console.log(c.escapeId("t"), c.escapeId(["db", "t"]), calls.length, c.threadId);
`,
    );
  }, 240_000);

  test("a record holding a recursive union with non-JSON arms and a this-returning member builds", async () => {
    // The record has a `this`-returning member (a cycle), an optional `this`-returning method
    // (a union arm that returns the record) and a slot whose parameter is a RECURSIVE union
    // with a bigint arm. funcCoerceAdapter asks whether that parameter converts to dyn;
    // canConvertToDyn guarded recursion through records only, so the recursive union (and a
    // function whose result is the record) restarted the walk at every hop and the compiler
    // died with "Maximum call stack size exceeded". `run` and `many` are never invoked: an
    // adapter whose parameters cannot convert throws only when called.
    await differential(
      "recursive-union",
      `export type R = string | bigint | boolean | R[] | { [key: string]: R };
export declare class Conn {
  threadId: number;
  on(event: string, listener: (...args: any[]) => void): this;
  run(v: R): string;
  many(vs: R[]): R[];
  chain?(): this;
  maybe(cb?: ((err: Error | null, r: R) => void) | undefined): void;
}
`,
      `import type { Conn, R } from "./declib.js";
const c: Conn = {
  threadId: 3,
  on: ((_e: string, _l: unknown): Conn => c) as unknown as Conn["on"],
  run(v: unknown): string { return Array.isArray(v) ? "array" + v.length : "scalar"; },
  many(vs: unknown): R[] { return Array.isArray(vs) ? (vs as R[]) : []; },
  chain: undefined,
  maybe: ((_cb: unknown): void => {}) as unknown as Conn["maybe"],
};
// Building the record is what walked the recursive union (funcCoerceAdapter asks whether
// each slot parameter converts to dyn). \`run\` and \`many\` are never invoked: an adapter whose
// parameters cannot convert throws only if called, which is the compiler's own stance.
console.log(c.threadId, c.chain === undefined, c.on("x", () => {}).threadId);
`,
    );
  }, 240_000);

  test("a union with an array-of-unknown constituent in a member is the checked-dynamic tier", async () => {
    // mysql2's QueryValues: `string | number | bigint | boolean | Date | null | undefined |
    // Blob | Buffer | Uint8Array | ({} | null | undefined)[] | { [key: string]: QueryValues }`.
    // A union cannot carry a dyn arm beside typed ones, and the dyn collapse wants every arm
    // convertible; as a member's parameter it reads "any value", the checked-dynamic tier.
    await differential(
      "values-union",
      `export type QV =
  | string | number | bigint | boolean | Date | null | undefined | Blob | Buffer | Uint8Array
  | ({} | null | undefined)[]
  | { [key: string]: QV };
export declare class Conn {
  threadId: number;
  query(sql: string, values: QV): string;
  query(sql: string): string;
}
`,
      `import type { Conn } from "./declib.js";
function queryImpl(sql: string, values: unknown): string {
  return sql + ":" + (values === undefined ? "none" : typeof values === "string" ? "s=" + values : typeof values === "number" ? "n=" + values : Array.isArray(values) ? "a" + values.length : "o");
}
const c: Conn = {
  threadId: 1,
  query: queryImpl as unknown as Conn["query"],
};
console.log(c.query("a"));
console.log(c.query("b", "text"));
console.log(c.query("c", 42));
console.log(c.query("d", [1, "x", null]));
console.log(c.query("e", { k: 1 }));
`,
    );
  }, 240_000);

  test("an interface that extends a body-less class carries the class's members", async () => {
    // mysql2's public `Pool` is `export interface Pool extends BasePool {}` over the body-less
    // `declare class Pool`. The class mapped; the interface every program names did not
    // (the pure-data rules refuse its overload sets).
    await differential(
      "interface-view",
      `export type Cb = (err: Error | null, n: number) => any;
declare class BasePool {
  config: { limit: number };
  getConnection(callback: Cb): void;
  end(callback?: (err: Error | null) => any): void;
  on(event: string, listener: (...args: any[]) => void): this;
  on(event: "acquire", listener: (n: number) => any): this;
  escapeId(value: string): string;
  escapeId(values: string[]): string;
}
export interface Pool extends BasePool {}
`,
      `import type { Pool } from "./declib.js";
type Cb = (err: Error | null, n: number) => unknown;
const log: string[] = [];
const p: Pool = {
  config: { limit: 3 },
  getConnection(callback: Cb): void { callback(null, 7); },
  end: ((cb: unknown): void => { log.push("end"); }) as unknown as Pool["end"],
  on: ((e: string, _l: unknown): Pool => { log.push("on:" + e); return p; }) as unknown as Pool["on"],
  escapeId: ((v: string | string[]): string => (typeof v === "string" ? "\`" + v + "\`" : v.join("."))) as unknown as Pool["escapeId"],
};
p.getConnection((err, n) => console.log("conn", err === null, n));
p.on("x", (n: number) => console.log("x got", n)).on("acquire", (n: number) => console.log("acq", n));
console.log(log.length);
p.end();
console.log(p.escapeId("a"), p.escapeId(["a", "b"]), p.config.limit, log.join(","));
`,
    );
  }, 240_000);

  test("a well-known symbol member of a mapped class can be written and read", async () => {
    // `[Symbol.dispose](): void` is a REQUIRED member of mysql2's Connection and Pool. A literal
    // could not spell it (computed symbol keys were refused), and `r[Symbol.dispose]()` was
    // refused on the read side, so no program could build or call such a value.
    await differential(
      "symbol-key",
      `export declare class Res {
  name: string;
  [Symbol.dispose](): void;
  close(): void;
}
`,
      `import type { Res } from "./declib.js";
const events: string[] = [];
const r: Res = {
  name: "r1",
  [Symbol.dispose](): void { events.push("dispose"); },
  close(): void { events.push("close"); },
};
r.close();
r[Symbol.dispose]();
console.log(r.name, events.join(","));
`,
    );
  }, 240_000);

  test("a PromiseConstructor-typed parameter takes the global Promise value", async () => {
    // `Connection.promise(promiseImpl?: PromiseConstructor)`. The type is a named stdlib
    // handle (IrType "opaque"); the bare `Promise` value is its one immortal singleton.
    await differential(
      "promise-ctor",
      `export declare class Conn {
  threadId: number;
  promise(promiseImpl?: PromiseConstructor): Conn;
}
`,
      `import type { Conn } from "./declib.js";
let seen = 0;
const c: Conn = {
  threadId: 5,
  promise(promiseImpl: PromiseConstructor | undefined): Conn {
    seen += promiseImpl === undefined ? 1 : 10;
    return c;
  },
};
c.promise();
c.promise(Promise);
c.promise(Promise).promise();
console.log(seen, c.threadId);
`,
    );
  }, 240_000);

  test("a recursive union with Blob, Date and Buffer arms maps", async () => {
    // mysql2's ExecuteValues: `Typed | string | number | bigint | boolean | Date | null | Blob |
    // Buffer | Uint8Array | ExecuteValues[] | { [key: string]: ExecuteValues }`. `Blob` had no
    // representation at all.
    await differential(
      "blob-union",
      `export interface Typed { readonly type: number; readonly value: unknown }
export type EV =
  | Typed | string | number | bigint | boolean | Date | null | Blob | Buffer | Uint8Array
  | EV[]
  | { [key: string]: EV };
export declare class Conn {
  threadId: number;
  execute(sql: string, values: EV[]): string;
  run(sql: string, v: EV): string;
}
`,
      `import type { Conn, EV } from "./declib.js";
const c: Conn = {
  threadId: 2,
  execute(sql: string, values: EV[]): string { return sql + ":" + values.length; },
  run(sql: string, v: EV): string { return sql + ":" + (Array.isArray(v) ? "a" + v.length : v === null ? "null" : "x"); },
};
console.log(c.execute("a", [1, "x", true, null]));
console.log(c.run("b", 3), c.run("c", "s"), c.run("d", [1, 2]), c.run("e", { k: 1 }));
`,
    );
  }, 240_000);
});
