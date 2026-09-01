/* Recognizing JavaScript's pre-class constructor pattern — a plain function
 * plus `C.prototype.m = function` — as a CLASS rather than a dyn box.
 *
 * `new Klass(a)` in a JS file currently lowers through the per-use dyn box
 * (lower-classes.ts, the arm before the generic construction fence): a fresh
 * OBJ linked to `Klass.prototype`, with `this.x = a` landing on it through
 * scr_dyn_this_get. That is correct and it is why the pattern compiles at all.
 * It also means every later `inst.m()` is a dynInvoke and every `inst.f` a
 * dynKeyGet, and both seed `f.throws` unconditionally (may-throw.ts), so every
 * use site carries an unwind check whose release list emitter.ts inlines in
 * full. On zapo's protobuf bundle this pattern alone — `Reader`/`Writer` and
 * their prototype methods — accounts for 9,594 of 23,359 may-throw seeds in the
 * generated decode bodies.
 *
 * This module only RECOGNIZES. It answers "is this binding a constructor whose
 * instances have a fixed shape and a fixed method table", and it is
 * deliberately conservative: every way the pattern could be dynamic is a
 * bailout, recorded with a reason rather than silently dropped, because a wrong
 * answer here changes what a program does rather than how big it is.
 *
 * SCOPE, and it is the whole difficulty. A bundle is many modules in one file:
 *
 *     r({"node_modules/protobufjs/src/reader.js"(e, t) { function s(b) {...} ... }})
 *     r({"node_modules/protobufjs/src/writer.js"(e, t) { function s(f, l) {...} ... }})
 *
 * After minification those chunks reuse the same one-character names, so `s` is
 * the Reader in one scope and a writer Op in another. Keying candidates by NAME
 * merges them and produces a class with one chunk's methods and another's
 * fields — a wrong shape that would still compile. Candidates are therefore
 * keyed by their DECLARATION NODE, and a `S.prototype.m = ...` binds to the
 * innermost enclosing scope that declares `S`, which is what JS itself does.
 *
 * FOR THE CONSUMER, and this is the part that will bite. When a recognized
 * class's value flows into a typed slot — a field store, a call argument, a
 * seeded container — lower it with `lowerExprExpecting(node, slot)` and NOT
 * `lowerExpr(node)`. 668af820 is the standing example: `new Set(Object.values(Ctl))`
 * refused while every static fact agreed, because the lowered VALUE arrived
 * checked-dynamic and the `typeEquals` guard failed "over a difference that is
 * not real". A declared binding lowers its initializer EXPECTING its own type;
 * a raw `lowerExpr` at a use site does not. The same shape is waiting here:
 * measured on zapo's bundle, 2,923 of the 6,679 message-field stores in the
 * decode bodies hold a value that is dyn TODAY, and every one of them is a
 * reader-method result that this recognizer is meant to make typed. Lowering
 * those with `lowerExpr` would leave them dyn, hit a dynCheck at the boundary,
 * and relocate the guard instead of removing it — which is the whole win.
 *
 * WHAT THE CONSUMER HAS TO BUILD, in the order the IR forces:
 *
 *   1. An `IrClassDef` (ir/nodes.ts:1341) per usable class: `fields` in layout
 *      order with an `IrType` each, and `methods` as declared names. A slot's
 *      type must admit the constructor initializer AND every write flagged
 *      `reassignedInMethod` — Reader seeds `pos` to 0 and every accessor
 *      rewrites it, so inferring from the initializer alone gets a type the
 *      first method write violates. A `conditional` field must be NULLABLE, not
 *      zero-defaulted (presence-coupling.mjs: 278 of 641 protobuf types diverge
 *      on a zero default, none on null).
 *   2. A module function `%<class>.<method>` per entry in `methods`, lowered
 *      with `this` bound to the instance type. This is the bulk of the work and
 *      the reason this is a feature rather than a patch.
 *   3. `new S(a)` becomes `{ kind: "new", className, args, type, loc }`
 *      (ir/nodes.ts:6375) instead of falling to the dyn box arm in
 *      lower-classes.ts. Place the new arm BEFORE that one and after every
 *      typed arm, so it can only turn a box into a class — never change a
 *      program that compiles today.
 *   4. `mergedMethods` is a SEPARATE decision. Binding them statically is only
 *      sound if the merge provably ran before any use; protobufjs calls
 *      `_configure()` at module init, but that is a runtime fact. Refusing them
 *      keeps 215 of 5,068 reader calls (4.2%) on the dyn path, which is correct
 *      and cheap. Do that first and revisit only with a reason.
 *
 * Nothing here reads a `.d.ts`. The declaration beside this bundle omits four
 * of the members its own implementation uses (`tag`, `raw`, `discardUnknown`,
 * and `skipType`'s real arity), which is why the body is the only source that
 * can be trusted — see npm-static.ts's standing doctrine and the measurement in
 * tests/perf/dynpath/waproto-split.mjs.
 */
