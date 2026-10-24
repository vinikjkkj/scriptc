/* The CommonJS export object a module REPLACES, when it is still reachable.
 *
 * `exports.f = v` attaches to the object `exports` names at module start.
 * A later `module.exports = R` makes R the export object importers see; the
 * old object is no longer anyone's export, but it is still a VALUE, and
 * the usual idiom hands it on (debug's `module.exports = require('./common')(exports)`:
 * the common setup copies and reads members of that object).
 *
 * The lowering: when a file's old object is attached to and read from
 * (bare `exports.f` spellings), that object is ONE module record global
 * (`cjsExportRecordOf`). Its shape is the member set in first-write order;
 * every bare `exports.f` read or write and every `exports` value is that
 * record. Importers never read it: they see R, as Node does.
 *
 * Soundness gates (all checked from the AST; any miss returns null and the
 * file keeps its refusal):
 *  - every member the record holds has a DIRECT top-level first write, and
 *    no write or top-level read of it precedes that first write (Node's key
 *    set and order at any escape are the first-write order);
 *  - every write to a member has the first write's mapped type;
 *  - `exports` as a value sits at top level, after every first write, and
 *    is not shadowed; element-access and compound/update spellings fence;
 *  - `module.exports.f` for a member of the record is either a direct
 *    top-level write before the replacement (the old object's member), or
 *    fences (it names R's member or the old one depending on when it runs).
 *
 * Residual edge (fenced by nothing; INFERRED, see the slice report): a
 * READ of a member inside a function declared before the member's first
 * write, called before that write, returns the record's zero value where
 * Node returns undefined. */
import * as ts from "../ts7/adapter.js";
import { dynFallbackType, type Lowerer } from "./lowerer.js";
import { BOOL, type IrExpr, type IrStmt, type IrType } from "../../ir/nodes.js";
import { cjsExportAssignmentOf, cjsWholeExportAssignmentOf, isCjsJsFile, isModuleExportsAccess, locOf } from "../program.js";

export interface CjsExportRecord {
  /** The module global holding the record (the old export object); null until flagged. */
  readonly id: string;
  readonly shapeId: string;
  /** Set true once the record exists (module BOOL global). */
  readonly flag: string;
  /** Top-level statement index after which the record is created (after every first write). */
  readonly createAfter: number;
  /** Bare reads that can run BEFORE the member's first write (a top-level read
   * above it, or a read inside a function a pre-write statement can reach).
   * They read as DYN: the record's value once it exists, `undefined` before. */
  readonly unsafeReads: ReadonlySet<ts.Node>;
  /** Members in first-write order. `temp` is the member's own typed global,
   * assigned by every write until the record exists, then read into it. */
  readonly members: readonly { name: string; type: IrType; temp: string; written: string }[];
}

/** The free `exports` name (not shadowed by a local binding). */
const isExportsName = (L: Lowerer, id: ts.Identifier): boolean => id.text === "exports" && L.resolveLocal(id) === null;

/** An `exports` identifier used as a VALUE (not a property name, not the
 * receiver of a property access). */
const isBareExportsIdent = (L: Lowerer, id: ts.Identifier): boolean => {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && (p.name === id || p.expression === id)) return false;
  return isExportsName(L, id);
};

/** The statement node whose child the node is, when the node sits directly
 * in an ExpressionStatement (possibly under parentheses). */
function enclosingExprStmt(n: ts.Node): ts.ExpressionStatement | null {
  // A write's own statement: the assignment (the access is its left operand)
  // sits directly in it, under optional parentheses and comma-free nesting.
  let c: ts.Node = n;
  if (ts.isBinaryExpression(c.parent) && c.parent.left === c) c = c.parent;
  while (ts.isParenthesizedExpression(c.parent)) c = c.parent;
  return ts.isExpressionStatement(c.parent) ? c.parent : null;
}

function inFunction(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionLike(p)) return true;
  }
  return false;
}

