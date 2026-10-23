/* Number.prototype.toLocaleString(locales, options) / BigInt.prototype.toLocaleString and
 * new Intl.NumberFormat(locales, options).format(x): lowered onto the intl.numFormat libCalls (scr_nf.c over the ICU
 * locale data). The locales text and the option bag cross as plain strings: a literal folds at compile time, a
 * typed value converts at the call, and an options RECORD is read field by field through one lifted helper. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { BOOL, F64, STRING, arrayOf, type IrExpr, type IrType, type SrcLoc } from "../../ir/nodes.js";
import { locOf } from "../program.js";

/** Every option Intl.NumberFormat reads; the runtime looks them up by name, in V8's own order. */
export const NUMBER_FORMAT_OPTION_KEYS: readonly string[] = [
  "localeMatcher", "numberingSystem", "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay",
  "notation", "minimumIntegerDigits", "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits",
  "maximumSignificantDigits", "roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay",
  "compactDisplay", "useGrouping", "signDisplay",
];

function strip(n: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(n) || ts.isAssertionExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) {
    n = (n as ts.ParenthesizedExpression).expression;
  }
  return n;
}
const lit = (value: string, loc: SrcLoc): IrExpr => ({ kind: "strLit", value, type: STRING, loc });
const cat = (a: IrExpr, b: IrExpr, loc: SrcLoc): IrExpr => ({ kind: "strConcat", left: a, right: b, type: STRING, loc });
const isUndefinedIdent = (n: ts.Expression): boolean => ts.isIdentifier(n) && n.text === "undefined";

/** The locales argument as one string: "" for the default locale (absent, undefined or an empty list), tags joined by
 * "," for several. An EMPTY tag is not the default locale (V8 throws RangeError for it), so it travels as "-", which
 * is not a structurally valid tag. */
const emptyTag = (s: string): string => (s === "" ? "-" : s);
function nonEmptyText(v: IrExpr, loc: SrcLoc): IrExpr {
  return {
    kind: "ternary",
    cond: { kind: "strEq", negated: false, left: v, right: lit("", loc), type: BOOL, loc },
    then: lit("-", loc),
    else_: v,
    type: STRING,
    loc,
  };
}
export function numberLocalesText(L: Lowerer, node: ts.Expression | undefined, loc: SrcLoc): IrExpr {
  if (node === undefined) return lit("", loc);
  const n = strip(node);
  if (isUndefinedIdent(n)) return lit("", loc);
  if (ts.isStringLiteralLike(n)) return lit(emptyTag(n.text), loc);
  if (ts.isArrayLiteralExpression(n) && n.elements.every((e) => ts.isStringLiteralLike(strip(e)))) {
    return lit(n.elements.map((e) => emptyTag((strip(e) as ts.StringLiteralLike).text)).join(","), loc);
  }
  const t = L.mapTypeOf(L.typeOf(node));
  if (t?.kind === "string") {
    const helper = emptyTextHelper(L, loc);
    return { kind: "call", callee: helper, args: [L.lowerExprExpecting(node, STRING)], type: STRING, loc };
  }
  if (t?.kind === "array" && t.elem.kind === "string") {
    return { kind: "arrIntrinsic", method: "join", receiver: L.lowerExpr(node), args: [lit(",", loc)], type: STRING, loc };
  }
  if (t?.kind === "union") {
    // string | undefined, string[] | undefined
    const def = L.unions.get(t.unionId);
    const undefTag = def?.arms.findIndex((a) => a.kind === "undefinedT") ?? -1;
    const rest = def?.arms.map((_, i) => i).filter((i) => i !== undefTag) ?? [];
    if (def && undefTag >= 0 && rest.length === 1) {
      const arm = def.arms[rest[0]!]!;
      const helper = unionTextHelper(L, t, arm, loc);
      if (helper !== null) return { kind: "call", callee: helper, args: [L.lowerExpr(node)], type: STRING, loc };
    }
  }
  return L.noLowering(
    `a locales argument of type '${L.checker.typeToString(L.typeOf(node))}'`,
    node,
    "a locales argument is a string, an array of strings or undefined",
  );
}
/** A lifted `(v: string) => string` mapping "" to "-" (the value evaluates once, as the call's argument). */
function emptyTextHelper(L: Lowerer, loc: SrcLoc): string {
  const key = "nfloc:empty";
  const existing = L.arrHofHelpers.get(key);
  if (existing) return existing;
  const name = `%nfloc.${L.arrHofHelpers.size}`;
  L.arrHofHelpers.set(key, name);
  const v: IrExpr = { kind: "varRef", localId: "v.0", type: STRING, loc };
  L.liftedFns.push({
    name,
    params: [{ localId: "v.0", name: "v", type: STRING }],
    returnType: STRING,
    locals: [{ id: "v.0", name: "v", type: STRING, mutable: false }],
    body: [{ kind: "return", value: nonEmptyText(v, loc), loc }],
    loc,
  });
  return name;
}
function unionTextHelper(L: Lowerer, t: IrType & { kind: "union" }, arm: IrType, loc: SrcLoc): string | null {
  const key = `nfloc:${t.unionId}`;
  const existing = L.arrHofHelpers.get(key);
  if (existing) return existing;
  const def = L.unions.get(t.unionId);
  if (!def) return null;
  const undefTag = def.arms.findIndex((a) => a.kind === "undefinedT");
  const tag = def.arms.findIndex((_, i) => i !== undefTag);
  const v: IrExpr = { kind: "varRef", localId: "v.0", type: t, loc };
  const picked: IrExpr = { kind: "unionNarrow", unionId: t.unionId, tag, value: v, type: arm, loc };
  let text: IrExpr;
  if (arm.kind === "string") text = nonEmptyText(picked, loc);
  else if (arm.kind === "array" && arm.elem.kind === "string") text = { kind: "arrIntrinsic", method: "join", receiver: picked, args: [lit(",", loc)], type: STRING, loc };
  else return null;
  const body: IrExpr = {
    kind: "ternary",
    cond: { kind: "unionIsTag", unionId: t.unionId, tag: undefTag, negated: false, value: v, type: BOOL, loc },
    then: lit("", loc),
    else_: text,
    type: STRING,
    loc,
  };
  const name = `%nfloc.${L.arrHofHelpers.size}`;
  L.arrHofHelpers.set(key, name);
  L.liftedFns.push({
    name,
    params: [{ localId: "v.0", name: "v", type: t }],
    returnType: STRING,
    locals: [{ id: "v.0", name: "v", type: t, mutable: false }],
    body: [{ kind: "return", value: body, loc }],
    loc,
  });
  return name;
}