import ts from "typescript5";

/** A member the constructor assigns to `this` in its own body. */
export interface ProtoField {
  name: string;
  /** The initializer expression, for the shape's field type inference. */
  init: ts.Expression;
  /** `this.x = y` inside a branch: the field exists on some paths only, so the
   * slot must be NULLABLE rather than absent. Zero-defaulting it instead would
   * change behaviour — see tests/perf/dynpath/presence-coupling.mjs, where a
   * zero default diverges on 278 of 641 protobuf message types and a null
   * default on none. */
  conditional: boolean;
  /** A prototype method also writes this field. The slot's type has to admit
   * every one of those writes, not just the constructor's initializer — e.g.
   * Reader.pos is seeded to 0 and then rewritten by every accessor. Recorded
   * rather than refused: reassignment is normal, it only widens the slot. */
  reassignedInMethod: boolean;
}

export interface ProtoMethod {
  name: string;
  fn: ts.FunctionExpression | ts.ArrowFunction;
}

/** A non-function value parked on the prototype (`C.prototype._slice = ...`):
 * shared by every instance, so a static in all but spelling. */
export interface ProtoConst {
  name: string;
  init: ts.Expression;
}

export interface ProtoClass {
  /** The local binding name. Minified bundles reuse these across scopes, so it
   * is NOT an identity — `scope` is. */
  name: string;
  /** The function (or SourceFile) whose body declares this binding. */
  scope: ts.Node;
  ctor: ts.FunctionDeclaration | ts.FunctionExpression;
  fields: ProtoField[];
  methods: ProtoMethod[];
  protoConsts: ProtoConst[];
  /** `C.m = ...` — statics, NOT part of the instance shape. */
  statics: string[];
  /** Methods installed at RUNTIME by `merge(C.prototype, { m: fn, ... })`.
   * protobufjs does this in `Reader._configure` for the 64-bit accessors, so
   * `int64`/`uint64`/`sint64`/`fixed64`/`sfixed64` are absent from the
   * statically visible prototype. Kept SEPARATE from `methods` rather than
   * folded in: they are only present once the merge has run, and a caller that
   * binds them statically changes what happens when it has not. On zapo's
   * bundle these are 215 of 5,068 reader calls in the decode bodies (4.2%) --
   * small, but a class that silently omits them is wrong at those 215 sites. */
  mergedMethods: ProtoMethod[];
  /** Non-empty means DO NOT treat this as a class. Human-readable and
   * deduplicated, so a refusal can be explained rather than merely counted. */
  bailouts: string[];
}

const isFnLike = (n: ts.Node): n is ts.FunctionExpression | ts.ArrowFunction =>
  ts.isFunctionExpression(n) || ts.isArrowFunction(n);

/** The nearest enclosing function body, or the SourceFile. This is the scope a
 * `var`/`function` declaration binds into — near enough for recognition, and
 * conservative: a narrower guess could only merge two bindings, never split one. */
function scopeOf(n: ts.Node): ts.Node {
  let c: ts.Node | undefined = n.parent;
  while (c) {
    if (ts.isFunctionDeclaration(c) || ts.isFunctionExpression(c) || ts.isArrowFunction(c) ||
        ts.isMethodDeclaration(c) || ts.isConstructorDeclaration(c) || ts.isSourceFile(c)) return c;
    c = c.parent;
  }
  return n.getSourceFile();
}

const contains = (outer: ts.Node, n: ts.Node): boolean =>
  n.getStart() >= outer.getStart() && n.getEnd() <= outer.getEnd();

