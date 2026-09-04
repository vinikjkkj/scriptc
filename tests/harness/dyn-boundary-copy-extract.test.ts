/* RECOVERING a static array or record OUT of a value that crossed into an
 * `unknown` slot.
 *
 * The crossing COPIES those two kinds and nothing else: a static array is a
 * packed `ScrArr` of 8-byte slots and a record is a monomorphic C struct,
 * neither of which the checked-dynamic tree (a `ScrDyn**` vector / a
 * key-value entry table) can share. Every other composite crosses by
 * REFERENCE — a class instance boxes a retained pointer, a Uint8Array shares
 * one refcounted `ScrBytes`, a Map boxes by reference, a closure boxes the
 * closure — so for those four, identity and mutation are already Node's.
 *
 * `scr_dyn_mark_static_copy` marks the copy when the caller still NAMES the
 * source (`dynCopyIsObservable`), and the mutating dyn entry points refuse
 * through it: a write THROUGH the copy is loud. That covered one half.
 *
 * THE OTHER HALF WAS SILENT, and this file is what closes it. A checked cast
 * back out — `roundTrip(a) as number[]` — built a FRESH `ScrArr`/struct and
 * handed it back, so against Node v25.9.0 at exit 0 with no diagnostic:
 *
 *     a === b                          Node true    scriptc false
 *     b.push(4); JSON.stringify(a)     Node [1,2,3,4]  scriptc [1,2,3]
 *     r === s                          Node true    scriptc false
 *     r.id = 9; s.id                   Node 9       scriptc 1
 *
 * Four wrong answers with no way to see them. They are one refusal now
 * (`scr_dyn_static_copy_extract_refuse`), planted at the SUCCESSFUL EXIT of
 * the array and record dynCheck builders on both backends — at the exit, not
 * the kind gate, so a union arm that does not match still falls through to
 * the next one instead of refusing on a receiver it was never going to take.
 *
 * WHAT THIS FILE DOES NOT CLOSE is pinned at the bottom: reading the dyn
 * value ITSELF after the original was mutated (`JSON.stringify(d)`) still
 * answers the snapshot. Closing that needs the ORIGIN to know it has been
 * snapshotted, which is a representation change, not a walker one.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
/* Deliberately NOT under node_modules: Node refuses to strip types from any
 * file inside one, and every row here runs its own text on Node to get the
 * oracle rather than trusting a literal typed into this file. */
const cellRoot = join(tmpdir(), "scriptc-dyn-boundary-copy-extract");

interface Run {
  out: string;
  code: number;
  err: string;
}

async function run(cmd: string, args: string[]): Promise<Run> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8" });
    return { out: stdout, code: 0, err: "" };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof e.code !== "number") throw err;
    return { out: e.stdout ?? "", code: e.code, err: e.stderr ?? "" };
  }
}

async function bothWays(
  name: string,
  backend: "c" | "llvm",
  src: string,
): Promise<{ node: Run; exe: Run }> {
  const outDir = join(cellRoot, `${name}-${backend}`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "cell.ts");
  writeFileSync(file, src, "utf8");
  const node = await run(process.execPath, [file]);
  const result = await compile(file, {
    outPath: join(outDir, exeName("program")),
    outDir,
    backend,
  });
  if (!result.ok) {
    return {
      node,
      exe: {
        out: "",
        code: -1,
        err: result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      },
    };
  }
  return { node, exe: await run(result.binaryPath, []) };
}

const TRIP = `function roundTrip(v: unknown): unknown { return v }\n`;

/** The shapes that must REFUSE. Each one printed a wrong answer at exit 0
 * before this commit; the second element is what Node really answers, so
 * every row states the divergence it closes rather than only that something
 * throws. The oracle is re-measured from the cell text at run time — the
 * literal is the assertion, not the source of truth. */
