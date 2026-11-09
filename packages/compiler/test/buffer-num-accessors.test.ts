/* The Buffer numeric accessor names the emitters route to scr_dyn_invoke_bufnum (BUFFER_NUM_ACCESSOR_METHODS) must be exactly the rows of
 * dyn_bufnum_rows in the runtime: a name the table lacks would find no row and fall back to the general invoke (slow, never wrong), and a row
 * the set lacks is merely not fast. This pins the two lists together so neither drifts silently. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BUFFER_NUM_ACCESSOR_METHODS } from "../src/ir/nodes.js";

describe("Buffer numeric accessor names", () => {
  test("the compiler's set equals the runtime's dyn_bufnum_rows", () => {
    const src = readFileSync(join(import.meta.dirname, "../../runtime/src/scr_dyn_invoke.c"), "utf8");
    const start = src.indexOf("static const DynBufNum dyn_bufnum_rows[] = {");
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf("\n};", start);
    const rows = [...src.slice(start, end).matchAll(/\{ "(\w+)",/g)].map((m) => m[1]!);
    expect(rows.length).toBe(50);
    expect([...BUFFER_NUM_ACCESSOR_METHODS].sort()).toEqual([...rows].sort());
  });
  test("a planted missing name is detected (positive control)", () => {
    const withoutOne = new Set(BUFFER_NUM_ACCESSOR_METHODS);
    withoutOne.delete("writeUInt8");
    const src = readFileSync(join(import.meta.dirname, "../../runtime/src/scr_dyn_invoke.c"), "utf8");
    const rows = [...src.slice(src.indexOf("dyn_bufnum_rows[] = {"), src.indexOf("\n};", src.indexOf("dyn_bufnum_rows[] = {"))).matchAll(/\{ "(\w+)",/g)].map((m) => m[1]!);
    expect([...withoutOne].sort()).not.toEqual([...rows].sort());
  });
});