/** Is `n` inside a branch/loop relative to `stop`? Decides field nullability. */
function isConditional(n: ts.Node, stop: ts.Node): boolean {
  let c: ts.Node | undefined = n.parent;
  while (c && c !== stop) {
    if (
      ts.isIfStatement(c) || ts.isConditionalExpression(c) ||
      ts.isForStatement(c) || ts.isForInStatement(c) || ts.isForOfStatement(c) ||
      ts.isWhileStatement(c) || ts.isDoStatement(c) || ts.isSwitchStatement(c) ||
      ts.isCatchClause(c) || ts.isTryStatement(c) ||
      // `a && (this.x = 1)` / `a || (this.x = 1)` are branches too.
      (ts.isBinaryExpression(c) &&
        (c.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
         c.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
         c.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) return true;
    c = c.parent;
  }
  return false;
}

/** `X.prototype.m` / `X.prototype` / `X.m` → the base name and the member. */
function targetOf(e: ts.Node): { name: string; member: string | null; viaProto: boolean } | null {
  if (!ts.isPropertyAccessExpression(e)) return null;
  const inner = e.expression;
  if (ts.isPropertyAccessExpression(inner) && inner.name.getText() === "prototype" &&
      ts.isIdentifier(inner.expression)) {
    return { name: inner.expression.text, member: e.name.getText(), viaProto: true };
  }
  if (ts.isIdentifier(inner) && e.name.getText() === "prototype") {
    return { name: inner.text, member: null, viaProto: true };   // `X.prototype` itself
  }
  if (ts.isIdentifier(inner)) {
    return { name: inner.text, member: e.name.getText(), viaProto: false };
  }
  return null;
}

/**
 * Find every prototype-class in a source file.
 *
 * Recognized shape, which is what a minifier leaves of `class`:
 *
 *     function S(buf) { this.buf = buf; this.pos = 0; }
 *     S.prototype.uint32 = function () { ... };
 *     S.prototype._slice = Array.prototype.subarray;
 *     S.create = function (b) { return new S(b); };
 *
 * Callers must check `bailouts.length === 0` before using a result to change a
 * lowering; `usableProtoClasses` does that for them. A refused candidate is
 * still returned so the reason can be reported rather than silently skipped.
 */
export function findProtoClasses(sf: ts.SourceFile): ProtoClass[] {
  /* Pass 1: candidate constructors, keyed by DECLARATION NODE. A function is a
   * candidate when it assigns at least one `this.x`, since that is what gives
   * its instances a shape. Both `function S() {}` and `var S = function () {}`,
   * because a bundler emits either. */
  const cands: ProtoClass[] = [];
  /** scope -> name -> how many declarations of it that scope holds. */
  const declsIn = new Map<ts.Node, Map<string, number>>();

  const note = (scope: ts.Node, name: string) => {
    let m = declsIn.get(scope);
    if (!m) declsIn.set(scope, (m = new Map()));
    m.set(name, (m.get(name) ?? 0) + 1);
  };

  const collectFields = (fn: ts.FunctionDeclaration | ts.FunctionExpression): ProtoField[] => {
    const out: ProtoField[] = [];
    const seen = new Set<string>();
    (function walk(n: ts.Node) {
      // Do not descend into a nested function: its `this` is not ours.
      if (n !== fn && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
                       ts.isClassDeclaration(n) || ts.isClassExpression(n))) return;
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) &&
        n.left.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        const name = n.left.name.getText();
        if (!seen.has(name)) {
          seen.add(name);
          out.push({ name, init: n.right, conditional: isConditional(n, fn),
            reassignedInMethod: false });
        }
      }
      ts.forEachChild(n, walk);
    })(fn);
    return out;
  };

  const add = (name: string, decl: ts.Node, fn: ts.FunctionDeclaration | ts.FunctionExpression) => {
    const scope = scopeOf(decl);
    note(scope, name);
    const fields = collectFields(fn);
    if (fields.length === 0) return;
    cands.push({ name, scope, ctor: fn, fields, methods: [], protoConsts: [],
      statics: [], mergedMethods: [], bailouts: [] });
  };

  (function walk(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name) add(n.name.text, n, n);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
             ts.isFunctionExpression(n.initializer)) add(n.name.text, n, n.initializer);
    ts.forEachChild(n, walk);
  })(sf);

  /** The candidate a reference to `name` at `at` resolves to: the one whose
   * scope contains the reference and is INNERMOST. This is the whole reason
   * candidates are not keyed by name. */
  const resolve = (name: string, at: ts.Node): ProtoClass | null => {
    let best: ProtoClass | null = null;
    for (const c of cands) {
      if (c.name !== name || !contains(c.scope, at)) continue;
      if (best === null || contains(best.scope, c.scope)) best = c;
    }
    return best;
  };

  /* Merge calls whose member list we read in full. Such a call is NOT an
   * unknown escape: we know exactly what it does to the prototype. Anything
   * else that takes `X.prototype` as an argument still refuses. */
  const understoodMerges = new Set<ts.Node>();

  /* Pass 2: prototype members, statics, and every reason to refuse. */
  (function walk(n: ts.Node) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const t = targetOf(n.left);
      if (t) {
        const c = resolve(t.name, n);
        if (c) {
          if (!t.viaProto) {
            // A static. Harmless to the instance shape, but protobufjs
            // REWRITES `S.create` on first call, so statics are recorded and
            // never treated as constants.
            c.statics.push(t.member as string);
          } else if (t.member === null) {
            // `X.prototype = something`: the whole method table is replaced by
            // a value we cannot see through. Never a class.
            c.bailouts.push("prototype is assigned wholesale @" + n.getStart());
          } else if (isFnLike(n.right)) {
            if (c.methods.some((m) => m.name === t.member)) {
              c.bailouts.push(`prototype method '${t.member}' assigned more than once`);
            } else {
              c.methods.push({ name: t.member, fn: n.right });
            }
            if (isConditional(n, c.scope)) {
              c.bailouts.push(`prototype method '${t.member}' assigned conditionally`);
            }
          } else {
            c.protoConsts.push({ name: t.member, init: n.right });
            if (isConditional(n, c.scope)) {
              c.bailouts.push(`prototype member '${t.member}' assigned conditionally`);
            }
          }
        }
      }
    }

    /* `merge(X.prototype, { m: fn, ... })` — a runtime method-table addition
     * whose contents ARE statically visible, because the second argument is an
     * object literal right there. Recognized so the members can be reported;
     * the escape bailout below still fires, so a caller must decide explicitly
     * whether to trust that the merge has run. */
    if (ts.isCallExpression(n) && n.arguments.length >= 2) {
      const a0 = n.arguments[0];
      const a1 = n.arguments[1];
      if (a0 && a1 && ts.isPropertyAccessExpression(a0) && a0.name.getText() === "prototype" &&
          ts.isIdentifier(a0.expression) && ts.isObjectLiteralExpression(a1)) {
        const c = resolve(a0.expression.text, n);
        if (c) {
          let readAll = true;
          for (const prop of a1.properties) {
            if (ts.isPropertyAssignment(prop) && isFnLike(prop.initializer)) {
              c.mergedMethods.push({ name: prop.name.getText(), fn: prop.initializer });
            } else {
              readAll = false;
              c.bailouts.push("prototype merge has a member we cannot read @" + prop.getStart());
            }
          }
          if (readAll) understoodMerges.add(a0);
        }
      }
    }

    /* The binding must be stable and must not escape somewhere its prototype
     * could be mutated behind our back. */
    if (ts.isIdentifier(n) && n.parent) {
      const p = n.parent;
      const isDeclName =
        (ts.isFunctionDeclaration(p) && p.name === n) ||
        (ts.isVariableDeclaration(p) && p.name === n);
      if (!isDeclName) {
        const c = resolve(n.text, n);
        if (c) {
          if (ts.isBinaryExpression(p) && p.left === n &&
              p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            c.bailouts.push("the constructor binding is reassigned @" + n.getStart());
          }
          // `Object.defineProperty(S.prototype, ...)` / `Object.assign(S.prototype, ...)`
          if (ts.isPropertyAccessExpression(p) && p.name.getText() === "prototype" &&
              p.parent && ts.isCallExpression(p.parent) &&
              (p.parent.arguments as readonly ts.Node[]).includes(p) &&
              !understoodMerges.has(p)) {
            c.bailouts.push("the prototype is passed to a call @" + p.getStart());
          }
        }
      }
    }
    ts.forEachChild(n, walk);
  })(sf);

  /* Pass 3: what the METHODS do to `this`.
   *
   * The constructor is only the instance shape if nothing else adds to it. A
   * prototype method that assigns a field the constructor never sets means
   * instances gain a slot later, and a struct laid out from the constructor
   * alone would have nowhere to put it — a silently wrong shape rather than a
   * failed build, which is the shape of bug this whole module exists to avoid.
   * Verified against zapo's bundle: zero such fields across all four usable
   * classes, so this refuses nothing there and guards every other input. */
  for (const c of cands) {
    const ctorFields = new Set(c.fields.map((f) => f.name));
    for (const m of [...c.methods, ...c.mergedMethods]) {
      (function walk(n: ts.Node) {
        // A nested function has its own `this`; do not credit it to ours.
        if (n !== m.fn && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n))) return;
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(n.left) &&
          n.left.expression.kind === ts.SyntaxKind.ThisKeyword
        ) {
          const name = n.left.name.getText();
          const own = c.fields.find((f) => f.name === name);
          if (own) own.reassignedInMethod = true;
          else if (ctorFields.has(name)) { /* unreachable, kept for clarity */ }
          else {
            c.bailouts.push(
              `method '${m.name}' assigns '${name}', which the constructor never sets @` +
              n.getStart());
          }
        }
        ts.forEachChild(n, walk);
      })(m.fn);
    }
  }

  /* Pass 4: per-scope shadowing, and candidates that buy nothing. */
  for (const c of cands) {
    if ((declsIn.get(c.scope)?.get(c.name) ?? 0) > 1) {
      c.bailouts.push("the name is declared more than once in its own scope");
    }
    if (c.methods.length === 0) {
      // A constructor with no prototype methods is a record factory. Shaping it
      // is not wrong, but it removes no dynInvoke, and the instance-shape work
      // belongs to a different pass.
      c.bailouts.push("no prototype methods");
    }
    c.bailouts = [...new Set(c.bailouts)];
  }
  return cands;
}

