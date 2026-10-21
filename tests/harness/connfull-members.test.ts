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
});
