/** THE KEYED-READ DESTINATION CENSUS — the instrument behind the
 * per-destination narrowing study.
 *
 * An index-signature keyed read whose CHECKER type is the signature's
 * value type (no `noUncheckedIndexedAccess`) compiles to a helper whose
 * MISS path is `scr_trap_fmt("record has no key ...")` — a process ABORT
 * that carries no `[SCxxxx]` tag. No trap census counts it, and
 * `SCRIPTC_TRAP_TRACE` never prints it, because it is not a coded throw.
 * That is why zapo's published trap numbers were blind to the class that
 * actually stops it after pairing.
 *
 * `recordKeyReadAtUndefinedArm` reads the same key at an undefined-armed
 * width instead, and its admission rule is per-DESTINATION and
 * evidence-backed: the rung is offered only to destinations whose READERS
 * were compiled against the declared union, never to one tsc narrows.
 * This module measures which destinations the real reads flow into, so
 * the rule is applied to zapo's own sites instead of argued from a probe.
 *
 * `SCRIPTC_KEYREAD_CENSUS=<path>` appends one TSV row per index-signature
 * keyed read as it lowers. `SCRIPTC_KEYREAD_CENSUS_ONLY=1` stops the
 * build after the frontend and BEFORE codegen (index.ts honours it), so
 * the instrument can never race a build.
 *
 * The rows are deliberately raw — classification is a post-pass over the
 * file, so a mistake in the taxonomy costs a re-read, not a re-build. */
import * as ts from "../ts7/adapter.js";
import { appendFileSync } from "node:fs";

let sink: string | null | undefined;
let buffered: string[] = [];

function sinkPath(): string | null {
  if (sink === undefined) {
    sink = process.env["SCRIPTC_KEYREAD_CENSUS"] ?? null;
    if (sink !== null) process.on("exit", flushKeyReadCensus);
  }
  return sink;
}

export function keyReadCensusOnly(): boolean {
  return process.env["SCRIPTC_KEYREAD_CENSUS_ONLY"] === "1";
}

export function flushKeyReadCensus(): void {
  const p = sink;
  if (p === null || p === undefined || buffered.length === 0) return;
  appendFileSync(p, buffered.join("\n") + "\n");
  buffered = [];
}

/** Skip up the parens/cast chain so the classification sees the
 * syntactic CONSUMER, not a wrapper. */
function consumerOf(n: ts.Node): { child: ts.Node; parent: ts.Node } | null {
  let child: ts.Node = n;
  let parent = child.parent as ts.Node | undefined;
  while (
    parent !== undefined &&
    (parent.kind === ts.SyntaxKind.ParenthesizedExpression ||
      parent.kind === ts.SyntaxKind.AsExpression ||
      parent.kind === ts.SyntaxKind.NonNullExpression ||
      parent.kind === ts.SyntaxKind.SatisfiesExpression ||
      parent.kind === ts.SyntaxKind.TypeAssertionExpression)
  ) {
    child = parent;
    parent = child.parent as ts.Node | undefined;
  }
  return parent === undefined ? null : { child, parent };
}

