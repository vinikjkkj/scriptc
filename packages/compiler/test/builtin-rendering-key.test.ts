/* The two pure functions IrRecordShape.builtin rests on, and the one
 * invariant the "no existing shape's numbering moves" claim rests on.
 *
 * `builtinRenderingKey` joins the shape interner's key. If an ABSENT or
 * EMPTY rendering contributed anything at all, every shape in every
 * program would get a new key and every shape id would renumber — which
 * order-parity.json would notice loudly, but only after a full corpus
 * run, and only as 1,782 changed entries with no explanation attached.
 * This file is the cheap statement of the same fact.
 *
 * `slotStorageKey` is the other half: it decides WHERE an internal
 * field's cell lives in the dyn slot table, and it is called by both
 * backends in BOTH directions of the boundary. A field the shape does
 * not name a symbol for must answer its own name unchanged, or a shape
 * that acquires a rendering would silently move a cell the recovery side
 * still looks for under the old key.
 */
import { describe, expect, test } from "vitest";
import { builtinRenderingKey, slotStorageKey } from "../src/ir/nodes.js";
import type { IrRecordShape } from "../src/ir/nodes.js";

const shape = (b: IrRecordShape["builtin"]): IrRecordShape =>
  ({ id: "r0", fields: [], ...(b ? { builtin: b } : {}) });

describe("builtinRenderingKey", () => {
  test("an absent or empty rendering contributes NOTHING to the interner key", () => {
    expect(builtinRenderingKey(undefined)).toBe("");
    expect(builtinRenderingKey({})).toBe("");
    expect(builtinRenderingKey({ slotSymbols: {} })).toBe("");
  });

  test("each member on its own makes the key non-empty", () => {
    expect(builtinRenderingKey({ ctorName: "Dirent" })).not.toBe("");
    expect(builtinRenderingKey({ nullProto: true })).not.toBe("");
    expect(builtinRenderingKey({ slotSymbols: { "%dtype": "type" } })).not.toBe("");
  });

  test("different renderings key differently — a user twin cannot inherit one", () => {
    const dirent = builtinRenderingKey({ ctorName: "Dirent", slotSymbols: { "%dtype": "type" } });
    const decoder = builtinRenderingKey({ ctorName: "StringDecoder" });
    expect(dirent).not.toBe(decoder);
    expect(dirent).not.toBe("");
    expect(decoder).not.toBe("");
    // ...and a shape with NO rendering keys apart from both of them, which
    // is what separates fs.Dirent's row from a user's structurally equal
    // `{ name, parentPath, "%dtype" }`.
    expect(builtinRenderingKey(undefined)).not.toBe(dirent);
  });

  test("the symbol map is order-insensitive: one rendering, one key", () => {
    const a = builtinRenderingKey({ slotSymbols: { "%a": "x", "%b": "y" } });
    const b = builtinRenderingKey({ slotSymbols: { "%b": "y", "%a": "x" } });
    expect(a).toBe(b);
  });
});

describe("slotStorageKey", () => {
  test("an unnamed internal field keeps its own name", () => {
    expect(slotStorageKey(shape(undefined), "%dtype")).toBe("%dtype");
    expect(slotStorageKey(shape({ ctorName: "StringDecoder" }), "%pending")).toBe("%pending");
  });

  test("a named one travels under Node's symbol description", () => {
    const s = shape({ ctorName: "Dirent", slotSymbols: { "%dtype": "type" } });
    expect(slotStorageKey(s, "%dtype")).toBe("type");
  });

  test("a field the map does not mention is unaffected by the map's presence", () => {
    const s = shape({ slotSymbols: { "%dtype": "type" } });
    expect(slotStorageKey(s, "%pending")).toBe("%pending");
  });

  test("the storage key never begins with '%' when it names a symbol, and always does when it does not", () => {
    // This is the whole of the runtime's rendering rule (scr_inspect.c:
    // a slot key that does not begin with '%' is a Node symbol
    // description). It is stated in two places on purpose; this is where
    // the two are checked against each other.
    const named = shape({ slotSymbols: { "%dtype": "type" } });
    expect(slotStorageKey(named, "%dtype").startsWith("%")).toBe(false);
    expect(slotStorageKey(shape(undefined), "%dtype").startsWith("%")).toBe(true);
  });
});
