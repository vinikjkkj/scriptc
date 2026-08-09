/* Accounting for the two kinds zapo's SC1101 actually fences on:
 * `bytes<buf>` (ArrayBuffer, the SCR_DYN_ARRBUF box) and `childStream`
 * (child stdio, the SCR_DYNH_CHILD_STREAM handle).
 *
 * Both are stated TWICE by construction — once in a TypeScript table the
 * emitters read, once in a C enum the runtime reads — and in both cases
 * the second copy is a NUMBER or a SPELLING that no build step compares
 * against the first. The failure mode is not a build error:
 *
 *  * a wrong `DYN_HANDLE_TAG_NUM` row makes the LLVM lane box a child
 *    stream under some other unit's tag, and the ops table dispatches it
 *    into that unit's invoke — a mis-tagged handle, discovered at run
 *    time as nonsense or a crash. This table sat unchecked until now
 *    while its ScrDynKind sibling had a test; childStream is the first
 *    row added to it since, which is a good moment to close the gap;
 *  * a `DYN_BYTES_KINDS` row naming a kind the header does not have is a
 *    C compile error in a 133 MB generated file, which is a bad place to
 *    read one;
 *  * an element admitted by one direction's predicate and not the other
 *    strands values: they widen into `unknown` and can never come back.
 *    That is the method-bundle failure nodes.ts already records from the
 *    last time it happened, and it is invisible until a program tries.
 *
 * So each table is checked against the header it is a copy of, and each
 * direction is checked against the other.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DK, DYN_HANDLE_TAG_NUM } from "../src/backend/llvm/dyn.js";
import {
  canConvertToDyn,
  canDynCheckTo,
  DYN_BYTES_KINDS,
  DYN_HANDLE_KINDS,
  isDynBytes,
} from "../src/ir/nodes.js";
import type { IrBytesElem, IrType } from "../src/ir/nodes.js";

const repoRoot = join(import.meta.dirname, "../../..");
const headerPath = join(repoRoot, "packages/runtime/src/scr_runtime.h");

/** The declaration-order member names of a comment-stripped C enum whose
 * members carry no `= n` initialisers — so POSITION is the value, which
 * is the fragile part every table below copies. */
function enumMembers(header: string, typeName: string, prefix: string): string[] {
  const body = new RegExp(`typedef enum[^{]*\\{([\\s\\S]*?)\\} ${typeName};`).exec(header)?.[1];
  expect(body, `${typeName} not found in scr_runtime.h`).toBeDefined();
  const stripped = body!.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(new RegExp(`\\b${prefix}(\\w+)\\b`, "g"))].map((m) => m[1]!);
}

const ALL_BYTES_ELEMS: readonly IrBytesElem[] = ["u8", "u32", "i32", "f32", "f64", "i8", "buf"];
const bytes = (elem: IrBytesElem): IrType => ({ kind: "bytes", elem });
const noRecords = (): undefined => undefined;
const noUnions = (): undefined => undefined;

