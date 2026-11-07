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
import { closeSync, openSync, writeSync } from "node:fs";
import type { IrModule } from "./nodes.js";

/* 4: NaN joined the $nonfinite sentinels. The bump is not ceremony — a
 * version-3 reader meeting {"$nonfinite":"nan"} falls through its ternary to
 * -Infinity, which is a silent wrong number, so the two formats must not be
 * mistakable for each other. */
export const IR_VERSION = 4 as const;

/* THE ENCODER IS OURS, NOT JSON.stringify, FOR ONE REASON: SIZE. JSON.stringify builds the whole document as ONE string,
 * and V8 caps a string at 2^29-24 (about 536.8 MB). zapo's memory-store bench lowers to a 526 MB document, one step under
 * the cap, and the sqlite and mysql arms of the same bench are over it: `--emit-ir` died with `RangeError: Invalid string
 * length` AFTER the whole build had been paid for. So this walks the module and hands the text to a sink in ~1 MiB
 * chunks; the file writer never holds more than one chunk.
 *
 * IT MUST BE BYTE-IDENTICAL to `JSON.stringify(mod, replacer, 2)` -- readers, caches and diffs depend on the bytes -- so it
 * reproduces that algorithm's observable rules exactly: toJSON is applied before the replacer; undefined / function /
 * symbol drop an object member and print `null` in an array; an empty object or array prints `{}` / `[]` on one line;
 * members print in Object.keys order; strings go through JSON.stringify (well-formed escaping of lone surrogates); a
 * BigInt throws. tests/harness/ir-serialize-stream.test.ts pins the equality on every one of those, and on the sentinels.
 * A cyclic value is not detected (JSON.stringify throws TypeError): the IR is a tree by construction and a cycle would
 * overflow the stack here instead -- recorded, not guarded, because a guard costs a Set insert per node on a 500 MB walk. */
type Sink = (chunk: string) => void;

const CHUNK = 1 << 20;

const INDENTS: string[] = ["\n"];
function indentOf(depth: number): string {
  let s = INDENTS[depth];
  if (s === undefined) {
    s = INDENTS[depth - 1]! + "  ";
    INDENTS[depth] = s;
  }
  return s;
}

/** JSON.stringify of an object key, memoised: an IR has a few hundred distinct keys repeated millions of times. */
const keyText = new Map<string, string>();
function keyOf(k: string): string {
  let t = keyText.get(k);
  if (t === undefined) {
    t = JSON.stringify(k) + ": ";
    keyText.set(k, t);
  }
  return t;
}

/** The original serializer's replacer, kept for the NATIVE path below (a subtree small enough for one string). */
function irReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) return { $nonfinite: "nan" };
    return { $nonfinite: value > 0 ? "inf" : "-inf" };
  }
  if (typeof value === "number" && Object.is(value, -0)) return { $nonfinite: "-0" };
  return value;
}

/** Subtrees at this depth and below go through the engine's own JSON.stringify (native, several times faster than a JS walk) and are
 * re-indented to their depth; only the levels above are walked here, which is what keeps the document from ever existing as one
 * string. A subtree is one IR function / class / global: far below V8's string cap; if one is not, the walk descends into it. */
const NATIVE_DEPTH = 2;

/** `\n` inside the stringified subtree is always a structural newline (a newline inside a string is escaped), so adding the
 * subtree's depth of indentation after each one reproduces what a whole-document stringify prints there. */
