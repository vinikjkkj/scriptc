/* Node's Buffer, reached by PROVENANCE through a structural alias (bson's
 * `type NodeJsBuffer = ArrayBufferView & Uint8Array & { write(...); swap32(...); ... }`
 * and `declare const Buffer: NodeJsBufferConstructor`).
 *
 * The runtime value behind such an alias really is the global Buffer (the
 * alias is a typing of Buffer's own methods), so the alias may map to the
 * native Buffer representation (bytes u8) ONLY when the checker proves that
 * every member the alias names is a member of the global Buffer (or of the
 * byte-view constituent), callable there exactly when the alias says so, and
 * that Symbol.toStringTag is typed string | undefined. No member is excluded:
 * a single unproven member leaves the whole alias unmapped. Member parameter
 * and return types are NOT re-proven: the checker cannot decide the
 * self-referencing `swap32(): this`, and the lowering dispatches by name; the
 * call shapes are measured against Node by corpus 15701-15703.
 *
 * The global Buffer interface and constructor are read from the program's
 * standard-library files (provenance, never the name alone). */
import * as ts from "./ts7/adapter.js";

export interface StdlibBufferTypes {
  /** The declared instance type of the global `Buffer` interface. */
  readonly instance: ts.Type;
  /** The type of the global `Buffer` value (BufferConstructor). */
  readonly value: ts.Type;
  /** The type of the global `Uint8Array` value. Node's Buffer inherits its
   * statics from it (`Object.getPrototypeOf(Buffer) === Uint8Array`, measured:
   * BYTES_PER_ELEMENT and of answer), so a static the Buffer declaration omits
   * is still a member of the run-time Buffer. */
  readonly u8Ctor: ts.Type | null;
}

interface ProgramLike {
  getSourceFiles(): readonly ts.SourceFile[];
}

const memo = new WeakMap<object, StdlibBufferTypes | null>();

/** Statements of the GLOBAL scope of a stdlib file: a script file's top level,
 * and `global { }` blocks wherever they nest (@types/node declares the
 * global Buffer inside `declare module "buffer" { global { ... } }`). A module
 * file's top level is module-scoped and is not global. */
function globalStatements(sf: ts.SourceFile): ts.Statement[] {
  const out: ts.Statement[] = [];
  const isModuleFile = sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) || ts.isExportDeclaration(s) ||
      ts.isExportAssignment(s) || ts.isImportEqualsDeclaration(s),
  );
  const walk = (stmts: readonly ts.Statement[], inGlobal: boolean) => {
    for (const s of stmts) {
      if (ts.isModuleDeclaration(s) && s.body && ts.isModuleBlock(s.body)) {
        const isGlobal = ts.isIdentifier(s.name) && s.name.text === "global";
        walk(s.body.statements, inGlobal || isGlobal);
        continue;
      }
      if (inGlobal) out.push(s);
    }
  };
  walk(sf.statements, !isModuleFile);
  return out;
}

/** The global Buffer interface and value, or null when the program has no
 * standard-library Buffer declarations (no @types/node). Memoized per program. */
export function stdlibBufferTypes(
  program: ProgramLike,
  checker: ts.TypeChecker,
  isStdlibFile: (sf: ts.SourceFile) => boolean,
): StdlibBufferTypes | null {
  const cached = memo.get(program as object);
  if (cached !== undefined) return cached;
  let instanceDecl: ts.InterfaceDeclaration | undefined;
  let valueDecl: ts.VariableDeclaration | undefined;
  let u8Decl: ts.VariableDeclaration | undefined;
  for (const sf of program.getSourceFiles()) {
    if (!isStdlibFile(sf)) continue;
    for (const s of globalStatements(sf)) {
      if (ts.isInterfaceDeclaration(s) && s.name.text === "Buffer") instanceDecl ??= s;
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === "Buffer") valueDecl ??= d;
          if (ts.isIdentifier(d.name) && d.name.text === "Uint8Array") u8Decl ??= d;
        }
      }
    }
  }
  let out: StdlibBufferTypes | null = null;
  if (instanceDecl !== undefined && valueDecl !== undefined) {
    const isym = checker.getSymbolAtLocation(instanceDecl.name);
    const vsym = checker.getSymbolAtLocation(valueDecl.name as ts.Identifier);
    if (isym !== undefined && vsym !== undefined) {
      let u8Ctor: ts.Type | null = null;
      if (u8Decl !== undefined) {
        const usym = checker.getSymbolAtLocation(u8Decl.name as ts.Identifier);
        if (usym !== undefined) u8Ctor = checker.getTypeOfSymbol(usym);
      }
      out = {
        instance: checker.getDeclaredTypeOfSymbol(isym),
        value: checker.getTypeOfSymbol(vsym),
        u8Ctor,
      };
    }
  }
  memo.set(program as object, out);
  return out;
}

/** True for `string`, `undefined`, or a union of only those with a string arm. */
function stringOrUndefined(t: ts.Type): boolean {
  const parts = (t.flags & ts.TypeFlags.Union) !== 0 ? ts.constituentTypes(t) : [t];
  let sawString = false;
  for (const p of parts) {
    if ((p.flags & ts.TypeFlags.StringLike) !== 0) sawString = true;
    else if ((p.flags & ts.TypeFlags.Undefined) === 0) return false;
  }
  return sawString;
}

/** Proof that the intersection `t` (already known to contain a byte-view
 * constituent: `isBytes` answers true for it) is a refinement of the native
 * Buffer: every constituent is a byte view or a plain object type, and every
 * member the refinement names is provably the Buffer member (or byte-view
 * member) of the same name, with the same callability. Symbol.toStringTag is
 * the one symbol-keyed member accepted: a string | undefined type describes
 * every byte view's run-time tag. */