describe("the ArrayBuffer box and the child-stream handle", () => {
  test("the LLVM lane's handle TAG numbers are the C enum's, position by position", async () => {
    const header = await readFile(headerPath, "utf8");
    const names = enumMembers(header, "ScrDynHandleTag", "SCR_DYNH_");
    // COUNT is the sentinel, never a tag.
    expect(names.at(-1)).toBe("COUNT");
    const positions = new Map(names.map((n, i) => [n, i]));
    // Every row this lane emits must name a real tag and carry its
    // position. Rows are a SUBSET on purpose — the comment in dyn.ts says
    // so: tags this lane has never emitted are deliberately absent rather
    // than guessed, and absence is an honest LlvmUnsupportedError while a
    // wrong number is a mis-tagged handle.
    expect(Object.keys(DYN_HANDLE_TAG_NUM).length).toBeGreaterThan(0);
    for (const [irKind, num] of Object.entries(DYN_HANDLE_TAG_NUM)) {
      const tag = DYN_HANDLE_KINDS.get(irKind);
      expect(tag, `${irKind} has an LLVM tag number but is not a DYN_HANDLE_KINDS entry`)
        .toBeDefined();
      const member = tag!.tag.replace(/^SCR_DYNH_/, "");
      expect(positions.get(member), `${tag!.tag} is not a ScrDynHandleTag member`).toBeDefined();
      expect(num, `${irKind} (${tag!.tag}) has the wrong LLVM tag number`)
        .toBe(positions.get(member));
    }
    // childStream specifically: the row this test was written for.
    expect(DYN_HANDLE_TAG_NUM.childStream).toBe(positions.get("CHILD_STREAM"));
  });

  test("every DYN_HANDLE_KINDS tag is a real ScrDynHandleTag member", async () => {
    const header = await readFile(headerPath, "utf8");
    const names = new Set(enumMembers(header, "ScrDynHandleTag", "SCR_DYNH_"));
    for (const [irKind, { tag }] of DYN_HANDLE_KINDS) {
      expect(names.has(tag.replace(/^SCR_DYNH_/, "")), `${irKind} names a missing tag ${tag}`)
        .toBe(true);
    }
    expect(DYN_HANDLE_KINDS.has("childStream")).toBe(true);
  });

  test("every DYN_BYTES_KINDS row names a real ScrDynKind, and the LLVM lane agrees", async () => {
    const header = await readFile(headerPath, "utf8");
    const names = new Set(enumMembers(header, "ScrDynKind", "SCR_DYN_"));
    for (const [elem, { kind, dk }] of DYN_BYTES_KINDS) {
      expect(names.has(kind.replace(/^SCR_DYN_/, "")), `bytes<${elem}> names a missing ${kind}`)
        .toBe(true);
      // The C lane writes the kind by NAME and the LLVM lane by NUMBER;
      // the two must be the same kind or one backend boxes an ArrayBuffer
      // as a typed array.
      expect(DK[dk], `bytes<${elem}>'s LLVM kind number is missing`).toBeDefined();
      expect(kind).toBe(`SCR_DYN_${dk}`);
    }
    // The pair this change is about, spelled out so a silent shrink of
    // the table fails here rather than in a zapo build.
    expect([...DYN_BYTES_KINDS.keys()].sort()).toEqual(["buf", "u8"]);
  });

  test("u8 and buf are DIFFERENT dyn kinds — the whole safety argument", () => {
    // If this ever collapses to one kind, dynMatch's kind-only test lets a
    // Uint8Array match an ArrayBuffer union arm and the union takes the
    // wrong tag; the keyed read answers a length and indices Node calls
    // undefined; and `u instanceof Uint8Array` answers true for a buffer.
    // Three silent wrong answers behind one shared tag, which is why the
    // split is asserted rather than merely commented.
    expect(DYN_BYTES_KINDS.get("u8")!.kind).not.toBe(DYN_BYTES_KINDS.get("buf")!.kind);
    expect(DK.BYTES).not.toBe(DK.ARRBUF);
  });

  test("the bytes elements cross in EXACTLY the directions the table lists", () => {
    for (const elem of ALL_BYTES_ELEMS) {
      const t = bytes(elem);
      const admitted = DYN_BYTES_KINDS.has(elem);
      // isDynBytes is the one spelling of the element test; the two
      // direction predicates must agree with it and with each other. An
      // element admitted IN but not OUT strands every value that crosses.
      expect(isDynBytes(t), `isDynBytes disagrees with the table for bytes<${elem}>`)
        .toBe(admitted);
      expect(canConvertToDyn(t, noRecords, noUnions), `bytes<${elem}> IN`).toBe(admitted);
      expect(canDynCheckTo(t, noRecords, noUnions), `bytes<${elem}> OUT`).toBe(admitted);
    }
  });

  test("every runtime HANDLE kind crosses in BOTH directions", () => {
    for (const irKind of DYN_HANDLE_KINDS.keys()) {
      const t = { kind: irKind } as unknown as IrType;
      expect(canConvertToDyn(t, noRecords, noUnions), `${irKind} IN`).toBe(true);
      expect(canDynCheckTo(t, noRecords, noUnions), `${irKind} OUT`).toBe(true);
    }
  });

  test("a bytes<buf> LEAF crosses nested, which is the shape zapo actually has", () => {
    // zapo's twenty sites are not a bare ArrayBuffer: they are
    // `{ type, media: Uint8Array | ArrayBuffer | Readable | string }`
    // flowing into an `unknown` parameter, so the ArrayBuffer is a UNION
    // ARM inside a RECORD FIELD. Admitting only the bare type would have
    // left the gate exactly where it was — which is the mistake a control
    // that widens a bare value cannot catch.
    const unionId = "u0";
    const shapeId = "r0";
    const media: IrType = { kind: "union", unionId };
    const arms: IrType[] = [bytes("u8"), bytes("buf"), { kind: "childStream" }, { kind: "string" }];
    const getUnion = (id: string) => (id === unionId ? { id, arms } : undefined);
    const getRecord = (id: string) =>
      id === shapeId
        ? { id, fields: [{ name: "type", type: { kind: "string" } as IrType }, { name: "media", type: media }] }
        : undefined;
    const rec: IrType = { kind: "record", shapeId };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    expect(canConvertToDyn(media, getRecord as any, getUnion as any), "the media union widens")
      .toBe(true);
    expect(canConvertToDyn(rec, getRecord as any, getUnion as any), "the content record widens")
      .toBe(true);
    // Drop the ArrayBuffer arm and it must STILL widen — the control that
    // proves the arm is what was blocking, not the union's shape.
    const armsNoBuf = arms.filter((a) => !(a.kind === "bytes" && a.elem === "buf"));
    const getUnionNoBuf = (id: string) => (id === unionId ? { id, arms: armsNoBuf } : undefined);
    expect(canConvertToDyn(media, getRecord as any, getUnionNoBuf as any)).toBe(true);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
});
