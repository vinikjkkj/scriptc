/* The record view of a declaration type whose compiled JS twin is a class with UNTYPED methods
 * (corpus 23850; the Promise constructor value it needs is corpus 23851).
 *
 * `twinrec` is mysql2's promise surface reduced to the mechanisms that stood between a
 * `PromisePool` and a program's own `{ execute(...): Promise<[unknown, unknown]>; end(): Promise<void> }`:
 *
 *   1. the declared `Pool` is paired with the twin class `PromisePool` that lives in ANOTHER file
 *      (lib/promise/pool.js, reached by require), so the class is in the program and the value is
 *      its instance (the older notes that said the class had no ClassInfo came from a probe that
 *      imported the package from a pnpm symlink: the Node-resolution probe for the tree's own
 *      requires started from the symlink instead of the realpath, so every statement after the
 *      first require counted as dead);
 *   2. `execute(sql, args)` and `query(sql, args)` have untyped parameters, so they own no vtable
 *      slot: a record's method field binds the method's all-dynamic default instance to the
 *      instance (the slot's parameters convert in, surplus ones drop, the result converts out);
 *   3. those methods answer `new this.Promise(...)`, a checked-dynamic value: a Promise slot takes
 *      it by Node's resolution rule (dyn.adoptPromise) and checks the payload, and the `Promise`
 *      constructor itself is a function object `new` can run (corpus 23851).
 *
 * The declared payload's RECORD arms (a result-set header class in the twin) are read off the
 * instance by the checked cast's instance lane (cases/twinrec/record.ts, corpus 23950-23955).
 *
 * The record view is the OBJECT, not a copy of it (value model, 2026-11-03): the store's
 * `{ execute: PoolConnection['execute'] }` lowers (its first parameter, a record | string union, crosses
 * into the untyped method as the very object, so the callee's writes are the caller's reads), and a
 * program that writes a field of the payload's record writes the instance's own member.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-twinrec.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-twin-record-view", flavor);

/* Recorded from Node v24.15.0 (`node --experimental-strip-types cases/twinrec/main.ts`). */
const EXPECTED =
  "sqlRun 10\n" +
  "query q:Q1:2 1\n" +
  "sqlRun 10\n" +
  "caught boom from a\n" +
  "count 2\n" +
  "sqlRun 10\n" +
  "shut\n" +
  "shut\n" +
  "ended\n";

/* cases/twinrec/direct.ts, recorded the same way. */
const DIRECT_EXPECTED =
  "query q:Q1:2 1\n" +
  "options q:[object Object]:0\n" +
  "inserted\n" +
  "inserted conn\n" +
  "conn q:Q3:0\n" +
  "caught boom from a\n" +
  "count 1\n" +
  "ended\n";

/* cases/twinrec/record.ts, recorded the same way. */
const RECORD_EXPECTED =
  "header 1 42 0\n" +
  "union header 1 42\n" +
  "text SELECT 1:2\n" +
  "conn header 1 42\n" +
  "ended\n";

/* cases/twinrec/store-pool.ts, recorded the same way. */
const STORE_POOL_EXPECTED =
  "calls 0\n" +
  "exec true SELECT 1:1 1\n" +
  "query q:SELECT 2:2 1\n" +
  "calls after write+exec 11\n" +
  "ping true function\n" +
  "ping now false undefined\n" +
  "ping gone true\n" +
  "inline 1 true\n";

/* cases/twinrec/store-getter.ts: a data member served by a counting getter runs once per program read (Node's own
   count), never once more at the projection. */
const STORE_GETTER_EXPECTED = "first 1\nsecond 2\nafter 3 4 1\nthird 5 true\n";

/* cases/twinrec/state-machine.ts: mysql2's Command state machine (a method answers the next state, itself a method of
   its own class), recorded from node. */