export function bytesRefinementProven(
  t: ts.Type,
  checker: ts.TypeChecker,
  isBytes: (p: ts.Type) => boolean,
  buffer: StdlibBufferTypes | null,
): boolean {
  const parts = ts.constituentTypes(t);
  const bytesParts = parts.filter(isBytes);
  if (bytesParts.length === 0) return false;
  for (const r of parts) {
    if (isBytes(r)) continue;
    if ((r.flags & ts.TypeFlags.Object) === 0) return false;
    if (checker.getCallSignatures(r).length > 0 || checker.getConstructSignatures(r).length > 0) return false;
    if (checker.getIndexInfosOfType(r).length > 0) return false;
    const rsym = r.getSymbol();
    if (rsym !== undefined && (rsym.flags & ts.SymbolFlags.Class) !== 0) return false;
    for (const prop of checker.getPropertiesOfType(r)) {
      // Symbol.toStringTag: every byte view's run-time tag is a string (the
      // typed-array name, or "DataView"), so a member typed string | undefined
      // describes it exactly. It is not looked up on the Buffer interface (the
      // checker does not surface the inherited well-known member there).
      if (prop.name.startsWith("__@toStringTag@")) {
        if (!stringOrUndefined(checker.getTypeOfSymbol(prop))) return false;
        continue;
      }
      // Other symbol-keyed members are not proven here.
      if (prop.name.startsWith("__@")) return false;
      let source: ts.Symbol | undefined;
      if (buffer !== null) source = checker.getPropertyOfType(buffer.instance, prop.name);
      if (source === undefined) {
        for (const b of bytesParts) {
          source = checker.getPropertyOfType(b, prop.name);
          if (source !== undefined) break;
        }
      }
      // Membership is the proof obligation: every name the refinement lists is a
      // member of the native Buffer (or of its byte view), and it is callable
      // there exactly when the refinement says it is. The member TYPES are not
      // re-proven: the checker cannot decide the self-referencing `swap32(): this`
      // shape, and the lowering dispatches by name. The call shapes bson uses
      // are measured against Node instead (corpus 15700-15719).
      if (source === undefined) return false;
      const targetType = checker.getTypeOfSymbol(prop);
      const sourceCallable = checker.getCallSignatures(checker.getTypeOfSymbol(source)).length > 0;
      const targetCallable = checker.getCallSignatures(targetType).length > 0;
      if (sourceCallable !== targetCallable) return false;
    }
  }

  return true;
}

const receiverMemo = new WeakMap<ts.Type, boolean>();

/** True when `t` is an intersection that bytesRefinementProven accepts as the
 * native Buffer. Member access on such a receiver is the Buffer member of the
 * same name (the refinement claims it), so the bytes lowering takes it. */
export function isProvenBufferRefinement(
  t: ts.Type,
  checker: ts.TypeChecker,
  program: ProgramLike,
  isStdlibFile: (sf: ts.SourceFile) => boolean,
  bytesOf: (p: ts.Type) => boolean,
): boolean {
  if ((t.flags & ts.TypeFlags.Intersection) === 0) return false;
  const hit = receiverMemo.get(t);
  if (hit !== undefined) return hit;
  const answer = bytesRefinementProven(t, checker, bytesOf, stdlibBufferTypes(program, checker, isStdlibFile));
  receiverMemo.set(t, answer);
  return answer;
}


/** True when `symbol` is an ambient `declare const Buffer: T` (or `declare var`)
 * in a PROGRAM file, and every member T declares is a member of the global
 * Buffer value (BufferConstructor) with the same callability. T is the
 * declaration's own type: an intersection of constructor-shaped parts, or a
 * union with undefined (which is never proven). */
export function ambientBufferProven(
  ctx: {
    checker: ts.TypeChecker;
    loweringProgram: ProgramLike;
    isStdlibFile: (sf: ts.SourceFile) => boolean;
  },
  symbol: ts.Symbol,
): boolean {
  if (symbol.name !== "Buffer") return false;
  const decls = ctx.checker.declarationsOf(symbol);
  if (decls.length === 0) return false;
  for (const d of decls) {
    if (!ts.isVariableDeclaration(d)) return false;
    if (ctx.isStdlibFile(d.getSourceFile())) return false;
    const list = d.parent;
    const stmt = list.parent;
    if (!ts.isVariableStatement(stmt) || !stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return false;
  }
  const buffer = stdlibBufferTypes(ctx.loweringProgram, ctx.checker, ctx.isStdlibFile);
  if (buffer === null) return false;
  const declared = ctx.checker.getTypeOfSymbol(symbol);
  if ((declared.flags & ts.TypeFlags.Union) !== 0) return false;
  const props = ctx.checker.getPropertiesOfType(declared);
  if (props.length === 0) return false;
  for (const p of props) {
    if (p.name.startsWith("__@")) return false;
    let g = ctx.checker.getPropertyOfType(buffer.value, p.name);
    if (g === undefined && buffer.u8Ctor !== null) g = ctx.checker.getPropertyOfType(buffer.u8Ctor, p.name);
    if (g === undefined) return false;
    const gCall = ctx.checker.getCallSignatures(ctx.checker.getTypeOfSymbol(g)).length > 0;
    const pCall = ctx.checker.getCallSignatures(ctx.checker.getTypeOfSymbol(p)).length > 0;
    if (gCall !== pCall) return false;
  }
  return true;
}