/** V8's per-kind default-formatter cache (scr_locale.h): toLocale*String(locales, undefined) with a string or undefined
 * locales is "cacheable"; the call carries the marker entry in its option bag. */
const CACHE_KEY = "\x01k";
function localesCacheable(L: Lowerer, node: ts.Expression | undefined): boolean {
  if (node === undefined) return true;
  const n = strip(node);
  if (isUndefinedIdent(n) || ts.isStringLiteralLike(n)) return true;
  if (ts.isArrayLiteralExpression(n)) return false;
  const t = L.mapTypeOf(L.typeOf(node));
  if (t?.kind === "string") return true;
  if (t?.kind === "union") {
    const def = L.unions.get(t.unionId);
    return def !== undefined && def.arms.every((a) => a.kind === "string" || a.kind === "undefinedT");
  }
  return false;
}
function cacheMarkerKv(loc: SrcLoc): IrExpr {
  return { kind: "arrayLit", elems: [lit(CACHE_KEY, loc), lit("", loc)], type: arrayOf(STRING), loc };
}

/** The tagged text of a value of type `t` held in the pure re-emittable expression `v` ('s' string, 'n' number,
 * 'b' boolean, 'u' undefined), or null when the type has no scalar reading. */
function taggedOf(L: Lowerer, v: IrExpr, loc: SrcLoc): IrExpr | null {
  const t = v.type;
  if (t.kind === "string") return cat(lit("s", loc), v, loc);
  if (t.kind === "f64") return cat(lit("n", loc), { kind: "toString", operand: v, type: STRING, loc }, loc);
  if (t.kind === "bool") return cat(lit("b", loc), { kind: "toString", operand: v, type: STRING, loc }, loc);
  if (t.kind === "undefinedT") return lit("u", loc);
  if (t.kind !== "union") return null;
  const def = L.unions.get(t.unionId);
  if (!def) return null;
  let out: IrExpr | null = null;
  for (let i = def.arms.length - 1; i >= 0; i--) {
    const arm = def.arms[i]!;
    let val: IrExpr | null;
    if (arm.kind === "undefinedT") val = lit("u", loc);
    else if (arm.kind === "string" || arm.kind === "f64" || arm.kind === "bool") {
      val = taggedOf(L, { kind: "unionNarrow", unionId: t.unionId, tag: i, value: v, type: arm, loc }, loc);
    } else return null;
    if (val === null) return null;
    out = out === null ? val : {
      kind: "ternary",
      cond: { kind: "unionIsTag", unionId: t.unionId, tag: i, negated: false, value: v, type: BOOL, loc },
      then: val,
      else_: out,
      type: STRING,
      loc,
    };
  }
  return out;
}