function nativeText(v: unknown, depth: number): string | null {
  try {
    const t = JSON.stringify(v, irReplacer, 2);
    if (t === undefined) return null;
    return depth === 0 ? t : t.split("\n").join(indentOf(depth));
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** The text of the sentinel object `{ $nonfinite: tag }` the original replacer substituted for the numbers JSON cannot spell. */
function sentinel(tag: string, depth: number): string {
  return "{" + indentOf(depth + 1) + '"$nonfinite": "' + tag + '"' + indentOf(depth) + "}";
}

/** True when the value prints nothing: an object member holding it drops, an array slot prints `null`. */
function unprintable(v: unknown): boolean {
  return v === undefined || typeof v === "function" || typeof v === "symbol";
}

/** Appends `v` -- the member `key` of its holder, already read -- at `depth`. Applies toJSON first, then the original replacer's
 * number rules, then prints; every rule is JSON.stringify's own. The caller has already dropped unprintable values. */
function emitValue(v: unknown, key: string | number, depth: number, out: { buf: string }, sink: Sink): void {
  switch (typeof v) {
    case "string": out.buf += JSON.stringify(v); return;
    case "number":
      if (v !== v) { out.buf += sentinel("nan", depth); return; }
      if (v === Infinity) { out.buf += sentinel("inf", depth); return; }
      if (v === -Infinity) { out.buf += sentinel("-inf", depth); return; }
      if (v === 0 && 1 / v < 0) { out.buf += sentinel("-0", depth); return; }
      out.buf += String(v);
      return;
    case "boolean": out.buf += v ? "true" : "false"; return;
    case "bigint": throw new TypeError("Do not know how to serialize a BigInt");
    case "object": break;
    default: out.buf += "null"; return;
  }
  if (v === null) { out.buf += "null"; return; }
  const withToJson = v as { toJSON?: unknown };
  if (typeof withToJson.toJSON === "function") {
    const r = (withToJson as { toJSON: (k: string) => unknown }).toJSON(String(key));
    if (unprintable(r)) { out.buf += "null"; return; } // only reachable for an array slot: an object member was dropped by the caller's own read of the same value
    emitValue(r, key, depth, out, sink);
    return;
  }
  if (depth >= NATIVE_DEPTH) {
    const t = nativeText(v, depth);
    if (t !== null) { out.buf += t; return; }
  }
  const inner = indentOf(depth + 1);
  if (Array.isArray(v)) {
    const n = v.length;
    if (n === 0) { out.buf += "[]"; return; }
    out.buf += "[";
    for (let i = 0; i < n; i++) {
      out.buf += i === 0 ? inner : "," + inner;
      const item = v[i];
      if (unprintable(item)) out.buf += "null";
      else if (typeof item === "object" && item !== null && typeof (item as { toJSON?: unknown }).toJSON === "function") {
        const r = (item as { toJSON: (k: string) => unknown }).toJSON(String(i));
        if (unprintable(r)) out.buf += "null";
        else emitValue(r, i, depth + 1, out, sink);
      } else emitValue(item, i, depth + 1, out, sink);
      if (out.buf.length >= CHUNK) { sink(out.buf); out.buf = ""; }
    }
    out.buf += indentOf(depth) + "]";
    return;
  }
  const rec = v as Record<string, unknown>;
  let first = true;
  for (const k in rec) {
    if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
    let item = rec[k];
    if (typeof item === "object" && item !== null && typeof (item as { toJSON?: unknown }).toJSON === "function") {
      item = (item as { toJSON: (k: string) => unknown }).toJSON(k);
    }
    if (unprintable(item)) continue;
    if (first) { out.buf += "{" + inner; first = false; } else out.buf += "," + inner;
    out.buf += keyOf(k);
    emitValue(item, k, depth + 1, out, sink);
    if (out.buf.length >= CHUNK) { sink(out.buf); out.buf = ""; }
  }
  out.buf += first ? "{}" : indentOf(depth) + "}";
}

/** The IR as JSON text, delivered to `sink` in chunks of about 1 MiB. Byte-identical to JSON.stringify(mod, replacer, 2). */
export function emitModuleJson(mod: IrModule, sink: Sink): void {
  const out = { buf: "" };
  if (unprintable(mod)) throw new TypeError("IR module is not serializable");
  emitValue(mod, "", 0, out, sink);
  if (out.buf.length > 0) sink(out.buf);
}

/** The IR as ONE string: for small programs and tests. A module past V8's string cap needs writeModuleFile. */
export function serializeModule(mod: IrModule): string {
  const parts: string[] = [];
  emitModuleJson(mod, (c) => parts.push(c));
  return parts.join("");
}

/** Streams the IR to `path` chunk by chunk (no document-sized string ever exists). */
export function writeModuleFile(path: string, mod: IrModule): void {
  const fd = openSync(path, "w");
  try {
    emitModuleJson(mod, (c) => writeSync(fd, c));
  } finally {
    closeSync(fd);
  }
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