/* Diagnostic, matching the SCRIPTC_*_WHY convention (SCRIPTC_SETNEW_WHY and
 * friends): it reads the AST and prints, and it never lowers anything, so
 * setting it cannot change what the compiler builds. Character offsets rather
 * than lines because the inputs this matters for are minified to one line. */
function whyPrint(sf: ts.SourceFile, classes: readonly ProtoClass[]): void {
  const file = sf.fileName;
  for (const c of classes) {
    // A candidate whose ONLY objection is that it has no prototype methods is a
    // record factory, not a class anyone was hoping to lower. There are 130 of
    // those in zapo's bundle against 10 that carry a real verdict, and printing
    // them buries the answer.
    if (c.bailouts.length === 1 && c.bailouts[0] === "no prototype methods") continue;
    const verdict = c.bailouts.length === 0 ? "USABLE" : "refused";
    console.error(
      `[protoclass] ${verdict} '${c.name}' at ${file}:${c.ctor.getStart()}` +
        ` fields=${c.fields.length} methods=${c.methods.length}` +
        ` merged=${c.mergedMethods.length} protoConsts=${c.protoConsts.length}` +
        ` statics=${c.statics.length}` +
        ` shape={${c.fields.map((f) => f.name + (f.conditional ? "?" : "") +
          (f.reassignedInMethod ? "*" : "")).join(",")}}`,
    );
    // Collapse by REASON: a refusal repeated at 7 offsets is one fact, and
    // the raw list ran to 1,612 lines on zapo's bundle, which is not a
    // diagnostic anyone reads. First offset is kept, since one example is
    // what you actually go and look at.
    const byReason = new Map<string, { n: number; first: string }>();
    for (const b of c.bailouts) {
      const at = b.lastIndexOf(" @");
      const reason = at >= 0 ? b.slice(0, at) : b;
      const where = at >= 0 ? b.slice(at + 2) : "";
      const e = byReason.get(reason);
      if (e) e.n++;
      else byReason.set(reason, { n: 1, first: where });
    }
    for (const [reason, e] of byReason) {
      console.error(
        `[protoclass]   bailout: ${reason}` +
          (e.first !== "" ? ` (${e.n}x, first @${e.first})` : ""),
      );
    }
  }
}

/** Only the classes safe to lower. Kept separate so callers cannot forget the check. */
export function usableProtoClasses(sf: ts.SourceFile): ProtoClass[] {
  const all = findProtoClasses(sf);
  if (process.env["SCRIPTC_PROTOCLASS_WHY"] !== undefined) whyPrint(sf, all);
  return all.filter((c) => c.bailouts.length === 0);
}
