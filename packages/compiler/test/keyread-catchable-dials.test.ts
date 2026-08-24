/* THE TWO DESTINATIONS THAT COST NO WIDTH, and the dials that price them.
 *
 * `estado-abort13` §3.1 sorts zapo's thirteen `ABORT.real` call sites into
 * two real invariants, seven reachable states that need a DESTINATION
 * widened first, and FOUR that are defects today: the read whose value is
 * CALLED (`CONSOLE_WRITERS[level](…)`, twice) and the read whose value has
 * a MEMBER taken off it (`AB_PROP_CONFIGS[name].defaultValue`, twice). At
 * both consumers JS itself throws — catchably, with a message — so neither
 * needs a wider slot anywhere downstream:
 *
 *   SCRIPTC_CALLKEY_OFF=1   `T[k](a, b)`   Node: `T[k] is not a function`
 *   SCRIPTC_RECVKEY_OFF=1   `T[k].f`       Node: `Cannot read properties
 *                                                 of undefined (reading 'f')`
 *
 * THE HAZARD THIS FILE IS ARMED AGAINST is the one every rung in this
 * family carries: a DECLINE has to be a byte-identical TU, not merely a
 * program that still compiles. The call rung declines four shapes — a
 * computed key, a call key, an omitted trailing argument, a method call
 * through the receiver — and each of them is a shape whose Node message
 * scriptc either cannot reproduce or whose lowering it does not own.
 *
 * The SECOND hazard is the message itself. `getText()` is not V8's
 * spelling: Node prints `FNS[k]` for the source `FNS[k as K]`, because the
 * CallPrinter reconstructs the access from the AST. Where v8CalleeText
 * cannot reproduce the spelling the rung declines rather than shipping a
 * plausible-looking wrong one — a refusal replaced by a wrong answer is
 * worse than the refusal.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

const TABLES = `type K = 'a' | 'b';
const FNS: Record<K, (m: string, n: string) => void> = {
  a: (m: string, n: string) => { console.log('a ' + m + n); },
  b: (m: string, n: string) => { console.log('b ' + m + n); },
};
interface Row { v: string }
const ROWS: Record<K, Row> = { a: { v: 'A' }, b: { v: 'B' } };
const k = process.argv[2] ?? 'a';
`;

/* The CALL consumer, alone. */
const P_CALL = `${TABLES}FNS[k as K]('x', 'y');
export {};
`;

/* The MEMBER consumer, alone. */
const P_MEMBER = `${TABLES}console.log(ROWS[k as K].v);
export {};
`;

/* Every shape both rungs must decline, and nothing they must not. */
const P_DECL = `${TABLES}interface Obj { m(): string }
const OBJS: Record<K, Obj> = { a: { m: () => 'A' }, b: { m: () => 'B' } };
const OPT: Record<K, (m: string, n?: string) => void> = {
  a: (m: string) => { console.log('a ' + m); },
  b: (m: string) => { console.log('b ' + m); },
};
function key(): K { return k as K }
FNS[(k + '') as K]('x', 'y');
FNS[key()]('x', 'y');
OPT[k as K]('x');
console.log(OBJS[k as K].m());
ROWS[k as K].v = 'Z';
[ROWS[k as K].v] = ['Z'];
delete (ROWS as unknown as Record<string, Record<string, string>>)[k].v;
export {};
`;

const count = (tu: string, re: RegExp): number => (tu.match(re) ?? []).length;

/* The MISS path the emitter plants for a keyed read at a non-armed width —
 * the abort this branch exists to route away from. */
