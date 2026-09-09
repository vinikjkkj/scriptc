/* IR ↔ JSON. The IR is plain JSON-safe data by construction; the value of
 * this module is the version fence and the non-finite sentinels — a numLit
 * holds a JS number, and JSON can spell neither the infinities, nor -0, nor
 * NaN, so each rides an object no IR number could otherwise be.
 *
 * THIS FILE USED TO SAY "NaN/Infinity literals cannot appear in source" and
 * refused NaN as a frontend bug. Both halves were wrong, and the compiler's
 * own lowering is the proof:
 *
 *   lower-exprs.ts:1523      the `NaN` global identifier -> numLit(NaN)
 *   lower-builtins.ts:8783   NUMBER_CONSTANTS.NaN = NaN, under a comment
 *                            reading "numLits carry NaN and the infinities;
 *                            both backends spell them"
 *
 * So the IR legitimately carries NaN, both emitters emit it, and only this
 * module objected. It cost a 27-minute `--emit-ir` build of zapo, which
 * lowered, compiled, wrote all fifteen C translation units, and then refused
 * to serialise — because zapo writes `Number.NaN` in two places, one of them
 * the MCP server's runtime. Any program with a NaN literal could not be
 * dumped at all.
 */
import type { IrModule } from "./nodes.js";

/* 4: NaN joined the $nonfinite sentinels. The bump is not ceremony — a
 * version-3 reader meeting {"$nonfinite":"nan"} falls through its ternary to
 * -Infinity, which is a silent wrong number, so the two formats must not be
 * mistakable for each other. */
export const IR_VERSION = 4 as const;

export function serializeModule(mod: IrModule): string {
  return JSON.stringify(mod, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      // ±Infinity and NaN numLits are all real — the globals `Infinity` and
      // `NaN`, and `Number.POSITIVE_INFINITY` / `Number.NaN`. JSON can spell
      // none of them, so each rides a sentinel object no other IR value can
      // be (numbers never serialize as objects).
      if (Number.isNaN(value)) return { $nonfinite: "nan" };
      return { $nonfinite: value > 0 ? "inf" : "-inf" };
    }
    // JSON.stringify(-0) prints "0", silently losing the sign a numLit's
    // f64 semantics depend on (String(-0) is "0" but 1/-0 is -Infinity) —
    // the same sentinel mechanism carries it.
    if (typeof value === "number" && Object.is(value, -0)) {
      return { $nonfinite: "-0" };
    }
    return value;
  }, 2);
}

export function deserializeModule(json: string): IrModule {
  const mod = JSON.parse(json, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null && "$nonfinite" in value) {
      const tag = (value as { $nonfinite: string }).$nonfinite;
      return tag === "inf" ? Infinity
        : tag === "nan" ? NaN
        : tag === "-0" ? -0
        : -Infinity;
    }
    return value;
  }) as IrModule;
  if (mod.irVersion !== IR_VERSION) {
    throw new Error(
      `IR version mismatch: file has ${String(mod.irVersion)}, compiler expects ${IR_VERSION}`,
    );
  }
  return mod;
}
