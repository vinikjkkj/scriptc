/* THE ERASED TWIN OF AN EMITTER LISTENER (sq16c, user decision 2026-11-02: "Repassar igual ao Node").
 *
 * A typed listener `(n: number) => ...` is lowered with `n` an f64: every use of `n` is a number operation.
 * When a DYNAMIC emit (emit.apply, a spread, a call with runtime arguments, JS code) reaches it with a value
 * outside the declared type, Node simply passes the value (`typeof n === "string"`); a body compiled over f64
 * cannot answer that exactly. The exact answer is the same listener lowered a SECOND time with its annotated
 * parameter types erased to `any` (dyn), reached only by dynamic emits; the typed body keeps serving every
 * static emit, so nothing on the static path changes.
 *
 * The checker is the only source of expression types (tsgo: no per-node override, and an expression derived
 * from the parameter, `n + 1`, is typed by the checker from the parameter's type), so the twin is made the way
 * the dyn pin reload is: the program is loaded again with SOURCE edits (insertions only) and lowered again.
 * For each typed listener registered through an emitter method the edits add, before the enclosing statement,
 *
 *     const __sctwin_K = <the listener text with every parameter annotation replaced by `any`>; void __sctwin_K;
 *
 * and a marker comment `/*@sctwin K*\/` before the listener argument. The second lowering finds the twin from
 * the marker (twinMarkOf / twinIdentOf) and registers it with emitter.onTwin. The closure creation is the only
 * cost, paid by the registration, never by an emit.
 *
 * What is not twinned stays exactly as it was (the typed listener behind the checked-dynamic boundary): a
 * listener that is not an inline function expression, one whose registration sits where no statement can host
 * the twin (a class field initializer, a parameter default), and any program the second load rejects or lowers
 * differently (the caller keeps the first lowering). */
import * as ts from "../ts7/adapter.js";
import { isJsSourceFile } from "../program.js";

export interface TwinEdit {
  at: number;
  text: string;
}
/** fileName -> insertions into the text that file was lowered from. */
export type TwinEdits = Map<string, TwinEdit[]>;

const STATEMENT_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.LabeledStatement,
  ts.SyntaxKind.Block,
]);

/** Where a hoisted twin goes for the listener `f`: a statement list position, a lone statement to wrap in
 * braces, or an expression-bodied arrow to turn into a block. Null when no statement can host it. */
function placement(f: ts.Node, sf: ts.SourceFile, decl: string): TwinEdit[] | null {
  let cur: ts.Node = f;
  for (;;) {
    const par = cur.parent;
    if (par === undefined) return null;
    if (STATEMENT_KINDS.has(cur.kind) && cur.kind !== ts.SyntaxKind.Block) {
      const inList =
        ts.isBlock(par) || ts.isSourceFile(par) || ts.isModuleBlock(par) || ts.isCaseClause(par) || ts.isDefaultClause(par);
      const at = cur.getStart(sf);
      if (inList) return [{ at, text: decl }];
      // A lone statement (an if/else branch, a loop body, a label's statement): braces make it a list.
      return [{ at, text: `{ ${decl}` }, { at: cur.end, text: " }" }];
    }
    if (ts.isArrowFunction(par) && par.body === cur && !ts.isBlock(cur)) {
      return [{ at: cur.getStart(sf), text: `{ ${decl} return ` }, { at: cur.end, text: "; }" }];
    }
    // A class member initializer, a parameter default, a computed key, a decorator: no statement position.
    if (
      ts.isPropertyDeclaration(par) || ts.isParameter(par) || ts.isComputedPropertyName(par) ||
      ts.isDecorator(par) || ts.isClassStaticBlockDeclaration(par)
    ) {
      return null;
    }
    // A function boundary reached through a non-statement path (a function expression's own body is a Block,
    // met above) cannot host it either.
    if (ts.isSourceFile(cur)) return null;
    cur = par;
  }
}