const REFUSES: Array<[string, string, string]> = [
  [
    "array-identity",
    `${TRIP}const a: number[] = [1, 2, 3];
const b = roundTrip(a) as number[];
console.log(a === b);`,
    "true",
  ],
  [
    "array-mutation-through-the-recovered-value",
    `${TRIP}const a: number[] = [1, 2, 3];
const b = roundTrip(a) as number[];
b.push(4);
console.log(JSON.stringify(a));`,
    "[1,2,3,4]",
  ],
  [
    "array-mutation-through-the-original",
    `${TRIP}const a: number[] = [1, 2, 3];
const b = roundTrip(a) as number[];
a.push(4);
console.log(JSON.stringify(b));`,
    "[1,2,3,4]",
  ],
  [
    "record-identity",
    `${TRIP}interface Row { id: number }
const r: Row = { id: 1 };
const s = roundTrip(r) as Row;
console.log(r === s);`,
    "true",
  ],
  [
    "record-staleness-read-through-the-recovered-value",
    `${TRIP}interface Row { id: number }
const r: Row = { id: 1 };
const s = roundTrip(r) as Row;
r.id = 9;
console.log(s.id);`,
    "9",
  ],
  [
    "record-write-through-the-recovered-value",
    `${TRIP}interface Row { id: number }
const r: Row = { id: 1 };
const s = roundTrip(r) as Row;
s.id = 9;
console.log(r.id);`,
    "9",
  ],
  [
    // A key added to the ORIGINAL after the crossing: absent from the copy,
    // present in Node's one object.
    "index-signature-absent-key",
    `${TRIP}const o: Record<string, number> = { a: 1 };
const back = roundTrip(o) as Record<string, number>;
o["b"] = 2;
console.log(back["b"]);`,
    "2",
  ],
  [
    // The crossing is a FIELD read, not a bare name — dynCopyIsObservable
    // admits every lvalue, and the recovery must refuse for all of them.
    "crossing-from-a-field",
    `${TRIP}interface Holder { rows: number[] }
const h: Holder = { rows: [1, 2] };
const b = roundTrip(h.rows) as number[];
console.log(h.rows === b);`,
    "true",
  ],
  [
    // A TUPLE target reads a dyn ARRAY through the record builder's own
    // tuple branch, which is a third exit and needed its own guard.
    "tuple-target",
    `${TRIP}const t: [number, string] = [1, 'a'];
const b = roundTrip(t) as [number, string];
console.log(t === b);`,
    "true",
  ],
  [
    // Reached across a real call boundary rather than through a local
    // round-trip helper: the parameter is the `unknown` slot.
    "across-a-callee",
    `interface Cfg { retries: number }
function readBack(v: unknown): Cfg { return v as Cfg }
const cfg: Cfg = { retries: 1 };
const seen = readBack(cfg);
cfg.retries = 5;
console.log(seen.retries);`,
    "5",
  ],
];

describe.each(["c", "llvm"] as const)(
  "recovering an array or record out of a boundary copy REFUSES (%s backend)",
  (backend) => {
    test.for(REFUSES)("%s", { timeout: 240_000 }, async ([name, src, nodeSays]) => {
      const { node, exe } = await bothWays(name, backend, src);
      // The oracle first: a cell whose Node run failed proves nothing about
      // the compiler and would otherwise pass by comparing two failures.
      expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
      expect(node.out.trim(), "the divergence this row records has moved").toBe(nodeSays);
      expect(
        exe.code,
        `exit 0 means the wrong answer is BACK and silent — it printed ${JSON.stringify(
          exe.out.trim(),
        )} where Node says ${JSON.stringify(nodeSays)}`,
      ).not.toBe(0);
      expect(exe.err).toMatch(/crossed into an 'unknown' \(dynamic\) slot/);
      expect(exe.err).toMatch(/recovering (an array|a record|a tuple)/);
    });
  },
);