function taggedHelper(L: Lowerer, t: IrType, loc: SrcLoc): string | null {
  const key = `nftag:${JSON.stringify(t)}`;
  const existing = L.arrHofHelpers.get(key);
  if (existing) return existing;
  const probe = taggedOf(L, { kind: "varRef", localId: "v.0", type: t, loc }, loc);
  if (probe === null) return null;
  const name = `%nftag.${L.arrHofHelpers.size}`;
  L.arrHofHelpers.set(key, name);
  L.liftedFns.push({
    name,
    params: [{ localId: "v.0", name: "v", type: t }],
    returnType: STRING,
    locals: [{ id: "v.0", name: "v", type: t, mutable: false }],
    body: [{ kind: "return", value: probe, loc }],
    loc,
  });
  return name;
}

function optionValue(L: Lowerer, key: string, node: ts.Expression, loc: SrcLoc, what: string): IrExpr {
  const n = strip(node);
  if (isUndefinedIdent(n)) return lit("u", loc);
  if (ts.isStringLiteralLike(n)) return lit("s" + n.text, loc);
  if (ts.isNumericLiteral(n)) return lit("n" + String(Number(n.text)), loc);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return lit("n" + String(-Number(n.operand.text)), loc);
  if (n.kind === ts.SyntaxKind.TrueKeyword) return lit("btrue", loc);
  if (n.kind === ts.SyntaxKind.FalseKeyword) return lit("bfalse", loc);
  const v = L.lowerExpr(node);
  const direct = v.type.kind === "string" || v.type.kind === "f64" || v.type.kind === "bool" ? taggedOf(L, v, loc) : null;
  if (direct !== null) return direct;
  const helper = taggedHelper(L, v.type, loc);
  if (helper === null) {
    return L.noLowering(
      `${what} option '${key}' of type '${L.fmt(v.type)}'`,
      node,
      "an option value is a string, a number or a boolean (or that or undefined)",
    );
  }
  return { kind: "call", callee: helper, args: [v], type: STRING, loc };
}

/** The options argument as a string[] of alternating option name and tagged value. */
export function numberOptionsKv(
  L: Lowerer,
  node: ts.Expression | undefined,
  loc: SrcLoc,
  pre?: IrExpr,
  keys: readonly string[] = NUMBER_FORMAT_OPTION_KEYS,
  what = "Intl.NumberFormat",
): IrExpr {
  const empty: IrExpr = { kind: "arrayLit", elems: [], type: arrayOf(STRING), loc };
  if (node === undefined) return empty;
  const n = strip(node);
  if (isUndefinedIdent(n)) return empty;
  if (
    ts.isObjectLiteralExpression(n) &&
    n.properties.every((p) => (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) || ts.isShorthandPropertyAssignment(p))
  ) {
    const elems: IrExpr[] = [];
    for (const p of n.properties) {
      const pa = p as ts.PropertyAssignment | ts.ShorthandPropertyAssignment;
      const k = (pa.name as ts.Identifier | ts.StringLiteral).text;
      if (!keys.includes(k)) continue; // not an option the constructor reads
      const valueNode: ts.Expression = ts.isShorthandPropertyAssignment(pa) ? (pa.name as ts.Identifier) : pa.initializer;
      elems.push(lit(k, locOf(p)), optionValue(L, k, valueNode, locOf(p), what));
    }
    return { kind: "arrayLit", elems, type: arrayOf(STRING), loc };
  }
  const rec = pre ?? L.lowerExpr(node);
  if (rec.type.kind !== "record") {
    return L.noLowering(`${what} options of type '${L.fmt(rec.type)}'`, node, "pass an object literal or a record value");
  }
  const helper = recordHelper(L, rec.type, loc, node, keys, what);
  return { kind: "call", callee: helper, args: [rec], type: arrayOf(STRING), loc };
}

function recordHelper(L: Lowerer, recT: IrType & { kind: "record" }, loc: SrcLoc, diag: ts.Node, keys: readonly string[], what: string): string {
  const key = `nfopts:${keys === NUMBER_FORMAT_OPTION_KEYS ? "" : what}:${JSON.stringify(recT)}`;
  const existing = L.arrHofHelpers.get(key);
  if (existing) return existing;
  const shape = L.shapes.get(recT.shapeId);
  if (!shape) L.noLowering(`${what} options of an unknown shape`, diag);
  const rec: IrExpr = { kind: "varRef", localId: "o.0", type: recT, loc };
  const elems: IrExpr[] = [];
  for (const k of keys) {
    const f = shape!.fields.find((x) => x.name === k);
    if (!f) continue;
    const got: IrExpr = { kind: "recordGet", obj: rec, shapeId: recT.shapeId, field: k, type: f.type, loc };
    const direct = f.type.kind === "string" || f.type.kind === "f64" || f.type.kind === "bool" ? taggedOf(L, got, loc) : null;
    const val = direct ?? (f.type.kind === "union" ? taggedOf(L, got, loc) : null);
    if (val === null) {
      L.noLowering(`${what} option '${k}' of type '${L.fmt(f.type)}'`, diag, "an option value is a string, a number or a boolean (or that or undefined)");
    }
    elems.push(lit(k, loc), val!);
  }
  const name = `%nfopts.${L.arrHofHelpers.size}`;
  L.arrHofHelpers.set(key, name);
  L.liftedFns.push({
    name,
    params: [{ localId: "o.0", name: "o", type: recT }],
    returnType: arrayOf(STRING),
    locals: [{ id: "o.0", name: "o", type: recT, mutable: false }],
    body: [{ kind: "return", value: { kind: "arrayLit", elems, type: arrayOf(STRING), loc }, loc }],
    loc,
  });
  return name;
}