const STATE_MACHINE_EXPECTED =
  "false,false,false,false,false,false,false,true | header,field:a,field:b,row:r1,row:r2\n" +
  "false,false,false,false,false,false,false,true | x-header,x-field:a,x-field:b,x-field:c,x-eof,row:r1\n" +
  "protocolError expected eof\n" +
  "false,false,false,false,true | header,field:a,field:b\n" +
  "protocolError bad header\n" +
  "false,true | \n" +
  "false,false,false,true | hello,cmd:ping,cmd:query\n";

/* cases/twinrec/loop-factory.ts: a table of factories built in a loop (mysql2's typed_parameter), recorded from node. */
const LOOP_FACTORY_EXPECTED =
  "tiny 1 3 false true\n" +
  " unsigned 1003 true\n" +
  "small 2 6 false true\n" +
  " unsigned 1006 true\n" +
  "text 3 3 false false\n" +
  "blob 4 3 false false\n" +
  "nil 0 null false false\n" +
  "null\n";

/* cases/twinrec/empty-options.ts: a base class that starts `options` as an empty object literal (ioredis' Commander),
   recorded from node. */
const EMPTY_OPTIONS_EXPECTED =
  "a\n" +
  "p:k|5000|false|1\n" +
  "k|5000|true|1\n" +
  "undefined 5000 z\n";

/* cases/twinrec/proto-loop.ts: methods installed on a base prototype in a loop, called through a typed receiver
   (ioredis' redis.quit()), recorded from node. */
const PROTO_LOOP_EXPECTED =
  "get:a:1\n" +
  "set:a,b:2\n" +
  "quit::3 3 r\n";

/* cases/twinrec/nullable-receiver.ts: a class instance called through a `Class | undefined` field (ioredis' Cluster),
   recorded from node. */
const NULLABLE_RECEIVER_EXPECTED =
  "[ 'g', 1 ] 2\n" +
  "[] -1\n" +
  "4\n" +
  "TypeError Cannot read properties of undefined (reading 'count')\n";

/* cases/twinrec/claim-ticks.ts: observers of declaration-claimed promises run on the turn Node runs them, recorded from node. */
const CLAIM_TICKS_EXPECTED =
  "sync@0\n" +
  "then-fulfilled 1@1\n" +
  "plain-1@1\n" +
  "then-rejected boom@1\n" +
  "then-settled 3@1\n" +
  "plain-2@1\n" +
  "await-fulfilled 1@1\n" +
  "await-rejected boom@2\n" +
  "then-two 5@3\n" +
  "await-settled 3@3\n" +
  "await-two 5@4\n" +
  "then-timer 4@12\n" +
  "await-timer 4@12\n";

/* cases/twinrec/claim-order.ts: reactions registered on a source and on its declaration claim run in registration order, recorded from node. */
const CLAIM_ORDER_EXPECTED =
  "src-then-1\n" +
  "claim-then-1\n" +
  "src-await\n" +
  "claim-await\n" +
  "src-then-2\n" +
  "claim-then-2\n" +
  "claim-all\n";

/* cases/twinrec/claim-local.ts: a declaration-claimed promise held in a local before it is returned, recorded from node. */
const CLAIM_LOCAL_EXPECTED =
  "OK late cb null OK,cb null closed\n";

/* cases/twinrec/symbol-class.ts: a class field keyed by a symbol the dependency exports and declares, recorded from node. */
const SYMBOL_CLASS_EXPECTED =
  "false a:6379:t\n" +
  "true\n";

/* cases/twinrec/async-slots.ts: async methods of JavaScript classes rebound at run time (this[name] = fn, Class.prototype.m = fn),
   recorded from node. */
const ASYNC_SLOTS_EXPECTED =
  "pong:a! got:k 3\n" +
  "replaced:k replaced:z\n" +
  "12\n" +
  "late\n" +
  "undefined\n" +
  "got:k pong:o!\n" +
  "ping,get get,ping\n" +
  "11\n" +
  "proto:5 proto:5 1\n" +
  "get,tick\n";

