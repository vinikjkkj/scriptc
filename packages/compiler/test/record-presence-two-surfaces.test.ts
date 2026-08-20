/* ONE SLOT, TWO RULES — why a one-sided presence fix moves the error
 * instead of removing it.
 *
 * `per-instance-keys.test.ts` pins the premise: `{ a?: T }` and
 * `{ a: T | undefined }` intern to ONE record shape, so "written undefined"
 * and "never written" have one representation and must get one answer. This
 * file pins what the CONSUMERS then do with that one slot, because they do
 * two different things and neither of them is wrong on its own:
 *
 *   Object.keys / `in` / Object.hasOwn   guard on the undefined arm's tag —
 *     the key exists exactly when the arm is not undefined
 *     (recordKeysArrayCall, lower-calls.ts). Right for the OMITTED optional,
 *     wrong for the required `T | undefined` that JS says always exists.
 *
 *   util.inspect / console.log            walk the shape's declaredOrder and
 *     emit an entry for EVERY declared field, unconditionally
 *     (lower-inspect.ts, the `case "record"` arm). Right for the required
 *     `T | undefined`, wrong for the OMITTED optional.
 *
 * So for any one value the two surfaces disagree with each other, and each is
 * Node-exact for the spelling the other gets wrong. Measured both ways
 * (estado-lastseven.md section 2):
 *
 *   - teaching inspect the tag test turns a 61-program population generated
 *     from the Node oracle from AGREE 23 / DIFFER 38 into AGREE 50 /
 *     DIFFER 11 on BOTH backends, with zero AGREE -> DIFFER;
 *   - and it turns `tests/corpus/1632-inspect-records.ts` RED, because that
 *     fixture pins the other spelling (`a: number | undefined` written
 *     `undefined`, which Node prints).
 *
 * The only fix that is not a trade is per-field optionality inside the
 * shape's interned IDENTITY, which splits the two spellings into two shapes
 * with identical layouts and gives every surface both answers. Until then,
 * THIS TEST IS THE TRIPWIRE: change one of the two rules and it fails, and
 * the failure message is the reason.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import type { IrFunction, IrModule, IrStmt } from "../src/ir/nodes.js";

function lower(source: string): IrModule | null {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-presence-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  try {
    return lowerToIr(load.program, load.entry, load.moduleOrder).module;
  } finally {
    load.dispose();
  }
}

/** Every node of `n` whose `kind` is `kind`, in walk order. */
function nodesOfKind(n: unknown, kind: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const walk = (x: unknown): void => {
    if (x === null || typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    const o = x as Record<string, unknown>;
    if (o["kind"] === kind) out.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(n);
  return out;
}

/** The interned helper `prefix` names whose FIRST parameter is the record
 * itself. Several inspect helpers are interned per program (one per type
 * reached, unions included) and only one of them walks the record. */
function recordHelper(mod: IrModule, prefix: string): IrFunction | undefined {
  return mod.functions.find(
    (f) => f.name.startsWith(prefix) && f.params[0]?.type.kind === "record",
  );
}

/** The statements of `body` that are `if`s whose condition tests a union's
 * undefined arm — the presence guard, wherever it is spelled. */
function presenceGuards(body: IrStmt[]): number {
  return nodesOfKind(body, "if").filter((s) => {
    const cond = s["cond"] as Record<string, unknown> | undefined;
    return cond !== undefined && cond["kind"] === "unionIsTag";
  }).length;
}

const PROGRAM = `
interface M { readonly a: number; readonly b?: number; readonly c?: string }
const m: M = { a: 1 };
console.log(Object.keys(m).join("|"));
console.log(m);
`;

test("the two spellings are still ONE shape, so one rule has to serve both", () => {
  const mod = lower(`
interface A { a: number; b?: number }
interface B { a: number; b: number | undefined }
const x: A = { a: 1 };
const y: B = { a: 1, b: undefined };
console.log(x.a, y.a);
`);
  expect(mod).not.toBeNull();
  // ONE record, not two: the premise this whole file rests on.
  expect((mod!.records ?? []).length).toBe(1);
});

test("Object.keys GUARDS the key on the undefined arm", () => {
  const mod = lower(PROGRAM);
  expect(mod).not.toBeNull();
  const keys = recordHelper(mod!, "%obj.keys.");
  expect(keys, "the interned Object.keys helper should exist").toBeDefined();
  // Two optional fields, two guards; the required one pushes unconditionally.
  expect(presenceGuards(keys!.body)).toBe(2);
});

test("util.inspect emits every declared field UNCONDITIONALLY", () => {
  const mod = lower(PROGRAM);
  expect(mod).not.toBeNull();
  const insp = recordHelper(mod!, "%util.insp.");
  expect(insp, "the interned util.inspect helper should exist").toBeDefined();
  // Three declared fields, three `insp.entry` calls, and NOT ONE of them is
  // under a presence guard. Flip this and 1632-inspect-records.ts goes red;
  // leave it and every record printed with an absent optional key prints a
  // key its own Object.keys says it does not have.
  const entries = nodesOfKind(insp!.body, "libCall").filter((e) => e["fn"] === "insp.entry");
  expect(entries.length).toBe(3);
  expect(presenceGuards(insp!.body)).toBe(0);
});