/** Writes, reads, and compound/update positions of a property access. */
function accessRole(p: ts.PropertyAccessExpression): "write" | "read" | "bad" {
  const par = p.parent;
  if (ts.isBinaryExpression(par) && par.left === p) {
    const op = par.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsToken) return "write";
    // Compound assignment (`+=`, `||=`, ...) reads and writes: fenced. Any other
    // operator just reads the member.
    return ts.SyntaxKind.FirstAssignment <= op && op <= ts.SyntaxKind.LastAssignment ? "bad" : "read";
  }
  if (ts.isPrefixUnaryExpression(par) || ts.isPostfixUnaryExpression(par)) {
    return par.operator === ts.SyntaxKind.PlusPlusToken || par.operator === ts.SyntaxKind.MinusMinusToken ? "bad" : "read";
  }
  if (ts.isDeleteExpression(par)) return "bad";
  return "read";
}

function topIndexOf(sf: ts.SourceFile, n: ts.Node): number {
  let c: ts.Node = n;
  while (c.parent !== undefined && !ts.isSourceFile(c.parent)) c = c.parent;
  return sf.statements.indexOf(c as ts.Statement);
}

const fileTagOf = (L: Lowerer, sf: ts.SourceFile): string => {
  const tag = L.fileTag.get(sf) ?? "";
  return tag === "" ? "e." : tag.replace(/^%/, "");
};

/** The record of a file whose old export object is attached to and read
 * from, or null when the gates fail (the file keeps its refusals). Memoised
 * per file: the statements, the initializer, and the reads share one id. */
export function cjsExportRecordOf(L: Lowerer, sf: ts.SourceFile): CjsExportRecord | null {
  if (L.cjsExportRecords.has(sf)) return L.cjsExportRecords.get(sf) ?? null;
  const rec = computeRecord(L, sf);
  L.cjsExportRecords.set(sf, rec);
  return rec;
}

/** The member type a write carries: the same mapping the export globals take
 * (mapTypeOf, then the checked-dynamic fallback for JS `any`-typed members). */
function typeOfWrite(L: Lowerer, rhs: ts.Expression): IrType | null {
  // Widened: `exports.n = 1` and a later `exports.n = exports.n + 1` agree on `number`.
  const t = L.checker.getBaseTypeOfLiteralType(L.typeOf(rhs));
  return L.mapTypeOf(t) ?? dynFallbackType(L, rhs, t);
}

/** The function a declaration names (a function declaration, or a const bound
 * to a function expression or arrow), or null. */
function functionOfDecl(d: ts.Node): ts.Node | null {
  if (ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d)) return d;
  if (ts.isVariableDeclaration(d) && d.initializer !== undefined) {
    let e: ts.Expression = d.initializer;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isFunctionExpression(e) || ts.isArrowFunction(e)) return e;
  }
  return null;
}

/** Function-like nodes that may run while the module is still before statement
 * `w`: every function created or referenced by a top-level statement up to and
 * including `w`, and (transitively) everything those functions reference. */