const CMP = new Set<number>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** The DESTINATION a keyed read flows into, named by the syntax of its
 * consumer. The names are the ones the rung's admission rule is written
 * in ("a record-literal FIELD", "a declaration", "an assignment", "a
 * property write"), plus every destination no consumer exists for yet. */
export function destinationOf(n: ts.Node): string {
  const c = consumerOf(n);
  if (c === null) return "none";
  const { child, parent } = c;
  const K = ts.SyntaxKind;
  switch (parent.kind) {
    case K.CallExpression: {
      const p = parent as ts.CallExpression;
      if (p.arguments.some((a) => (a as ts.Node) === child)) return "callArg";
      if ((p.expression as ts.Node) === child) return "calleeRecv";
      return "callOther";
    }
    case K.NewExpression: {
      const p = parent as ts.NewExpression;
      if ((p.arguments ?? []).some((a) => (a as ts.Node) === child)) return "newArg";
      return "newOther";
    }
    case K.VariableDeclaration:
      return (parent as ts.VariableDeclaration).type === undefined
        ? "varInitBare"
        : "varInitAnnotated";
    case K.PropertyAssignment:
      return "recordField";
    case K.ShorthandPropertyAssignment:
      return "recordFieldShorthand";
    case K.ReturnStatement:
      return "return";
    case K.ArrowFunction:
      return "arrowBody";
    case K.BinaryExpression: {
      const p = parent as ts.BinaryExpression;
      const op = p.operatorToken.kind;
      if (op === K.QuestionQuestionToken) {
        return (p.left as ts.Node) === child ? "nullishLeft" : "nullishRight";
      }
      if (op === K.EqualsToken) {
        if ((p.right as ts.Node) !== child) return "assignTarget";
        return p.left.kind === K.PropertyAccessExpression || p.left.kind === K.ElementAccessExpression
          ? "propWrite"
          : "assign";
      }
      if (CMP.has(op)) return "compare";
      if (op === K.AmpersandAmpersandToken || op === K.BarBarToken) {
        return (p.left as ts.Node) === child ? "logicalLeft" : "logicalRight";
      }
      if (op === K.PlusToken) return "concatOrAdd";
      if (op === K.InKeyword) return "inOperator";
      if (op === K.CommaToken) return "comma";
      return "binary:" + String(op);
    }
    case K.TypeOfExpression:
      return "typeof";
    case K.PrefixUnaryExpression:
      return (parent as ts.PrefixUnaryExpression).operator === K.ExclamationToken
        ? "not"
        : "prefixUnary";
    case K.ConditionalExpression: {
      const p = parent as ts.ConditionalExpression;
      return (p.condition as ts.Node) === child ? "condTest" : "condArm";
    }
    case K.IfStatement:
      return (parent as ts.IfStatement).expression === (child as ts.Expression) ? "ifTest" : "ifOther";
    case K.WhileStatement:
    case K.DoStatement:
      return "loopTest";
    case K.SwitchStatement:
      return "switchSubject";
    case K.CaseClause:
      return "caseLabel";
    case K.TemplateSpan:
      return "templateSpan";
    case K.ArrayLiteralExpression:
      return "arrayElem";
    case K.SpreadElement:
    case K.SpreadAssignment:
      return "spread";
    case K.PropertyAccessExpression:
      return (parent as ts.PropertyAccessExpression).expression === (child as ts.Expression)
        ? "memberRecv"
        : "memberOther";
    case K.ElementAccessExpression:
      return (parent as ts.ElementAccessExpression).expression === (child as ts.Expression)
        ? "elemRecv"
        : "elemKey";
    case K.ExpressionStatement:
      return "discarded";
    case K.AwaitExpression:
      return "await";
    case K.ThrowStatement:
      return "throw";
    case K.ForOfStatement:
      return "forOfSubject";
    default:
      return "other:" + String(parent.kind);
  }
}

/** A short, stable spelling of the callee — an identifier's text, or a
 * property access's `recv.name`. No getText(): the 7.0.2 client AST is
 * not guaranteed to carry source text on every node. */
function calleeName(e: ts.Expression): string {
  if (e.kind === ts.SyntaxKind.Identifier) return (e as ts.Identifier).text;
  if (e.kind === ts.SyntaxKind.PropertyAccessExpression) {
    const p = e as ts.PropertyAccessExpression;
    const recv = p.expression.kind === ts.SyntaxKind.Identifier
      ? (p.expression as ts.Identifier).text
      : "<expr>";
    const nm = p.name.kind === ts.SyntaxKind.Identifier ? (p.name as ts.Identifier).text : "<name>";
    return `${recv}.${nm}`;
  }
  return "<" + String(e.kind) + ">";
}

/** THE NARROWING QUESTION, for a CALL-ARGUMENT destination: the callee's
 * DECLARED parameter type at this position, and whether that declared
 * type keeps an undefined arm.
 *
 * It is answered by the callee's DECLARATION, never by the call site: a
 * parameter is compiled once against its declared signature and tsc
 * cannot narrow a parameter from a caller. When the declared type has an
 * undefined arm, every reader inside the callee was checked against that
 * arm — which is exactly the condition the rung's admission rule states,
 * and the reason the argument destination is a keep-case rather than a
 * narrow-case. */
interface CheckerLike {
  getResolvedSignature(e: ts.Node): ts.Signature | undefined;
  getTypeOfSymbolAtLocation(s: ts.Symbol, n: ts.Node): ts.Type;
  typeToString(t: ts.Type): string;
  valueDeclarationOf(s: ts.Symbol): ts.Node | undefined;
}

function paramFacts(checker: CheckerLike, n: ts.Node): { want: string; wantArmed: string; callee: string } {
  const none = { want: "-", wantArmed: "-", callee: "-" };
  const c = consumerOf(n);
  if (c === null) return none;
  const { child, parent } = c;
  if (parent.kind !== ts.SyntaxKind.CallExpression && parent.kind !== ts.SyntaxKind.NewExpression) {
    return none;
  }
  const call = parent as ts.CallExpression | ts.NewExpression;
  const args = (call.arguments ?? []) as readonly ts.Expression[];
  const idx = args.findIndex((a) => (a as ts.Node) === child);
  if (idx < 0) return none;
  const callee = calleeName(call.expression);
  let sig: ts.Signature | undefined;
  try {
    sig = checker.getResolvedSignature(call);
  } catch {
    sig = undefined;
  }
  if (!sig) return { want: "?nosig", wantArmed: "?", callee };
  const params = sig.getParameters();
  const p = params[Math.min(idx, params.length - 1)];
  if (!p) return { want: "?noparam", wantArmed: "?", callee };
  const decl = checker.valueDeclarationOf(p);
  let want = "?";
  let armed = "?";
  try {
    const t = checker.getTypeOfSymbolAtLocation(p, decl ?? call);
    want = checker.typeToString(t).replace(/\s+/g, " ").slice(0, 80);
    const parts = t.isUnionType() ? t.getTypes() : [t];
    armed = parts.some((x) => (x.flags & ts.TypeFlags.Undefined) !== 0) ? "yes" : "no";
    // An OPTIONAL parameter (`v?: string`) whose reported type omits the
    // arm still accepts undefined at the call — record it distinctly so
    // the study never conflates "declared with the arm" with "optional".
    if (armed === "no" && decl !== undefined && ts.isParameter(decl)) {
      const pd = decl as ts.ParameterDeclaration;
      if (pd.questionToken !== undefined || pd.initializer !== undefined) armed = "yes-optional";
    }
  } catch {
    /* the checker declines on some synthesized signatures */
  }
  return { want, wantArmed: armed, callee };
}

export interface KeyReadRowInput {
  file: string;
  /** Character offset — the post-pass resolves it to a line. */
  start: number;
  key: string;
  shapeId: string;
  valueType: string;
  /** Does the READ's own compiled type already carry an undefined arm?
   * (a `noUncheckedIndexedAccess` build; zapo's is not one) */
  readArmed: boolean;
  /** Is this read's miss path the UNTAGGED abort? */
  abortCapable: boolean;
}

/** THE SECOND PASS, and the reason there is one.
 *
 * The row above is written where the read is LOWERED — before any
 * destination rung has had a chance to re-read it at an undefined-armed
 * or dyn width. So its `abortCapable` is honestly "bare AT THE READ", and
 * it over-counts: `recordField`, `typeof`, `??` and the declaration slots
 * all arm or widen the very same node a moment later.
 *
 * This pass walks the FINAL IR and records, per (file, offset), the width
 * the `recordKeyGet` actually kept. Joining the two files is what makes
 * the study's abortable count agree with the emitted TU's own call-site
 * count instead of merely bounding it. Measured after the fact rather
 * than predicted, because the first version of this instrument reported
 * 28 abortable reads for a program whose TU contained 15. */
export function emitFinalKeyReadWidths(mod: unknown, path: string): void {
  const m = mod as {
    unions?: { arms: { kind: string }[] }[];
  } & Record<string, unknown>;
  // Keyed by the def's OWN id, never by its ARRAY INDEX. The two agree
  // when a union is minted (`u${this.unions.length}`, frontend/types.ts)
  // and they do NOT agree in the FINAL module: on zapo the fifteen
  // `createStore.ts:124` rows came out FINAL_BARE while the emitted TU
  // shows `sc_rkg_27` answering `sc_unit_1500` on a miss - a NON-aborting
  // helper. The 56 rows this pass reported were 41 real ones plus that
  // one mislabelled site fifteen times over, and every reader of this
  // file has had to subtract it by hand and say so.
  const unionArmed = new Map<string, boolean>();
  const defs = (m.unions ?? []) as { id?: string; arms?: { kind: string }[] }[];
  defs.forEach((d, i) => {
    unionArmed.set(d.id ?? "u" + String(i), (d.arms ?? []).some((a) => a.kind === "undefinedT"));
  });
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    const o = v as Record<string, unknown>;
    if (o["kind"] === "recordKeyGet") {
      const t = o["type"] as { kind?: string; unionId?: string } | undefined;
      const loc = o["loc"] as { file?: string; start?: number } | undefined;
      const armed = t?.kind === "union" && t.unionId !== undefined
        ? (unionArmed.get(t.unionId) ?? false)
        : t?.kind === "dyn";
      const key = o["key"] as { value?: string } | undefined;
      out.push([
        loc?.file ?? "?",
        String(loc?.start ?? -1),
        key?.value ?? "*computed*",
        String(o["shapeId"] ?? "?"),
        t?.kind === "union" ? "union:" + String(t.unionId) : String(t?.kind ?? "?"),
        armed ? "FINAL_ARMED" : "FINAL_BARE",
      ].join("\t"));
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(m);
  appendFileSync(path, out.join("\n") + "\n");
}

/* ── THE NARROW-BRIDGE CENSUS ──────────────────────────────────────────
 *
 * The rung above stops the untagged ABORT by reading the key at dyn width.
 * It then says, in its own doc, what happens next: "the destination decides
 * all over again — one level down, at every REFERENCE: tsc narrows each use
 * to the scalar it believes, and maybeNarrow bridges that with a VALIDATED
 * extraction. So a use that needs the value throws the catchable
 * dyn-boundary TypeError where Node would throw its own."
 *
 * That last clause is a bet, and it is the one this census measures. It
 * holds for a use that DEREFERENCES the value (`id.length` on undefined
 * throws in Node too). It does NOT hold for a use whose declared
 * destination admits `undefined` — a parameter typed `string | undefined`,
 * an optional record field — where Node passes the undefined along and the
 * bridge throws `expected string at $, got undefined` instead.
 *
 * `SCRIPTC_NBRIDGE_CENSUS=<path>` appends one TSV row per narrow-bridge
 * dynCheck as maybeNarrow builds it, with the same DESTINATION taxonomy and
 * the same `wantArmed` parameter fact the keyed-read census uses — so the
 * two files join on (file, offset) and the study is one study.
 *
 * Deliberately every narrow bridge, not only the ones over a widened keyed
 * read: whether the dyn under a bridge came from this family is not
 * knowable at the bridge, and a census that guessed would be a census of
 * the guess. The join against the keyed-read census is what narrows it. */
export function recordNarrowBridgeRow(
  checker: CheckerLike,
  node: ts.Node,
  row: { file: string; start: number; narrowed: string; valueKind: string },
): void {
  if (nbridgeSinkPath() === null) return;
  let dest: string;
  let pf: { want: string; wantArmed: string; callee: string };
  try {
    dest = destinationOf(node);
    pf = dest === "callArg" || dest === "newArg"
      ? paramFacts(checker, node)
      : { want: "-", wantArmed: "-", callee: "-" };
  } catch (e) {
    dest = "?error";
    pf = { want: String((e as Error)?.message ?? e).slice(0, 60), wantArmed: "?", callee: "-" };
  }
  nbridgeBuffered.push(
    [row.file, String(row.start), row.narrowed, row.valueKind, dest, pf.want, pf.wantArmed, pf.callee].join("\t"),
  );
  if (nbridgeBuffered.length >= 2000) flushNarrowBridgeCensus();
}

let nbridgeSink: string | null | undefined;
let nbridgeBuffered: string[] = [];

function nbridgeSinkPath(): string | null {
  if (nbridgeSink === undefined) {
    nbridgeSink = process.env["SCRIPTC_NBRIDGE_CENSUS"] ?? null;
    if (nbridgeSink !== null) process.on("exit", flushNarrowBridgeCensus);
  }
  return nbridgeSink;
}

export function flushNarrowBridgeCensus(): void {
  const p = nbridgeSink;
  if (p === null || p === undefined || nbridgeBuffered.length === 0) return;
  appendFileSync(p, nbridgeBuffered.join("\n") + "\n");
  nbridgeBuffered = [];
}

/** THE SECOND PASS FOR THE NARROW BRIDGES, and the reason there is one.
 *
 * The row above is written where maybeNarrow BUILDS the bridge — before any
 * consumer has had a chance to unwrap it. So it over-counts, and it
 * over-counts on purpose: `ensureString` unwraps the bridge for a
 * `templateSpan`, `ensureBool` for a truthiness test, the unit comparisons
 * for a `compare`, and this rung for an armed argument or an optional
 * field. Every one of those still appears as a constructed bridge.
 *
 * This pass walks the FINAL IR and counts the bridges that SURVIVED, which
 * is the population the emitted TU actually holds. Joining the two is what
 * makes "my rung moved N sites" a measurement rather than a bound — and it
 * is the same correction the keyed-read census needed, for the same reason
 * (its first version reported 28 abortable reads for a TU holding 15). */
export function emitFinalNarrowBridges(mod: unknown, path: string): void {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    const o = v as Record<string, unknown>;
    if (o["kind"] === "dynCheck" && o["narrowBridge"] === true) {
      const t = o["type"] as { kind?: string } | undefined;
      const loc = o["loc"] as { file?: string; start?: number } | undefined;
      out.push([loc?.file ?? "?", String(loc?.start ?? -1), String(t?.kind ?? "?"), "FINAL_BRIDGE"].join("\t"));
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(mod);
  appendFileSync(path, out.join("\n") + "\n");
}

export function recordKeyReadRow(checker: CheckerLike, node: ts.Node, row: KeyReadRowInput): void {
  if (sinkPath() === null) return;
  let dest: string;
  let pf: { want: string; wantArmed: string; callee: string };
  try {
    dest = destinationOf(node);
    pf = dest === "callArg" || dest === "newArg" ? paramFacts(checker, node) : { want: "-", wantArmed: "-", callee: "-" };
  } catch (e) {
    dest = "?error";
    pf = { want: String((e as Error)?.message ?? e).slice(0, 60), wantArmed: "?", callee: "-" };
  }
  buffered.push(
    [
      row.file,
      String(row.start),
      row.key,
      row.shapeId,
      row.valueType,
      row.readArmed ? "readArmed" : "readBare",
      row.abortCapable ? "ABORTABLE" : "safe",
      dest,
      pf.want,
      pf.wantArmed,
      pf.callee,
    ].join("\t"),
  );
  if (buffered.length >= 2000) flushKeyReadCensus();
}