/** The source ranges whose text a computeTwinEdits call copied into a twin, while it runs with `order` given. */
let copiedSink: { file: string; start: number; end: number }[] | null = null;

type Fn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
interface Rep {
  start: number;
  end: number;
  text: string;
}

/** The text of the function with every parameter's annotation erased to `any`, `extra` replacements (offsets
 * into the file) applied too. Null when the shape cannot be rewritten (an unparenthesized arrow parameter in
 * a TypeScript file cannot carry an annotation; a destructured rest; a JavaScript rest pack). */
function erasedText(f: Fn, sf: ts.SourceFile, js: boolean, extra: readonly Rep[] = []): string | null {
  const text = sf.text;
  const base = f.getStart(sf);
  const edits: Rep[] = [...extra];
  let restName: string | null = null;
  for (const p of f.parameters) {
    const rest = p.dotDotDotToken !== undefined;
    if (js) {
      // A JavaScript parameter's type is its inline JSDoc (`/** @type {number} */ n`): drop the comment.
      const lead = text.slice(p.pos, p.getStart(sf));
      if (lead.includes("/**")) edits.push({ start: p.pos, end: p.getStart(sf), text: " " });
      // A JavaScript rest pack has no static representation once its element type is erased.
      if (rest) return null;
      continue;
    }
    if (rest) {
      // `...xs: any[]` has no static representation (the dynamic function type); `...xs: unknown[]` does, and
      // the body sees the pack through `const xs: any[]`, so every element use stays a dyn operation.
      if (!ts.isIdentifier(p.name) || f.parameters[f.parameters.length - 1] !== p) return null;
      restName = p.name.text;
      const end = p.type !== undefined ? p.type.end : p.name.end;
      edits.push({ start: p.name.getStart(sf), end, text: "__scr_rest: unknown[]" });
      continue;
    }
    if (ts.isIdentifier(p.name) || ts.isObjectBindingPattern(p.name) || ts.isArrayBindingPattern(p.name)) {
      if (p.type !== undefined) {
        edits.push({ start: p.type.getStart(sf), end: p.type.end, text: "any" });
      } else {
        if (ts.isArrowFunction(f) && f.parameters.length === 1 && text.charAt(base) !== "(" && !text.slice(base, f.parameters[0]!.pos).includes("(")) {
          return null;
        }
        const after = p.questionToken !== undefined ? p.questionToken.end : p.name.end;
        edits.push({ start: after, end: after, text: ": any" });
      }
    } else {
      return null;
    }
  }
  if (restName !== null) {
    const body = f.body;
    if (body === undefined) return null;
    const pro = `const ${restName}: any[] = __scr_rest;`;
    if (ts.isBlock(body)) {
      edits.push({ start: body.getStart(sf) + 1, end: body.getStart(sf) + 1, text: ` ${pro} ` });
    } else {
      edits.push({ start: body.getStart(sf), end: body.getStart(sf), text: `{ ${pro} return (` });
      edits.push({ start: body.end, end: body.end, text: "); }" });
    }
  }
  // Descending, so earlier offsets stay valid; an insertion at the same offset as a later-listed edit goes first.
  const ord = edits.map((e, i) => ({ e, i })).sort((a, b) => b.e.start - a.e.start || b.i - a.i).map((x) => x.e);
  copiedSink?.push({ file: sf.fileName, start: base, end: f.end });
  let out = text.slice(base, f.end);
  for (const e of ord) {
    out = out.slice(0, e.start - base) + e.text + out.slice(e.end - base);
  }
  return out;
}

/** The twin DECLARATION of a function the registration names by identifier (same file only, a single
 * declaration): where it goes (right after the original) and its text, or null. */