/** The call: value (a number or a bigint IR value), locales node, options node. */
export function lowerNumberLocaleFormat(
  L: Lowerer,
  value: IrExpr,
  localesNode: ts.Expression | undefined,
  optionsNode: ts.Expression | undefined,
  loc: SrcLoc,
  cacheable = false,
): IrExpr {
  const locales = numberLocalesText(L, localesNode, loc);
  let pre: IrExpr | undefined;
  if (optionsNode !== undefined && !isUndefinedIdent(strip(optionsNode)) && !ts.isObjectLiteralExpression(strip(optionsNode))) {
    pre = L.lowerExpr(optionsNode);
    if (pre.type.kind === "dyn") {
      if (value.type.kind === "f64") return { kind: "libCall", fn: "intl.numFormatDyn", args: [value, locales, pre], type: STRING, loc };
      const digits: IrExpr = { kind: "libCall", fn: "big.str", args: [value, { kind: "numLit", value: 10, type: F64, loc }], type: STRING, loc };
      return { kind: "libCall", fn: "intl.numFormatBigDyn", args: [digits, locales, pre], type: STRING, loc };
    }
  }
  const unmarked = optionsNode === undefined || isUndefinedIdent(strip(optionsNode));
  const kv = cacheable && unmarked && localesCacheable(L, localesNode) ? cacheMarkerKv(loc) : numberOptionsKv(L, optionsNode, loc, pre);
  if (value.type.kind === "f64") return { kind: "libCall", fn: "intl.numFormat", args: [value, locales, kv], type: STRING, loc };
  if (value.type.kind === "bigint") {
    const digits: IrExpr = { kind: "libCall", fn: "big.str", args: [value, { kind: "numLit", value: 10, type: F64, loc }], type: STRING, loc };
    return { kind: "libCall", fn: "intl.numFormatBig", args: [digits, locales, kv], type: STRING, loc };
  }
  throw new Error("lowerNumberLocaleFormat: not a number");
}

/** Every option Intl.DateTimeFormat reads, in V8's reading order (scr_dtf.c validates in this order). */
export const DATE_FORMAT_OPTION_KEYS: readonly string[] = [
  "localeMatcher", "calendar", "numberingSystem", "hour12", "hourCycle", "timeZone", "weekday", "era", "year",
  "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName",
  "formatMatcher", "dateStyle", "timeStyle",
];

/** `new Intl.DateTimeFormat(locales, options).format(x)` and the toLocale*String twins (kind 4 / 5 / 6 / 7): the
 * time value `ms` formatted by scr_date_format_opts (scr_dtf.c over the ICU locale data). */
export function lowerDateLocaleFormat(
  L: Lowerer,
  ms: IrExpr,
  kind: number,
  localesNode: ts.Expression | undefined,
  optionsNode: ts.Expression | undefined,
  loc: SrcLoc,
  what: string,
): IrExpr {
  const locales = numberLocalesText(L, localesNode, loc);
  let pre: IrExpr | undefined;
  if (optionsNode !== undefined && !isUndefinedIdent(strip(optionsNode)) && !ts.isObjectLiteralExpression(strip(optionsNode))) {
    pre = L.lowerExpr(optionsNode);
    if (pre.type.kind === "dyn") {
      return { kind: "libCall", fn: "date.formatOptsDyn", args: [ms, { kind: "numLit", value: kind, type: F64, loc }, locales, pre], type: STRING, loc };
    }
  }
  const unmarked = optionsNode === undefined || isUndefinedIdent(strip(optionsNode));
  const kv = kind >= 4 && kind <= 6 && unmarked && localesCacheable(L, localesNode)
    ? cacheMarkerKv(loc)
    : numberOptionsKv(L, optionsNode, loc, pre, DATE_FORMAT_OPTION_KEYS, what);
  return { kind: "libCall", fn: "date.formatOpts", args: [ms, { kind: "numLit", value: kind, type: F64, loc }, locales, kv], type: STRING, loc };
}
