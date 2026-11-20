/* localeCompare(that, locales, options) and `new Intl.Collator(locales, options).compare(a, b)` over a collator that is known at compile time.
 *
 * The collation engine (scr_collate.c) is the CLDR ROOT collation with the four ECMA-402 knobs it runs natively: sensitivity (strength and the
 * case level), caseFirst, numeric and ignorePunctuation. A collator is therefore folded to one `mode` number when its locale and options are
 * literals, and a locale that the engine cannot serve (a tailored language, a collation type, usage "search", a tag shape this reader does
 * not parse) is a named COMPILE-time refusal: a run-time answer in the root order for `sv` or `de-u-co-phonebk` would be silently wrong, and
 * a run-time throw would be a refusal that moved. Which languages collate differently from the root is MEASURED, not assumed:
 * collator-locales.ts is generated from Node's own ICU (scripts/gen-collator-locales.mjs). */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { TAILORED_LANGS, TAILORED_VARIANTS } from "./collator-locales.js";

const peel = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
};

/** The string a node provably is (a literal type, through const bindings), or undefined for "not a string literal". */
function literalString(L: Lowerer, node: ts.Expression): string | undefined {
  const t = L.typeOf(peel(node));
  return t.isStringLiteralType() ? t.value : undefined;
}

function isUndefinedNode(L: Lowerer, node: ts.Expression): boolean {
  return (L.typeOf(peel(node)).flags & ts.TypeFlags.Undefined) !== 0;
}

/** A boolean literal (`true` / `false`, also through a const), or undefined. */
function literalBool(L: Lowerer, node: ts.Expression): boolean | undefined {
  const t = L.typeOf(peel(node));
  if ((t.flags & ts.TypeFlags.BooleanLiteral) === 0) return undefined;
  const s = L.checker.typeToString(t);
  return s === "true" ? true : s === "false" ? false : undefined;
}

interface TagKeys { numeric?: boolean; caseFirst?: number }

/** One locale tag: its collation-relevant `-u-` keys, or a refusal naming why the root engine cannot serve it. */
function readTag(L: Lowerer, tag: string, blame: ts.Node): TagKeys {
  const refuse = (why: string): never =>
    L.noLowering(`a '${tag}' collation locale`, blame, why);
  const lower = tag.toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(lower)) return refuse("not a well-formed language tag (Node throws a RangeError for it)");
  const sub = lower.split("-");
  if (!/^[a-z]{2,3}$/.test(sub[0]!)) return refuse("only a two- or three-letter language subtag is read");
  let i = 1;
  let script: string | undefined;
  let region: string | undefined;
  if (sub[i] !== undefined && /^[a-z]{4}$/.test(sub[i]!)) script = sub[i++];
  if (sub[i] !== undefined && /^([a-z]{2}|[0-9]{3})$/.test(sub[i]!)) region = sub[i++];
  if (TAILORED_LANGS.has(sub[0]!)) {
    return refuse(`'${sub[0]}' is a TAILORED collation (its order differs from the root the runtime implements; the tailoring rules have no lowering yet)`);
  }
  if (region !== undefined && TAILORED_VARIANTS.has(`${sub[0]}-${region.toUpperCase()}`)) {
    return refuse(`'${sub[0]}-${region}' is a TAILORED collation (its order differs from the root the runtime implements)`);
  }
  if (script !== undefined && TAILORED_VARIANTS.has(`${sub[0]}-${script[0]!.toUpperCase()}${script.slice(1)}`)) {
    return refuse(`'${sub[0]}-${script}' is a TAILORED collation (its order differs from the root the runtime implements)`);
  }
  const keys: TagKeys = {};
  if (i < sub.length) {
    if (sub[i] !== "u") return refuse("only the language, script, region and a '-u-' extension are read (a variant, private-use or other extension subtag changes nothing the compiler can prove)");
    i++;
    while (i < sub.length) {
      const key = sub[i]!;
      if (!/^[a-z0-9][a-z]$/.test(key)) return refuse("a '-u-' attribute is not read");
      i++;
      const vals: string[] = [];
      while (i < sub.length && sub[i]!.length > 2) vals.push(sub[i++]!);
      if (key === "kn") {
        if (vals.length === 0 || (vals.length === 1 && vals[0] === "true")) keys.numeric = true;
        else if (vals.length === 1 && vals[0] === "false") keys.numeric = false;
        else return refuse("a '-u-kn' value other than true or false");
      } else if (key === "kf") {
        if (vals.length === 1 && (vals[0] === "upper" || vals[0] === "lower" || vals[0] === "false")) keys.caseFirst = vals[0] === "upper" ? 1 : vals[0] === "lower" ? 2 : 0;
        else return refuse("a '-u-kf' value other than upper, lower or false");
      } else if (key === "co") {
        return refuse("a collation type ('-u-co-') selects another rule set");
      } else {
        return refuse(`a '-u-${key}' key (the compiler reads only kn and kf)`);
      }
    }
  }
  return keys;
}