function declTwin(
  id: ts.Identifier, name: string, checker: ts.TypeChecker, sf: ts.SourceFile, js: boolean,
): { key: ts.Node; at: number; text: string } | null {
  const sym = checker.getSymbolAtLocation(id);
  if (sym === undefined) return null;
  const decls = checker.declarationsOf(sym);
  if (decls.length !== 1) return null;
  const d = decls[0]!;
  if (d.getSourceFile() !== sf) return null;
  if (ts.isFunctionDeclaration(d) && d.name !== undefined && d.body !== undefined && d.asteriskToken === undefined) {
    const extra: Rep[] = [{ start: d.name.getStart(sf), end: d.name.end, text: name }];
    for (const m of d.modifiers ?? []) {
      if (m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) {
        extra.push({ start: m.getStart(sf), end: m.end, text: "" });
      }
    }
    const t = erasedText(d, sf, js, extra);
    return t === null ? null : { key: d, at: d.end, text: ` ${t.trim()}` };
  }
  if (ts.isVariableDeclaration(d) && d.initializer !== undefined && ts.isIdentifier(d.name)) {
    const list = d.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return null;
    const stmt = list.parent;
    if (!ts.isVariableStatement(stmt) || list.declarations.length !== 1) return null;
    const init = d.initializer;
    if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) return null;
    const t = erasedText(init, sf, js);
    return t === null ? null : { key: d, at: stmt.end, text: ` const ${name} = ${t};` };
  }
  return null;
}

/** The insertions for every candidate listener, or null when none can be twinned. A candidate is the
 * registration's listener argument: an inline function expression, or an identifier naming a function
 * declaration / const function expression of the same file. */
export function computeTwinEdits(
  cands: readonly ts.Expression[],
  checker: ts.TypeChecker,
  order?: { tie: boolean; copied?: { file: string; start: number; end: number }[] },
): TwinEdits | null {
  copiedSink = order?.copied ?? null;
  try {
    return computeTwinEditsInner(cands, checker, order);
  } finally {
    copiedSink = null;
  }
}

function computeTwinEditsInner(
  cands: readonly ts.Expression[],
  checker: ts.TypeChecker,
  order?: { tie: boolean },
): TwinEdits | null {
  const out: TwinEdits = new Map();
  const counters = new Map<string, number>();
  const seen = new Set<string>();
  const declK = new Map<ts.Node, number>();
  // Innermost first: a listener registered inside another listener's body is part of the outer twin's text, so
  // the outer copy is taken AFTER the inner insertions exist (its own registrations get twins too).
  const ordered = [...cands].sort((x, y) => (x.end - x.getStart()) - (y.end - y.getStart()));
  // Twin numbers are spent in this order, and the order among candidates of one length in one file is the order the caller
  // met them in. A caller whose meeting order is not the emit pass's reports a tie here and keeps the emit pass's own list.
  const lengthSeen = new Set<string>();
  for (const f of ordered) {
    const sf = f.getSourceFile();
    const key = `${sf.fileName}@${f.getStart(sf)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (order !== undefined) {
      const lk = `${sf.fileName}#${f.end - f.getStart(sf)}`;
      if (lengthSeen.has(lk)) order.tie = true;
      lengthSeen.add(lk);
    }
    const js = isJsSourceFile(sf);
    let list = out.get(sf.fileName);
    const need = (): TwinEdit[] => {
      if (list === undefined) out.set(sf.fileName, (list = []));
      return list;
    };
    let k: number;
    let hoist: string;
    let declEdit: TwinEdit | null = null;
    const inner = (): Rep[] => {
      const lo = f.getStart(sf);
      const reps: Rep[] = [];
      for (const e of out.get(sf.fileName) ?? []) {
        if (e.at > lo && e.at <= f.end) reps.push({ start: e.at, end: e.at, text: e.text });
      }
      return reps;
    };
    if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) {
      const body = erasedText(f, sf, js, inner());
      if (body === null) continue;
      k = counters.get(sf.fileName) ?? 0;
      const name = `__sctwin_${k}`;
      hoist = `const ${name} = ${body}; void ${name}; `;
    } else if (ts.isIdentifier(f)) {
      // Probe the declaration with a provisional name; the twin number is spent only when it works.
      const known = (() => {
        const sym = checker.getSymbolAtLocation(f);
        const ds = sym === undefined ? [] : checker.declarationsOf(sym);
        return ds.length === 1 ? declK.get(ds[0]!) : undefined;
      })();
      if (known !== undefined) {
        k = known;
        hoist = `void __sctwin_${k}; `;
      } else {
        k = counters.get(sf.fileName) ?? 0;
        const dt = declTwin(f, `__sctwin_${k}`, checker, sf, js);
        if (dt === null) continue;
        declK.set(dt.key, k);
        declEdit = { at: dt.at, text: dt.text };
        hoist = `void __sctwin_${k}; `;
      }
    } else {
      continue;
    }
    const place = placement(f, sf, hoist);
    if (place === null) {
      if (declEdit !== null) declK.forEach((v, key2) => { if (v === k) declK.delete(key2); });
      continue;
    }
    if (declEdit !== null) {
      counters.set(sf.fileName, k + 1);
      need().push(declEdit);
    } else if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) {
      counters.set(sf.fileName, k + 1);
    }
    need().push(...place, { at: f.getStart(sf), text: `/*@sctwin ${k}*/ ` });
  }
  return out.size === 0 ? null : out;
}

