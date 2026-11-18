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

/* THE FOLDED TWIN (index.ts, SCRIPTC_TWIN_FOLD): the twin edits are decided in the FIRST pass, from text that does not carry the pin
 * wrappers, and applied in ONE reload together with them. Two things follow. The copy of a listener must be the text the pin-edited
 * program has (so the pin wrappers inside the listener are carried into the copy), and every insertion point must be moved from the
 * unedited text to the pin-edited one (shiftTwinEdits). A shape this cannot place with certainty throws TwinFoldRefused and the
 * caller keeps today's sequential path. */
export interface PinSpan {
  start: number;
  end: number;
  ts: boolean;
}
export type PinSpans = ReadonlyMap<string, readonly PinSpan[]>;
export class TwinFoldRefused extends Error {}

const pinPre = (p: PinSpan): string => (p.ts ? "(" : "/** @type {any} */ (");
const pinPost = (p: PinSpan): string => (p.ts ? " as any)" : ")");

function pinsOfFile(pins: PinSpans | undefined, file: string): readonly PinSpan[] {
  if (pins === undefined) return [];
  return pins.get(file) ?? pins.get(file.split("\\").join("/")) ?? [];
}

/** The pins of one file, sorted. Pins that nest, share a boundary or touch are refused: the order their wrappers take at a shared
 * offset is not something the forward translation may guess. */
function sortedPins(pins: PinSpans | undefined, file: string): PinSpan[] {
  const list = [...pinsOfFile(pins, file)].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < list.length; i++) {
    if (list[i]!.start <= list[i - 1]!.end) throw new TwinFoldRefused(`pins overlap or touch in ${file}`);
  }
  return list;
}

/** Move an offset of the unedited text to the pin-edited text. An offset at a pin's start stays BEFORE its opener, one at its end goes
 * AFTER its closer, one inside takes the opener only. */
function forwardOffset(list: readonly PinSpan[], p: number): number {
  let shift = 0;
  for (const e of list) {
    if (e.start >= p) break;
    const pre = pinPre(e).length;
    if (p >= e.end) shift += pre + pinPost(e).length;
    else shift += pre;
  }
  return p + shift;
}

/** The twin edits (offsets into the unedited text, texts already carrying the pin wrappers of their copies) moved to the pin-edited text. */
export function shiftTwinEdits(edits: TwinEdits, pins: PinSpans): TwinEdits {
  const out: TwinEdits = new Map();
  for (const [file, list] of edits) {
    const ps = sortedPins(pins, file);
    out.set(file, list.map((e) => ({ at: forwardOffset(ps, e.at), text: e.text })));
  }
  return out;
}

/** The pin wrappers inside [lo, hi) of one file as replacement records: closers first, openers last, so that at one offset a twin
 * insertion lands after a closer and before an opener (the order a statement start or end has in the pin-edited text). */
function pinReps(list: readonly PinSpan[], lo: number, hi: number): { closers: Rep[]; openers: Rep[] } {
  const closers: Rep[] = [];
  const openers: Rep[] = [];
  // positive control (tests only): a fold whose copies ignore the pins inside them
  if ((process.env["SCRIPTC_TWIN_FOLD_BREAK"] ?? "").split(",").includes("nopin")) return { closers, openers };
  for (const p of list) {
    if (p.end <= lo || p.start >= hi) continue; // disjoint
    if (p.start <= lo && p.end >= hi) {
      // the copy sits inside the pin: the wrappers are outside it, unless they touch its ends
      if (p.start === lo) throw new TwinFoldRefused("a pin wraps a twin copy");
      continue;
    }
    if (p.start < lo || p.end > hi) throw new TwinFoldRefused("a pin straddles a twin copy");
    closers.push({ start: p.end, end: p.end, text: pinPost(p) });
    openers.push({ start: p.start, end: p.start, text: pinPre(p) });
  }
  if (closers.length > 0 && process.env["SCRIPTC_TWIN_WHY"] !== undefined) process.stderr.write(`[twinfold] a twin copy carries ${closers.length} pin(s)\n`);
  return { closers, openers };
}

export interface TwinEditOptions {
  /** Fold mode: the pins the program will carry. */
  pins?: PinSpans;
  /** Check mode: the program ALREADY carries the twins (the folded reload). Nested twins are in the text, so they are not added
   * again, and a listener's size is measured without the insertions inside it, as today's pass (no insertions) would see it. */
  applied?: boolean;
  /** Collects the candidates the generator does NOT twin, with the shape that stopped it (reported as an advisory: those listeners stay on the checked boundary). */
  skipped?: { node: ts.Expression; why: string }[];
}

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
  let out = text.slice(base, f.end);
  for (const e of ord) {
    out = out.slice(0, e.start - base) + e.text + out.slice(e.end - base);
  }
  return out;
}

