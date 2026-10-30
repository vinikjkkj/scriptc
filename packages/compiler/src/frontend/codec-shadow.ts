/**
 * The WHATWG codec globals (`TextEncoder`, `TextDecoder`) under an AMBIENT
 * redeclaration in a program module.
 *
 * npm packages that run on Node often spell their own types for these
 * globals, in a module that is not the standard library:
 *
 *     type TextDecoder = { readonly fatal: boolean; decode(input?: Uint8Array): string; ... };
 *     declare const TextDecoder: TextDecoderConstructor;
 *
 * (bson's utils/web_byte_utils.ts and parse_utf8.ts). A `declare const`
 * emits NOTHING: at run time the reference is the global, so Node runs the
 * real TextDecoder whatever the declared shape says. The lowering therefore
 * takes the identity of the global, exactly as it does for `declare const
 * Buffer` (buffer-refinement.ts), and only when the declared shape is PROVEN
 * to be a subset of the codec's own members with the same callability. A
 * declared member the codec does not have, or a method declared as a
 * property (or the reverse), is not the global's shape and stays a
 * non-stdlib symbol.
 */
import * as ts from "./ts7/adapter.js";

/** Each codec interface's own members (WHATWG Encoding, Node 24): kind by name. */
const CODEC_MEMBERS: Readonly<Record<string, Readonly<Record<string, "prop" | "method">>>> = {
  TextEncoder: { encoding: "prop", encode: "method", encodeInto: "method" },
  TextDecoder: { encoding: "prop", fatal: "prop", ignoreBOM: "prop", decode: "method" },
};

export type CodecGlobalName = "TextEncoder" | "TextDecoder";

export interface CodecShadowCtx {
  readonly checker: ts.TypeChecker;
  readonly isStdlibFile: (sf: ts.SourceFile) => boolean;
}

const memo = new WeakMap<ts.Symbol, CodecGlobalName | null>();

/** The codec global a symbol stands for, when the symbol is an ambient
 * `declare const TextEncoder|TextDecoder` (plus its same-named module type
 * alias) whose declared shape is proven; null otherwise. */
export function ambientCodecName(ctx: CodecShadowCtx, symbol: ts.Symbol | undefined): CodecGlobalName | null {
  if (symbol === undefined) return null;
  if (symbol.name !== "TextEncoder" && symbol.name !== "TextDecoder") return null;
  const hit = memo.get(symbol);
  if (hit !== undefined) return hit;
  const answer = proveAmbientCodec(ctx, symbol, symbol.name);
  memo.set(symbol, answer);
  return answer;
}

function proveAmbientCodec(ctx: CodecShadowCtx, symbol: ts.Symbol, name: CodecGlobalName): CodecGlobalName | null {
  const decls = ctx.checker.declarationsOf(symbol);
  if (decls.length === 0) return null;
  let sawValue = false;
  for (const d of decls) {
    const sf = d.getSourceFile();
    // A module-scoped declaration: a global script redeclaring the name would
    // merge with the lib's own global, which is not this shadow.
    if (ctx.isStdlibFile(sf) || !ts.isExternalModule(sf)) return null;
    if (ts.isVariableDeclaration(d)) {
      const stmt = d.parent.parent;
      const isDeclare = ts.isVariableStatement(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) === true;
      if (!isDeclare || d.initializer !== undefined) return null;
      sawValue = true;
    } else if (!ts.isTypeAliasDeclaration(d)) {
      return null;
    }
  }
  if (!sawValue) return null;
  const members = CODEC_MEMBERS[name]!;
  // The instance type (the module type alias).
  if (!membersWithin(ctx.checker, ctx.checker.getDeclaredTypeOfSymbol(symbol), members)) return null;
  // The constructor: at least one construct signature, each returning a within-shape instance.
  const sigs = ctx.checker.getConstructSignatures(ctx.checker.getTypeOfSymbol(symbol));
  if (sigs.length === 0) return null;
  for (const sig of sigs) {
    if (!membersWithin(ctx.checker, ctx.checker.getReturnTypeOfSignature(sig), members)) return null;
  }
  return name;
}

/** True when `t` has at least one property, every property is one of the codec's
 * members with the same callability, and none is symbol-keyed. */
function membersWithin(checker: ts.TypeChecker, t: ts.Type, members: Readonly<Record<string, "prop" | "method">>): boolean {
  const props = checker.getPropertiesOfType(t);
  if (props.length === 0) return false;
  for (const p of props) {
    if (p.name.startsWith("__@")) return false;
    const kind = members[p.name];
    if (kind === undefined) return false;
    const isCall = checker.getCallSignatures(checker.getTypeOfSymbol(p)).length > 0;
    if ((kind === "method") !== isCall) return false;
  }
  return true;
}

/** The codec global a resolved value symbol denotes: the stdlib global by
 * provenance (the lowerer's own isStdlibSymbol), or the proven ambient shadow.
 * Null for anything else, including a user's own TextEncoder. */
export function codecGlobalName(
  ctx: CodecShadowCtx & { readonly isStdlibSymbol: (sym: ts.Symbol | undefined) => boolean },
  symbol: ts.Symbol | undefined,
): CodecGlobalName | null {
  if (symbol === undefined) return null;
  if (symbol.name !== "TextEncoder" && symbol.name !== "TextDecoder") return null;
  if (ctx.isStdlibSymbol(symbol)) return symbol.name;
  return ambientCodecName(ctx, symbol);
}

/** The codec global a value's TYPE is an instance of (provenance by its alias or
 * declaring symbol, as the lowering checks it), or null. */
export function codecOfType(ctx: CodecShadowCtx & { readonly isStdlibSymbol: (sym: ts.Symbol | undefined) => boolean }, t: ts.Type): CodecGlobalName | null {
  return codecGlobalName(ctx, t.getAliasSymbol() ?? t.getSymbol());
}