/* cases/twinrec/static-bag.ts: statics assigned after a class that has a base and subclasses, recorded from node. */
const STATIC_BAG_EXPECTED =
  "1 2 b b undefined base function 1:b 1:b s b b\n";

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

async function build(entry: string, name: string, backend: "c" | "llvm") {
  process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
  setProvenanceSources(await resolveProvenanceSources(entry));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}-${backend}.exe` : `${name}-${backend}`);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend, npmStatic: ["twinrec"] });
  return { result, outPath };
}

describe("provenance: a twin class with untyped methods behind a program's own record", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`23850: records, direct generic calls and end() match Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/main.ts");
      const { result, outPath } = await build(entry, "twinrec", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`23850: direct calls of the declared generic, overloaded members match Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/direct.ts");
      const { result, outPath } = await build(entry, "twinrec-direct", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(DIRECT_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24000: the store's executor record lowers and matches Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/store-executor.ts");
      const { result, outPath } = await build(entry, "store-executor", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe("wrote INSERT INTO t\n");
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`23950: a record-armed payload read off a class instance matches Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/record.ts");
      const { result, outPath } = await build(entry, "twinrec-record", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(RECORD_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`23950: a direct generic call whose record-armed payload is read matches Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/direct-record-payload.ts");
      const { result, outPath } = await build(entry, "direct-record-payload", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe("object 0\n");
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24020: a Promise of a record of methods and live members is served by a view of the instance (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/store-pool.ts");
      const { result, outPath } = await build(entry, "store-pool", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(STORE_POOL_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24024: a method that answers another method of its own class as the next state (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/state-machine.ts");
      const { result, outPath } = await build(entry, "state-machine", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(STATE_MACHINE_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24025: a factory table built in a loop closes over the loop's bindings (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/loop-factory.ts");
      const { result, outPath } = await build(entry, "loop-factory", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(LOOP_FACTORY_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24027: a base class's empty options literal holds the members the subclass puts there (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/empty-options.ts");
      const { result, outPath } = await build(entry, "empty-options", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EMPTY_OPTIONS_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24028: a method installed on a prototype by a loop is called through a typed receiver (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/proto-loop.ts");
      const { result, outPath } = await build(entry, "proto-loop", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(PROTO_LOOP_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24029: a method is called through a field that is the class or undefined (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/nullable-receiver.ts");
      const { result, outPath } = await build(entry, "nullable-receiver", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(NULLABLE_RECEIVER_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24045: a declaration-claimed promise is observed on Node's turn (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/claim-ticks.ts");
      const { result, outPath } = await build(entry, "claim-ticks", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(CLAIM_TICKS_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24046: reactions on a promise and on its declaration claim run in registration order (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/claim-order.ts");
      const { result, outPath } = await build(entry, "claim-order", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(CLAIM_ORDER_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24047: a declaration-claimed promise held in a local is the promise the implementation made (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/claim-local.ts");
      const { result, outPath } = await build(entry, "claim-local", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(CLAIM_LOCAL_EXPECTED);
    }, 600_000);

    test(`24043: async methods of JavaScript classes can be rebound at run time and read as values (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/async-slots.ts");
      const { result, outPath } = await build(entry, "async-slots", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(ASYNC_SLOTS_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24048: a class field keyed by an exported symbol that the package declares is one slot (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/symbol-class.ts");
      const { result, outPath } = await build(entry, "symbol-class", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(SYMBOL_CLASS_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24050: statics assigned after a derived class are its own properties and read down the constructor chain (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/static-bag.ts");
      const { result, outPath } = await build(entry, "static-bag", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(STATIC_BAG_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24023: a getter on a projected data member runs once per read (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/store-getter.ts");
      const { result, outPath } = await build(entry, "store-getter", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(STORE_GETTER_EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`24000: a program that writes a field of the payload's record writes the instance (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/record-payload-written.ts");
      const { result, outPath } = await build(entry, "record-payload-written", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe("7\n");
    }, 600_000);
  }
});