function preWriteFunctions(L: Lowerer, stmts: readonly ts.Statement[], w: number): Set<ts.Node> {
  const pre = new Set<ts.Node>();
  const work: ts.Node[] = [];
  const mark = (n: ts.Node): void => {
    if (!pre.has(n)) {
      pre.add(n);
      work.push(n);
    }
  };
  const scan = (root: ts.Node): void => {
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionLike(n)) mark(n);
      if (ts.isIdentifier(n)) {
        const sym = L.checker.getSymbolAtLocation(n);
        if (sym !== undefined) {
          for (const d of L.checker.declarationsOf(sym)) {
            const fn = functionOfDecl(d);
            if (fn !== null) mark(fn);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
  };
  for (let i = 0; i <= w; i++) scan(stmts[i]!);
  while (work.length > 0) scan(work.pop()!);
  return pre;
}

function computeRecord(L: Lowerer, sf: ts.SourceFile): CjsExportRecord | null {
  if (!isCjsJsFile(sf)) return null;
  const stmts = sf.statements;
  let lastT = -1;
  for (let i = 0; i < stmts.length; i++) {
    if (cjsExportAssignmentOf(stmts[i]!)?.kind === "table" || cjsWholeExportAssignmentOf(stmts[i]!) !== null) lastT = i;
  }
  if (lastT < 0) return null;
  const tPos = stmts[lastT]!.getStart(sf);

  // ---- collect every reference (any depth) -----------------------------
  const bare: ts.PropertyAccessExpression[] = [];
  const moduleRefs: ts.PropertyAccessExpression[] = [];
  const escapes: ts.Identifier[] = [];
  let bad = false;
  const visit = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isElementAccessExpression(n) && (ts.isIdentifier(n.expression) && n.expression.text === "exports")) {
      if (L.resolveLocal(n.expression) === null) bad = true;
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (ts.isIdentifier(n.expression) && isExportsName(L, n.expression)) {
        bare.push(n);
      } else if (isModuleExportsAccess(n.expression) && ts.isIdentifier(n.name)) {
        moduleRefs.push(n);
      }
    } else if (ts.isIdentifier(n) && isBareExportsIdent(L, n)) {
      escapes.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (bad) return null;

  // ---- which bare references are writes, and which members they name ----
  const names = new Set<string>();
  for (const p of bare) {
    const role = accessRole(p);
    if (role === "bad") return null;
    if (role === "write" && enclosingExprStmt(p) === null) return null;
    names.add(p.name.text);
  }
  if (names.size === 0) return null;

  // Top-level direct module-spelled writes before the replacement are the
  // old object's members too; anything else naming one of them fences.
  const moduleDirect = new Set<ts.PropertyAccessExpression>();
  for (const p of moduleRefs) {
    const name = (p.name as ts.Identifier).text;
    const es = accessRole(p) === "write" ? enclosingExprStmt(p) : null;
    const isOldDirect =
      es !== null && es.parent === sf && topIndexOf(sf, p) < lastT && accessRole(p) === "write";
    if (isOldDirect && names.has(name)) {
      moduleDirect.add(p);
      continue;
    }
    if (isOldDirect) {
      // A direct old-object member the bare spelling never names: the
      // record would need it, so it is a member too.
      names.add(name);
      moduleDirect.add(p);
      continue;
    }
    if (names.has(name)) return null;
  }

  // ---- first direct writes, write types, and read positions -------------
  const firstWrite = new Map<string, { pos: number; stmtIdx: number; type: IrType; node: ts.Node }>();
  const writes: { name: string; pos: number; rhs: ts.Expression; direct: boolean }[] = [];
  for (const p of [...bare, ...moduleDirect]) {
    const name = p.name.text;
    if (accessRole(p) !== "write") continue;
    const bin = p.parent as ts.BinaryExpression;
    const es = enclosingExprStmt(p);
    const direct = es !== null && es.parent === sf;
    writes.push({ name, pos: p.getStart(sf), rhs: bin.right, direct });
  }
  for (const w of writes) {
    if (!w.direct) continue;
    const t = typeOfWrite(L, w.rhs);
    if (t === null) return null;
    const cur = firstWrite.get(w.name);
    if (cur === undefined || w.pos < cur.pos) {
      firstWrite.set(w.name, { pos: w.pos, stmtIdx: topIndexOf(sf, w.rhs), type: t, node: w.rhs });
    }
  }
  for (const name of names) if (!firstWrite.has(name)) return null;
  for (const w of writes) {
    const fw = firstWrite.get(w.name)!;
    if (w.pos < fw.pos) return null;
    // Later writes are lowered against the member's type (lowerExprExpecting);
    // tsc's type of a later right-hand side is not a reliable gate here (the
    // replaced export object is untyped, so its members read as `any`).
  }
  // A member written before the replacement only through a module-spelled
  // write, and read through the bare spelling, is one record member: the
  // first-write rules above cover both spellings.
  // A read that can run before its member's first write is DYN (undefined
  // before the write, exactly Node's value); every other read stays static.
  const unsafeReads = new Set<ts.Node>();
  const preMemo = new Map<number, Set<ts.Node>>();
  for (const p of bare) {
    if (accessRole(p) !== "read") continue;
    const fw = firstWrite.get(p.name.text)!;
    if (!inFunction(p)) {
      if (p.getStart(sf) < fw.pos) unsafeReads.add(p);
      continue;
    }
    let pre = preMemo.get(fw.stmtIdx);
    if (pre === undefined) {
      pre = preWriteFunctions(L, stmts, fw.stmtIdx);
      preMemo.set(fw.stmtIdx, pre);
    }
    for (let f: ts.Node | undefined = p.parent; f !== undefined && !ts.isSourceFile(f); f = f.parent) {
      if (ts.isFunctionLike(f) && pre.has(f)) {
        unsafeReads.add(p);
        break;
      }
    }
  }
  // Escapes: top level, not shadowed, after every first write.
  let maxStmt = -1;
  for (const fw of firstWrite.values()) maxStmt = Math.max(maxStmt, fw.stmtIdx);
  for (const id of escapes) {
    if (inFunction(id) || topIndexOf(sf, id) <= maxStmt) return null;
  }
  // Writes: a direct write at top level, or a nested one in an ExpressionStatement.
  for (const p of bare) if (accessRole(p) === "write" && enclosingExprStmt(p) === null) return null;

  // ---- the record ------------------------------------------------------
  const order = [...firstWrite.entries()].sort((a, b) => a[1].pos - b[1].pos);
  const tag = fileTagOf(L, sf);
  const id = `%g.${tag}%cjsrec`;
  const members = order.map(([name, fw], k) => ({
    name,
    type: fw.type,
    temp: `${id}.t${k}`,
    written: `${id}.w${k}`,
  }));
  for (const m of members) {
    L.globalsList.push({ id: m.temp, name: "%cjst", type: m.type, mutable: true });
    L.globalsList.push({ id: m.written, name: "%cjsw", type: BOOL, mutable: true });
  }
  const flag = `${id}.flag`;
  L.globalsList.push({ id: flag, name: "%cjsflag", type: BOOL, mutable: true });
  const shapeId = L.shapes.intern(
    [...members].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((m) => ({ name: m.name, type: m.type })),
    false,
    undefined,
    members.map((m) => m.name),
  );
  L.globalsList.push({ id, name: "%cjsrec", type: { kind: "record", shapeId }, mutable: true });
  const createAfter = Math.max(...order.map(([, fw]) => fw.stmtIdx));
  return { id, shapeId, flag, createAfter, members, unsafeReads };
}

/** The record field of a member; undefined when the record does not hold it. */
export function cjsExportRecordField(rec: CjsExportRecord, name: string): { type: IrType } | undefined {
  return rec.members.find((m) => m.name === name);
}

/** Value of the record (`exports` as a value). Only reached after creation (gated). */
export function cjsExportRecordRef(rec: CjsExportRecord, loc: ReturnType<typeof locOf>): IrExpr {
  return { kind: "varRef", localId: rec.id, type: { kind: "record", shapeId: rec.shapeId }, loc };
}

/** `exports.name` read that may run before the first write (see unsafeReads):
 * DYN, the record's value once it exists and `undefined` before. */
export function cjsExportRecordReadDyn(rec: CjsExportRecord, name: string, node: ts.Node): IrExpr {
  const m = rec.members.find((x) => x.name === name)!;
  const loc = locOf(node);
  const DYNT = { kind: "dyn" } as const;
  return {
    kind: "ternary",
    cond: { kind: "varRef", localId: rec.flag, type: BOOL, loc },
    then: {
      kind: "dynFrom",
      value: { kind: "recordGet", obj: cjsExportRecordRef(rec, loc), shapeId: rec.shapeId, field: name, type: m.type, loc },
      type: DYNT,
      loc,
    },
    else_: {
      kind: "ternary",
      cond: { kind: "varRef", localId: m.written, type: BOOL, loc },
      then: { kind: "dynFrom", value: { kind: "varRef", localId: m.temp, type: m.type, loc }, type: DYNT, loc },
      else_: { kind: "dynFrom", value: { kind: "unitLit", unit: "undefined", type: { kind: "undefinedT" }, loc }, type: DYNT, loc },
      type: DYNT,
      loc,
    },
    type: DYNT,
    loc,
  };
}

/** `exports.name` read: the record once it exists, the member's own global before. */
export function cjsExportRecordRead(rec: CjsExportRecord, name: string, node: ts.Node): IrExpr {
  const m = rec.members.find((x) => x.name === name)!;
  const loc = locOf(node);
  return {
    kind: "ternary",
    cond: { kind: "varRef", localId: rec.flag, type: BOOL, loc },
    then: { kind: "recordGet", obj: cjsExportRecordRef(rec, loc), shapeId: rec.shapeId, field: name, type: m.type, loc },
    else_: { kind: "varRef", localId: m.temp, type: m.type, loc },
    type: m.type,
    loc,
  };
}

/** Initial state at module start: the record does not exist yet. */
export function cjsExportRecordInit(rec: CjsExportRecord, loc: ReturnType<typeof locOf>): IrStmt[] {
  const off = (localId: string): IrStmt => ({ kind: "assign", localId, value: { kind: "boolLit", value: false, type: BOOL, loc }, loc });
  return [off(rec.flag), ...rec.members.map((m) => off(m.written))];
}

/** Created right after the statement at `rec.createAfter`: the record takes
 * every member's current value, and the flag turns on. */
export function cjsExportRecordCreate(rec: CjsExportRecord, loc: ReturnType<typeof locOf>): IrStmt[] {
  return [
    {
      kind: "assign",
      localId: rec.id,
      value: {
        kind: "recordLit",
        fields: [...rec.members].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((m) => ({
          name: m.name,
          value: { kind: "varRef", localId: m.temp, type: m.type, loc },
        })),
        type: { kind: "record", shapeId: rec.shapeId },
        loc,
      },
      loc,
    },
    { kind: "assign", localId: rec.flag, value: { kind: "boolLit", value: true, type: BOOL, loc }, loc },
  ];
}

/** `exports.name = value`: the member's global always, the record too once it exists. */
export function cjsExportRecordWrite(L: Lowerer, rec: CjsExportRecord, bin: ts.BinaryExpression, name: string): IrStmt {
  const m = rec.members.find((x) => x.name === name)!;
  const loc = locOf(bin);
  return {
    kind: "block",
    body: [
      { kind: "assign", localId: m.temp, value: L.lowerExprExpecting(bin.right, m.type), loc },
      { kind: "assign", localId: m.written, value: { kind: "boolLit", value: true, type: BOOL, loc }, loc },
      {
        kind: "if",
        cond: { kind: "varRef", localId: rec.flag, type: BOOL, loc },
        then: [
          {
            kind: "recordSet",
            obj: cjsExportRecordRef(rec, loc),
            shapeId: rec.shapeId,
            field: name,
            value: { kind: "varRef", localId: m.temp, type: m.type, loc },
            loc,
          },
        ],
        else_: null,
        loc,
      },
    ],
    loc,
  };
}

/** Whether a property access is a bare `exports.name` spelling. */
export function isBareExportsAccess(L: Lowerer, p: ts.PropertyAccessExpression): boolean {
  return ts.isIdentifier(p.expression) && isExportsName(L, p.expression);
}

export { topIndexOf };
