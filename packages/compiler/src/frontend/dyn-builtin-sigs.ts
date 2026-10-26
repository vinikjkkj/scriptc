/* The global builtin FUNCTIONS whose VALUE form is a DYN-signature closure
 * (lower-fnvalue.ts, dynBuiltinFnValueOf). Their static type is the DYN
 * signature here, so a dyn receiver's callback (`anyArray.map(String)`,
 * `.filter(Boolean)`, `.map(parseInt)`) and a typed slot both see one
 * function type, instead of an overloaded or `any`-parameter signature
 * that the mapper refuses (SC2007/SC2009/SC2011).
 *
 * The key is the source spelling: `String`, `parseInt`, `Array.isArray`,
 * `JSON.stringify`. The ctor interfaces (`StringConstructor` and friends)
 * are keyed by their interface name in types.ts; this table is the
 * functions. */
import * as ts from "./ts7/adapter.js";
import { BOOL, DYN, F64, funcOf, type IrType, STRING } from "../ir/nodes.js";

export interface DynBuiltinSig {
  readonly arity: number;
  readonly ret: IrType;
}

export const DYN_BUILTIN_SIGS: Readonly<Record<string, DynBuiltinSig | undefined>> = {
  String: { arity: 1, ret: STRING },
  Number: { arity: 1, ret: F64 },
  Boolean: { arity: 1, ret: BOOL },
  parseInt: { arity: 2, ret: F64 },
  parseFloat: { arity: 1, ret: F64 },
  isNaN: { arity: 1, ret: BOOL },
  isFinite: { arity: 1, ret: BOOL },
  encodeURIComponent: { arity: 1, ret: STRING },
  encodeURI: { arity: 1, ret: STRING },
  decodeURIComponent: { arity: 1, ret: STRING },
  decodeURI: { arity: 1, ret: STRING },
  escape: { arity: 1, ret: STRING },
  unescape: { arity: 1, ret: STRING },
  "Array.isArray": { arity: 1, ret: BOOL },
  "JSON.stringify": { arity: 1, ret: STRING },
};

/** The keys whose static TYPE maps to the DYN signature. Every other key
 * keeps its own mapping: a typed value row on main is gated on it. */
export const DYN_MAPPED_KEYS: ReadonlySet<string> = new Set(["Array.isArray", "JSON.stringify"]);

/** The table key of a stdlib function declaration, or null. */
function keyOfDecl(d: ts.Node): string | null {
  if (ts.isFunctionDeclaration(d) && d.name !== undefined) return d.name.text;
  if (d.kind === ts.SyntaxKind.MethodSignature) {
    const m = d as unknown as { name: { text: string }; parent: { kind: number; name?: { text: string } } };
    const owner = m.parent;
    if (owner.kind === ts.SyntaxKind.InterfaceDeclaration && owner.name !== undefined) {
      if (owner.name.text === "JSON") return `JSON.${m.name.text}`;
      if (owner.name.text === "ArrayConstructor") return `Array.${m.name.text}`;
    }
  }
  return null;
}

/** The DYN signature a stdlib function TYPE maps to, or null when the type
 * is not one of the table's functions. Every signature of the type must be
 * a stdlib declaration of a table key (an overload set of the same key is
 * one function). */
export function dynBuiltinSigOfType<S>(
  sigs: readonly S[],
  declOf: (sig: S) => ts.Node | undefined,
  isStdlib: (d: ts.Node) => boolean,
): DynBuiltinSig | null {
  if (sigs.length === 0) return null;
  let key: string | null = null;
  for (const sig of sigs) {
    const d = declOf(sig);
    if (d === undefined || !isStdlib(d)) return null;
    const k = keyOfDecl(d);
    if (k === null || (key !== null && k !== key)) return null;
    key = k;
  }
  if (key === null || !DYN_MAPPED_KEYS.has(key)) return null;
  return DYN_BUILTIN_SIGS[key] ?? null;
}

/** The DYN function type of a table row. */
export function dynBuiltinFnType(row: DynBuiltinSig): IrType {
  return funcOf(
    Array.from({ length: row.arity }, () => DYN),
    row.ret,
  );
}