/** The inserted spans, in the EDITED text's coordinates, per file of the current twin load. The text of a
 * function value (Function.prototype.toString) must be the author's, so a function that CONTAINS an insertion
 * (a nested listener's twin) drops it (functionSourceText). */
const insertedSpans = new Map<string, { s: number; e: number }[]>();

export function clearTwinSpans(): void {
  insertedSpans.clear();
}

/** The spans inserted inside [start, end) of the edited text, ascending. */
export function twinSpansIn(file: string, start: number, end: number): { s: number; e: number }[] {
  const all = insertedSpans.get(file.split("\\").join("/"));
  return all === undefined ? [] : all.filter((x) => x.s >= start && x.e <= end);
}

/** Apply insertions (offsets into `text`); equal offsets keep their given order. */
export function applyTwinEdits(text: string, edits: readonly TwinEdit[], file?: string): string {
  const idx = edits.map((e, i) => ({ e, i }));
  idx.sort((a, b) => a.e.at - b.e.at || a.i - b.i);
  let out = "";
  let at = 0;
  const spans: { s: number; e: number }[] = [];
  for (const { e } of idx) {
    out += text.slice(at, e.at);
    spans.push({ s: out.length, e: out.length + e.text.length });
    out += e.text;
    at = e.at;
  }
  if (file !== undefined) insertedSpans.set(file.split("\\").join("/"), spans);
  return out + text.slice(at);
}

/** Map an offset into the edited text back to the original (an offset inside inserted text maps to the
 * insertion point). */
export function twinBackMap(edits: readonly TwinEdit[]): (p: number) => number {
  const idx = edits.map((e, i) => ({ e, i }));
  idx.sort((a, b) => a.e.at - b.e.at || a.i - b.i);
  return (p: number): number => {
    let shift = 0;
    for (const { e } of idx) {
      const S = e.at + shift; // the inserted text begins here in the edited text
      if (p < S) break;
      if (p < S + e.text.length) return e.at;
      shift += e.text.length;
    }
    return p - shift;
  };
}

/** A pin reload's wrapper lengths around the span it casts: `(` + ` as any)` in a TypeScript file, the JSDoc cast in a JavaScript one
 * (program.ts applies them in exactly these spellings). */
const PIN_WRAP = { ts: [1, 8], js: [20, 1] } as const;

/** Move twin insertions found on a program onto the text a pin reload of that program serves: each insertion point shifts past the
 * wrappers that end before it. Null when a pin edit touches a twin insertion point or overlaps text a twin copied (the twin text
 * would then differ from the one the pinned program produces), so the caller keeps the two reloads apart. */