/** The shapes that must NOT refuse, because nothing was copied. A guard at
 * this boundary is one wrong condition away from refusing these, and the
 * corpus cannot see it: `tests/corpus/7460` covers the by-reference kinds
 * byte-for-byte, and these cover the two receivers that carry no origin at
 * all. */
const LANDS: Array<[string, string]> = [
  [
    // Nothing crossed FROM a static original: JSON.parse builds the dyn.
    "parsed-dyn-record",
    `const d: unknown = JSON.parse('{"id":7}');
const r = d as { id: number };
r.id = 8;
console.log(r.id);`,
  ],
  [
    "parsed-dyn-array",
    `const d: unknown = JSON.parse('[1,2,3]');
const a = d as number[];
a.push(4);
console.log(JSON.stringify(a));`,
  ],
  [
    // A TEMPORARY: the caller names nothing, so no divergence is
    // observable and dynCopyIsObservable declines to mark the copy.
    "temporary-record",
    `${TRIP}const tmp = roundTrip({ id: 3 }) as { id: number };
console.log(tmp.id);`,
  ],
  [
    "temporary-array",
    `${TRIP}const tmp = roundTrip([1, 2]) as number[];
tmp.push(3);
console.log(JSON.stringify(tmp));`,
  ],
  [
    // A union whose ARRAY arm does not match: the guard sits at the
    // successful exit, so the string arm is still reachable.
    "union-arm-falls-through-a-marked-receiver",
    `const s = 'hi';
function pick(v: unknown): number[] | string { return v as number[] | string }
console.log(pick(s));`,
  ],
];

describe.each(["c", "llvm"] as const)(
  "a receiver that was never copied still recovers (%s backend)",
  (backend) => {
    test.for(LANDS)("%s", { timeout: 240_000 }, async ([name, src]) => {
      const { node, exe } = await bothWays(name, backend, src);
      expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
      expect(node.out.trim().length).toBeGreaterThan(0);
      expect(exe.code, `compiled program failed:\n${exe.err}`).toBe(0);
      expect(exe.out).toBe(node.out);
    });
  },
);

describe("the remainder this commit does NOT close", () => {
  /* Reading the DYN VALUE ITSELF after the original was mutated. The
   * snapshot is exact at the moment of the crossing and goes stale the
   * instant the original moves, and no cast is involved, so the guard at
   * the recovery cannot see it.
   *
   * Closing it needs the ORIGIN to know it has been snapshotted — a flag on
   * `ScrArr` checked by the in-place array mutators, and a flag on the
   * record struct checked by the emitted field stores of every shape some
   * observable crossing in the program reaches. That is a representation
   * change across both backends, and it is measured rather than guessed in
   * the block report.
   *
   * This test asserts the CURRENT WRONG ANSWER on purpose: when a future
   * block closes it, this test fails, and that failure is the notification.
   */
  test.for([
    [
      "record",
      `interface Row { id: number }
const r: Row = { id: 1 };
const d: unknown = r;
r.id = 9;
console.log(JSON.stringify(d));`,
      '{"id":9}',
      '{"id":1}',
    ],
    [
      "array",
      `const a: number[] = [1, 2, 3];
const d: unknown = a;
a.push(4);
console.log(JSON.stringify(d));`,
      "[1,2,3,4]",
      "[1,2,3]",
    ],
  ] as const)(
    "a read through the dyn value itself still sees the snapshot (%s)",
    { timeout: 480_000 },
    async ([name, src, nodeSays, scriptcSays]) => {
      for (const backend of ["c", "llvm"] as const) {
        const { node, exe } = await bothWays(`stale-${name}`, backend, src);
        expect(node.out.trim()).toBe(nodeSays);
        expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
        expect(
          exe.out.trim(),
          `${backend}: if this now prints ${nodeSays} the remainder is CLOSED — delete this row and move it into a REFUSES or a matching row`,
        ).toBe(scriptcSays);
      }
    },
  );
});