const TRAP = /scr_trap_fmt\("scriptc: TypeError: record has no key/g;
/* V8's own two messages, spelled by the two rungs. */
const NOT_FN = /"FNS\[k\] is not a function"/g;
const NO_PROPS = /"Cannot read properties of undefined \(reading 'v'\)"/g;
/* This project's mark for a deferred compile fence inside a coded throw.
 * `census.mjs` counts every bracket occurrence in a file as a trap, so a
 * rung that introduced one would move a historical number. */
const FENCE_BRACKET = /\[SC\d{4}/g;

const DIALS = ["SCRIPTC_CALLKEY_OFF", "SCRIPTC_RECVKEY_OFF"] as const;

let dir: string | undefined;
let seq = 0;

async function emit(
  program: string,
  off: readonly string[],
  backend: "c" | "llvm" = "c",
): Promise<{ tu: string; diags: string[] }> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-callkey-"));
  // The emitted TU carries its entry path, so two variants differ by their
  // FILENAME before they differ by a lowering; the tag is padded so the two
  // paths are the same length and the name is normalised out below.
  const tag = String(seq++).padStart(4, "0");
  const src = join(dir, `main-${tag}.ts`);
  await writeFile(src, program, "utf8");
  const saved = DIALS.map((x) => [x, process.env[x]] as const);
  try {
    for (const x of DIALS) delete process.env[x];
    for (const x of off) process.env[x] = "1";
    const res = await compile(src, {
      outPath: join(dir, `program-${tag}`),
      outDir: dir,
      backend,
      emitOnly: true,
    });
    if (!res.ok) return { tu: "", diags: res.diagnostics.map((x) => x.message) };
    const tu = await readFile(res.cPath, "utf8");
    return { tu: tu.split(`main-${tag}.ts`).join("main.ts").split(`program-${tag}`).join("program"), diags: [] };
  } finally {
    for (const [x, v] of saved) {
      if (v === undefined) delete process.env[x];
      else process.env[x] = v;
    }
  }
}

describe("the two keyed-read consumers that throw the way Node throws", () => {
  test("the CALL consumer trades the abort for Node's own text", async () => {
    const off = await emit(P_CALL, ["SCRIPTC_CALLKEY_OFF"]);
    expect(off.diags).toEqual([]);
    // Non-trivial: the read really does abort with the rung ablated.
    expect(count(off.tu, TRAP)).toBeGreaterThan(0);
    expect(count(off.tu, NOT_FN)).toBe(0);

    const on = await emit(P_CALL, []);
    expect(on.diags).toEqual([]);
    expect(count(on.tu, TRAP)).toBe(0);
    // V8's spelling, not `getText()`'s: the source says `FNS[k as K]`.
    expect(count(on.tu, NOT_FN)).toBe(1);
    expect(on.tu).not.toContain("k as K is not a function");
  }, 300_000);

  test("the MEMBER consumer trades it for Node's receiver message", async () => {
    const off = await emit(P_MEMBER, ["SCRIPTC_RECVKEY_OFF"]);
    expect(off.diags).toEqual([]);
    expect(count(off.tu, TRAP)).toBeGreaterThan(0);
    expect(count(off.tu, NO_PROPS)).toBe(0);

    const on = await emit(P_MEMBER, []);
    expect(on.diags).toEqual([]);
    expect(count(on.tu, TRAP)).toBe(0);
    expect(count(on.tu, NO_PROPS)).toBe(1);
  }, 300_000);

  test("each dial changes its OWN program and no other", async () => {
    for (const [dial, program] of [
      ["SCRIPTC_CALLKEY_OFF", P_CALL],
      ["SCRIPTC_RECVKEY_OFF", P_MEMBER],
    ] as const) {
      const on = await emit(program, []);
      const mine = await emit(program, [dial]);
      expect(mine.diags, dial).toEqual([]);
      // Load-bearing: ablating it changes the emitted TU...
      expect(mine.tu, dial).not.toBe(on.tu);
      // ...and it is the ONLY one that does.
      const all = await emit(program, DIALS);
      expect(all.tu, dial).toBe(mine.tu);
      const other = DIALS.filter((d) => d !== dial);
      const notMine = await emit(program, other);
      expect(notMine.tu, `${dial}: the other dial moved this program`).toBe(on.tu);
    }
  }, 600_000);

  test("every DECLINED shape keeps a byte-identical TU", async () => {
    const on = await emit(P_DECL, []);
    expect(on.diags).toEqual([]);
    // The declines still abort — that is what makes this a decline and not
    // a program with nothing to say.
    expect(count(on.tu, TRAP)).toBeGreaterThan(0);
    const off = await emit(P_DECL, DIALS);
    expect(off.diags).toEqual([]);
    expect(off.tu).toBe(on.tu);
  }, 600_000);

  test("nothing becomes a compile-time fence, and no bracket is introduced", async () => {
    for (const [name, program] of [["call", P_CALL], ["member", P_MEMBER], ["decline", P_DECL]] as const) {
      const on = await emit(program, []);
      expect(on.diags, name).toEqual([]);
      expect(count(on.tu, FENCE_BRACKET), name).toBe(0);
    }
  }, 600_000);

  test("the LLVM lane carries the same two messages", async () => {
    const call = await emit(P_CALL, [], "llvm");
    expect(call.diags).toEqual([]);
    expect(call.tu).toContain("FNS[k] is not a function");
    const member = await emit(P_MEMBER, [], "llvm");
    expect(member.diags).toEqual([]);
    expect(member.tu).toContain("Cannot read properties of undefined (reading 'v')");
  }, 600_000);
});