export function mapTwinEdits(
  edits: TwinEdits,
  pins: ReadonlyMap<string, readonly { start: number; end: number; ts: boolean }[]>,
  copied: readonly { file: string; start: number; end: number }[],
): TwinEdits | null {
  const norm = (f: string): string => f.split("\\").join("/");
  const pinsOf = (file: string): readonly { start: number; end: number; ts: boolean }[] => {
    for (const [k, v] of pins) if (norm(k) === norm(file)) return v;
    return [];
  };
  for (const c of copied) {
    for (const p of pinsOf(c.file)) if (p.start < c.end && p.end > c.start) return null;
  }
  const out: TwinEdits = new Map();
  for (const [file, list] of edits) {
    const ps = pinsOf(file);
    const mapped: TwinEdit[] = [];
    for (const e of list) {
      let shift = 0;
      for (const p of ps) {
        if (p.start <= e.at && e.at <= p.end) return null;
        if (p.end < e.at) shift += p.ts ? PIN_WRAP.ts[0] + PIN_WRAP.ts[1] : PIN_WRAP.js[0] + PIN_WRAP.js[1];
      }
      mapped.push({ at: e.at + shift, text: e.text });
    }
    out.set(file, mapped);
  }
  return out;
}

/** The registration sites (by position in the served text) whose marker the lowering found a twin for. */
const consumedSites = new Set<string>();

export function resetTwinConsumed(): void {
  consumedSites.clear();
}

export function noteTwinConsumed(site: string): void {
  consumedSites.add(site);
}

export function twinConsumedCount(): number {
  return consumedSites.size;
}

/** How many markers the insertions carry, copies inside a twin's own text included: every one of them is a registration the
 * twin program's lowering must find a twin for. */
export function twinMarkerCount(edits: TwinEdits): number {
  let n = 0;
  for (const list of edits.values()) for (const e of list) n += e.text.match(MARKS_IN_TEXT)?.length ?? 0;
  return n;
}

/** Is `pos` inside text a twin reload inserted into `file`? (Functions lowered from it are copies, not the program's own.) */
export function inTwinSpan(file: string, pos: number): boolean {
  const all = insertedSpans.get(file.split("\\").join("/"));
  if (all === undefined) return false;
  for (const x of all) if (pos >= x.s && pos < x.e) return true;
  return false;
}

const MARK = /\/\*@sctwin (\d+)\*\//g;
const MARKS_IN_TEXT = /\/\*@sctwin \d+\*\//g;

/** The twin number the reload marked this listener argument with, or null. The marker is the last
 * comment between the previous token and the argument. */
export function twinMarkOf(f: ts.Node): number | null {
  const sf = f.getSourceFile();
  const lead = sf.text.slice(f.pos, f.getStart(sf));
  let m: RegExpExecArray | null;
  let k: number | null = null;
  MARK.lastIndex = 0;
  while ((m = MARK.exec(lead)) !== null) k = Number(m[1]);
  return k;
}

/** The identifier expression of the twin `__sctwin_K` hoisted before the statement that holds `f` (the
 * `void __sctwin_K;` that follows its declaration), or null. */
export function twinIdentOf(f: ts.Node, k: number): ts.Identifier | null {
  const name = `__sctwin_${k}`;
  for (let cur: ts.Node | undefined = f; cur !== undefined; cur = cur.parent) {
    const par = cur.parent;
    if (par === undefined) return null;
    let stmts: readonly ts.Statement[] | undefined;
    if (ts.isBlock(par) || ts.isSourceFile(par) || ts.isModuleBlock(par)) stmts = par.statements;
    else if (ts.isCaseClause(par) || ts.isDefaultClause(par)) stmts = par.statements;
    if (stmts === undefined) continue;
    const at = stmts.indexOf(cur as ts.Statement);
    for (let i = at - 1; i >= 0; i--) {
      const s = stmts[i]!;
      if (ts.isExpressionStatement(s) && ts.isVoidExpression(s.expression) && ts.isIdentifier(s.expression.expression) &&
          s.expression.expression.text === name) {
        return s.expression.expression;
      }
    }
  }
  return null;
}