/** The twin DECLARATION of a function the registration names by identifier (same file only, a single
 * declaration): where it goes (right after the original) and its text, or null. */
function declTwin(
  id: ts.Identifier, name: string, checker: ts.TypeChecker, sf: ts.SourceFile, js: boolean, pins?: readonly PinSpan[],
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
    if (pins !== undefined) {
      const pr = pinReps(pins, d.getStart(sf), d.end);
      extra.unshift(...pr.closers.reverse());
      extra.push(...pr.openers);
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
    let reps: Rep[] = [];
    if (pins !== undefined) {
      const pr = pinReps(pins, init.getStart(sf), init.end);
      reps = [...pr.closers.reverse(), ...pr.openers];
    }
    const t = erasedText(init, sf, js, reps);
    // A statement written without its semicolon (ASI style) ends at its last token: the twin declaration follows on the SAME
    // line, where `const a = () => {} const b = ...` is a syntax error (no newline for ASI to act on). End the statement first.
    return t === null ? null : { key: d, at: stmt.end, text: `${sf.text.charAt(stmt.end - 1) === ";" ? "" : ";"} const ${name} = ${t};` };
  }
  return null;
}

/** The insertions for every candidate listener, or null when none can be twinned. A candidate is the
 * registration's listener argument: an inline function expression, or an identifier naming a function
 * declaration / const function expression of the same file. */
export function computeTwinEdits(cands: readonly ts.Expression[], checker: ts.TypeChecker, opts?: TwinEditOptions): TwinEdits | null {
  const applied = opts?.applied === true;
  const pinOpts = opts?.pins;
  const pinCache = new Map<string, PinSpan[]>();
  const pinList = (file: string): PinSpan[] => {
    let l = pinCache.get(file);
    if (l === undefined) pinCache.set(file, (l = sortedPins(pinOpts, file)));
    return l;
  };
  const size = (x: ts.Node): number => {
    const sf = x.getSourceFile();
    const lo = x.getStart(sf);
    let n = x.end - lo;
    if (applied) for (const sp of twinSpansIn(sf.fileName, lo, x.end)) n -= sp.e - sp.s;
    return n;
  };
  const out: TwinEdits = new Map();
  const counters = new Map<string, number>();
  const seen = new Set<string>();
  const declK = new Map<ts.Node, number>();
  // Innermost first: a listener registered inside another listener's body is part of the outer twin's text, so
  // the outer copy is taken AFTER the inner insertions exist (its own registrations get twins too).
  const ordered = [...cands].sort((x, y) => size(x) - size(y));
  for (const f of ordered) {
    const sf = f.getSourceFile();
    const key = `${sf.fileName}@${f.getStart(sf)}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
      if (!applied) {
        for (const e of out.get(sf.fileName) ?? []) {
          if (e.at > lo && e.at <= f.end) reps.push({ start: e.at, end: e.at, text: e.text });
        }
      }
      if (pinOpts === undefined) return reps;
      const pr = pinReps(pinList(sf.fileName), lo, f.end);
      return [...pr.closers.reverse(), ...reps, ...pr.openers];
    };
    if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) {
      const body = erasedText(f, sf, js, inner());
      if (body === null) {
        opts?.skipped?.push({ node: f, why: "a parameter shape the erased copy cannot spell: an unparenthesized arrow parameter, a destructured rest, or a JavaScript rest pack" });
        continue;
      }
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
        const dt = declTwin(f, `__sctwin_${k}`, checker, sf, js, pinOpts === undefined ? undefined : pinList(sf.fileName));
        if (dt === null) {
          opts?.skipped?.push({ node: f, why: "the named listener is not a single same-file function declaration or const function expression whose copy can be spelled" });
          continue;
        }
        declK.set(dt.key, k);
        declEdit = { at: dt.at, text: dt.text };
        hoist = `void __sctwin_${k}; `;
      }
    } else {
      opts?.skipped?.push({ node: f, why: "the listener is neither an inline function nor a named function" });
      continue;
    }
    const place = placement(f, sf, hoist);
    if (place === null) {
      if (declEdit !== null) declK.forEach((v, key2) => { if (v === k) declK.delete(key2); });
      opts?.skipped?.push({ node: f, why: "no statement position can hold the twin (a class field initializer, a parameter default, a computed key, a decorator or a static block)" });
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

/** Is `pos` inside a twin copy (inserted text) of this file's current twin load? */
export function insideTwinSpan(file: string, pos: number): boolean {
  const all = insertedSpans.get(file.split("\\").join("/"));
  return all !== undefined && all.some((x) => x.s <= pos && pos < x.e);
}

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

const MARK = /\/\*@sctwin (\d+)\*\//g;

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