/** The `mode` number (see IrStrIntrinsicMethod "localeCompareMode") of a collator whose locales and options are compile-time known. */
export function collatorModeOf(L: Lowerer, locales: ts.Expression | undefined, options: ts.Expression | undefined, blame: ts.Node): number {
  let strength = 3, caseLevel = 0, caseFirst = 0, numeric = 0, ignore = 0;
  if (locales !== undefined && !isUndefinedNode(L, locales)) {
    const e = peel(locales);
    const tags: { text: string; node: ts.Expression }[] = [];
    const one = literalString(L, e);
    if (one !== undefined) {
      tags.push({ text: one, node: e });
    } else if (ts.isArrayLiteralExpression(e) && e.elements.every((x) => !ts.isSpreadElement(x) && literalString(L, x) !== undefined)) {
      for (const x of e.elements) tags.push({ text: literalString(L, x)!, node: x });
    } else {
      L.noLowering(
        "a collation locale that is not a string literal",
        locales,
        "the collator is resolved at compile time: write the locale as a literal (or an array of literals), because a tailored locale cannot be answered at run time",
      );
    }
    const keys = tags.map((t) => readTag(L, t.text, t.node));
    if (tags.length > 1 && keys.some((k) => k.numeric !== undefined || k.caseFirst !== undefined)) {
      L.noLowering("a list of collation locales carrying '-u-' keys", locales, "which entry the runtime would pick depends on ICU's availability list");
    }
    const k = keys[0];
    if (k !== undefined) {
      if (k.numeric !== undefined) numeric = k.numeric ? 1 : 0;
      if (k.caseFirst !== undefined) caseFirst = k.caseFirst;
    }
  }
  if (options !== undefined && !isUndefinedNode(L, options)) {
    const o = peel(options);
    if (!ts.isObjectLiteralExpression(o)) {
      L.noLowering("collator options that are not an object literal", options, "write the options as an object literal of literal values");
    }
    for (const p of (o as ts.ObjectLiteralExpression).properties) {
      let name: string | undefined;
      let valueNode: ts.Expression | undefined;
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) { name = (p.name as ts.Identifier).text; valueNode = p.initializer; }
      else if (ts.isShorthandPropertyAssignment(p)) { name = (p.name as ts.Identifier).text; valueNode = p.name as unknown as ts.Expression; }
      else L.noLowering("a collator option that is not a plain property", p, "write each option as `name: literal`");
      if (name === undefined || valueNode === undefined) continue;
      if (isUndefinedNode(L, valueNode)) continue;
      const str = literalString(L, valueNode);
      const bad = (what: string): never => L.noLowering(`collator option ${name}: ${what}`, valueNode!, "write the option as a literal Node accepts");
      switch (name) {
        case "usage":
          if (str === "sort") break;
          bad(str === "search" ? "usage 'search' selects the search collation" : "not 'sort'");
          break;
        case "localeMatcher":
          if (str === "lookup" || str === "best fit") break;
          bad("not 'lookup' or 'best fit'");
          break;
        case "collation":
          bad("a collation type selects another rule set");
          break;
        case "sensitivity":
          if (str === "base") { strength = 1; caseLevel = 0; }
          else if (str === "accent") { strength = 2; caseLevel = 0; }
          else if (str === "case") { strength = 1; caseLevel = 1; }
          else if (str === "variant") { strength = 3; caseLevel = 0; }
          else bad("not base, accent, case or variant");
          break;
        case "caseFirst":
          if (str === "upper") caseFirst = 1;
          else if (str === "lower") caseFirst = 2;
          else if (str === "false") caseFirst = 0;
          else bad("not upper, lower or false");
          break;
        case "numeric":
        case "ignorePunctuation": {
          const b = literalBool(L, valueNode);
          if (b === undefined) bad("not a boolean literal");
          if (name === "numeric") numeric = b ? 1 : 0;
          else ignore = b ? 1 : 0;
          break;
        }
        default:
          break; // an option the collator never reads
      }
    }
  }
  void blame;
  return strength | (caseLevel << 2) | (caseFirst << 3) | (numeric << 5) | (ignore << 6);
}
