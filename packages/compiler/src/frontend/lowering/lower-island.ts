/* Island-boundary lowering: jsval marshaling into the island (jsvalIn and
 * its boundary fences), island-expression detection, the island method-call
 * surface (Math and number/string methods under --dynamic), and the npm
 * package boundary fences for node_modules-declared symbols. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { BOOL, DYN, F64, IrExpr, IrStmt, IrType, JSVAL, MAX_ISLAND_CALLBACK_ARITY, STRING, VOID, canBoxFuncIntoDyn, canMarshalTypedFuncIntoIsland, funcOf, islandPromisePayloadTag, isUnitType, typeEquals } from "../../ir/nodes.js";
import { ISLAND_SURFACE, IslandFnEntry, STATIC_MATH_CONSTS, STATIC_MATH_FNS, boundaryIntoIslandMsg } from "./surfaces.js";
import { requiresDynamicApiDiag, requiresDynamicPackageDiag } from "../../diagnostics/diagnostic.js";
import { canonicalBuiltinModule, dynamicImportSpecOf, isCjsJsFile, isJsSourceFile, locOf, npmPackageNameOf, npmStaticDepSf7 } from "../program.js";
import { isRelativeSpecifier } from "../shared.js";
import { dynamicImportModuleTargetOf, dynamicImportProgramTargetOf, staticDynImportBindingShape } from "./lower-modules.js";
import { pureReemittable } from "./lower-exprs.js";
import { moduleNsStarExports } from "./lower-namespaces.js";
import { PoisonError, dynUndefinedExpr, newFnCtx, own } from "./lowerer.js";

/** True iff the checker's type for this node maps to jsval ('any') —
   * the island test in front of every engine-op lowering (receivers,
   * callees, assignment targets). ALSO true for an identifier bound to an
   * island-HANDLE local whose declared type says otherwise (`const {
   * readFileSync } = await import("fs")` — the binding's declared
   * function/Buffer type never held the value; the handle is the value's
   * only story), so its uses dispatch to engine ops instead of
   * re-reporting the declared type. The one exclusion is promise-mapped
   * declared types: a package promise held as a handle keeps its existing
   * checker-driven dispatch (the await/.catch bridge lowerings own it). */
  export function isIslandExpr(L: Lowerer, node: ts.Expression): boolean {
    const mapped = L.mapTypeOf(L.typeOf(node));
    if (mapped?.kind === "jsval") return true;
    if (mapped?.kind !== "promise" && ts.isIdentifier(node)) {
      const local = L.peekLocal(node);
      if (local?.type.kind === "jsval") return true;
      // File-scope handle bindings (a module global slotted jsval by the
      // island-pattern or unchecked-overload rules) take the same rule as
      // locals: the handle is the value's only story.
      if (!local && L.globalOf(node)?.type.kind === "jsval") return true;
    }
    return false;
  }

/** Marshal a static value into the island (--dynamic): primitives by
   * value, JSON-safe composites as a deep copy (the documented aliasing
   * divergence). Values with no island representation — closures, class
   * instances, promises, un-validated 'unknown' — are rejected with the
   * boundary message. */
  /** The call-time deferral of a FUNC-value island crossing in a JS
   * source: captures the just-recorded diagnostic into the runtime-fence
   * ledger and answers a marshaled host closure that THROWS it when
   * invoked — building the value compiles; only a call through the
   * island stops the run. Null (caller rethrows) outside the JS deferral
   * gate: TypeScript sources, probe mode, ICEs. */
  export function islandFuncValueFence(L: Lowerer, err: unknown, diagsBefore: number, node: ts.Node): IrExpr | null {
    if (
      !(err instanceof PoisonError) ||
      !isJsSourceFile(node.getSourceFile()) ||
      L.diagSink !== null ||
      L.diags.length <= diagsBefore ||
      L.diags.slice(diagsBefore).some((d) => d.code === "SC9001")
    ) {
      return null;
    }
    const captured = L.diags.splice(diagsBefore);
    L.runtimeFences.push(...captured);
    const first = captured[0]!;
    const pos = ts.getLineAndCharacterOfPosition(
      L.program.getSourceFile(first.loc.file) ?? node.getSourceFile(),
      first.loc.start,
    );
    const loc = locOf(node);
    const fnName = `%fn${L.lambdaCounter++}_islfence`;
    L.liftedFns.push({
      name: fnName,
      params: [],
      returnType: VOID,
      locals: [],
      captures: [],
      body: [
        {
          kind: "runtimeFence",
          code: first.code,
          message: `${first.message} [${first.code} at ${first.loc.file}:${pos.line + 1}]`,
          loc,
        },
      ],
      loc,
    });
    return {
      kind: "jsMarshal",
      value: { kind: "closure", fnName, captures: [], type: { kind: "func", params: [], ret: VOID }, loc },
      type: JSVAL,
      loc,
    };
  }

  export function jsvalIn(L: Lowerer, e: IrExpr, node: ts.Node): IrExpr {
    if (e.type.kind === "jsval") return e;
    // Bare unit literals (`undefined` / `null` in an 'any' slot): the
    // engine's own units — unit-typed expressions are literals (units have
    // no other producers), so dropping the operand loses nothing.
    if (isUnitType(e.type)) {
      return { kind: "jsOp", op: e.type.kind === "undefinedT" ? "undefLit" : "nullLit", args: [], type: JSVAL, loc: e.loc };
    }
    if (e.type.kind === "dyn") {
      // A CHECKED-DYNAMIC value entering the island: the dyn tree
      // deep-copies into engine values — exactly coerceToExpected's
      // jsval-IN rule (data kinds only; a dyn carrying a boxed
      // function/handle throws the catchable TypeError at runtime).
      return { kind: "jsMarshal", value: e, type: JSVAL, loc: e.loc };
    }
    // Closures cross INTO the island as host functions — THE package
    // callback pattern (`.action((a, b) => ...)`). Unannotated params stay
    // 'any' (contextual typing against package signatures) and pass through
    // as handles; TYPED params convert at call time through the validated-
    // exit machinery (strict primitives, JSON round-trip composites,
    // `T | undefined` taking the undefined arm for an absent argument), so
    // a conversion failure throws back into the island as a TypeError.
    // Anything outside both shapes gets the specific fix, not the generic
    // boundary recitation.
    if (
      e.type.kind === "func" &&
      !canMarshalTypedFuncIntoIsland(e.type, (id) => L.shapes.get(id), (id) => L.unions.get(id))
    ) {
      const diagsBefore = L.diags.length;
      try {
        L.unsupported(
          "SC1090",
          node,
          `functions with this signature crossing into dynamically-executed code ` +
            `(a callback passed to a package/'any' API may take 'any' parameters — ` +
            `leave them unannotated so contextual typing keeps them 'any' — or parameters ` +
            `convertible at the boundary (number, string, boolean, JSON-safe ` +
            `records/arrays/unions, 'T | undefined'), and return 'any', void, number, ` +
            `string, boolean, a JSON-safe composite, or a Promise of the primitive kinds${
              e.type.kind === "func" && e.type.params.length > MAX_ISLAND_CALLBACK_ARITY
                ? `; at most ${MAX_ISLAND_CALLBACK_ARITY} parameters`
                : ""
            })`,
        );
      } catch (err) {
        // JS sources defer the crossing like a statement fence, one level
        // deeper: the slot receives a host closure that THROWS the
        // diagnostic when INVOKED (the withPlugins aggregation shape —
        // wrappers built at module init around functions the smoke path
        // never calls). TypeScript and probe mode keep the poison.
        const fence = islandFuncValueFence(L, err, diagsBefore, node);
        if (fence) return fence;
        throw err;
      }
    }
    // A STATIC promise crossing INTO the island: a real engine thenable
    // settled when the scriptc promise settles (the async-callback return
    // bridge, scr_jsval_from_promise) — the loadBuiltinPlugins cache
    // shape and the island Promise.all arm's static entries. Only
    // fulfillments in the bridge's payload domain cross; the rest keep
    // the boundary fence below with the promise type named.
    if (e.type.kind === "promise" && islandPromisePayloadTag(e.type.inner) !== null) {
      return { kind: "jsMarshal", value: e, type: JSVAL, loc: e.loc };
    }
    if (e.type.kind !== "func" && !L.boundarySafe(e.type)) {
      // A RegExp crossing INTO the island (`z.string().regex(/^a+$/)` —
      // the validation-pattern argument): the engine compiles its own
      // from source+flags. A fresh engine RegExp per marshal — identity
      // and lastIndex state do not cross (SEMANTICS.md). Only literal
      // and pure-read spellings lower (the rebuild reads the operand
      // twice); computed regex values keep the boundary fence.
      if (e.type.kind === "regex") {
        const re = islandRegexpOf(e);
        if (re) return re;
      }
      // jsval-BEARING composites (an `any[]` value, a record holding one)
      // have no JSON marshal but an honest per-field/per-element island
      // construction — the same lift the implicit coercion path uses.
      if (L.jsvalLiftable(e.type)) return L.jsvalLiftExpr(e, e.loc);
      L.unsupported("SC1090", node, boundaryIntoIslandMsg(L.fmt(e.type)));
    }
    return { kind: "jsMarshal", value: e, type: JSVAL, loc: e.loc };
  }

/** A static RegExp value as a fresh ENGINE RegExp — `new RegExp(source,
   * flags)` in the island, the pattern TEXT crossing (both worlds compile
   * the ES-spec grammar). Literals rebuild from their own pattern/flags;
   * pure reads (a regex-typed binding) read the source/flags intrinsics —
   * the rebuild emits the operand twice, so effectful producers return
   * null into the caller's boundary fence. */
  export function islandRegexpOf(e: IrExpr): IrExpr | null {
    if (e.type.kind !== "regex") return null;
    const loc = e.loc;
    let src: IrExpr;
    let flags: IrExpr;
    if (e.kind === "regexLit") {
      src = { kind: "strLit", value: e.pattern, type: STRING, loc };
      flags = { kind: "strLit", value: e.flags, type: STRING, loc };
    } else if (pureReemittable(e)) {
      src = { kind: "regexIntrinsic", method: "source", receiver: e, args: [], type: STRING, loc };
      flags = { kind: "regexIntrinsic", method: "flags", receiver: e, args: [], type: STRING, loc };
    } else {
      return null;
    }
    const ctor: IrExpr = { kind: "jsOp", op: "globalGet", name: "RegExp", args: [], type: JSVAL, loc };
    return {
      kind: "jsOp",
      op: "construct",
      args: [
        ctor,
        { kind: "jsMarshal", value: src, type: JSVAL, loc },
        { kind: "jsMarshal", value: flags, type: JSVAL, loc },
      ],
      type: JSVAL,
      loc,
    };
  }

/** The gate on every ISLAND_SURFACE lowering: under --dynamic the caller
   * proceeds to engine ops; without it the use site is a per-site SC2012
   * (poison-recovered, so every site in the program reports — and the
   * coverage report groups them under "runs with --dynamic"). */
  export function requireDynamicApi(L: Lowerer, feature: string, node: ts.Node): void {
    if (L.dynamic) return;
    L.pushDiag(requiresDynamicApiDiag(feature, locOf(node)));
    throw new PoisonError();
  }

/** Resolves an identifier to an island-backed ambient GLOBAL function
   * (parseFloat, isFinite). Provenance, not name: the
   * symbol's declaration must live in the ambient file, so a user function
   * named `parseFloat` never matches. */
  export function islandGlobalFnOf(L: Lowerer, ident: ts.Identifier): IslandFnEntry | null {
    const entry = own(ISLAND_SURFACE.globals, ident.text);
    if (!entry) return null;
    const symbol = L.resolveValueSymbol(ident);
    if (!symbol || !L.isStdlibSymbol(symbol)) return null;
    return entry;
  }

/** USER-code `fetch(url)` / `fetch(url, init)` — the island-backed ambient
   * global (provenance, not the name: a user's own `fetch` never matches).
   * The engine's own fetch executes (the same one embedded npm code calls —
   * scr_fetch.c over the native net/tls stack): the url marshals in (strings; template
   * results), an init OBJECT LITERAL builds natively in the island through
   * the existing 'any'-contextual literal path (RequestInit maps to jsval,
   * so field values marshal individually and an AbortSignal handle passes
   * straight through), and the engine's promise bridges to a static
   * `promise of jsval` (jsBridgePromise) — `await fetch(...)` parks the
   * fiber like any await and resumes with the Response HANDLE. Member
   * reads/calls on the handle are engine ops; typed extraction happens at
   * the user's narrowing sites through the validated-exit machinery.
   * Without --dynamic every call site is its own SC2012. Null for
   * anything that isn't THE ambient fetch, so lowerCall keeps trying. */
  export function lowerFetchCall(L: Lowerer, call: ts.CallExpression): IrExpr | null {
    const callee = call.expression;
    if (!ts.isIdentifier(callee) || callee.text !== "fetch") return null;
    if (L.chainBlocked(call)) return null;
    const symbol = L.resolveValueSymbol(callee);
    if (!symbol || !L.isStdlibSymbol(symbol)) return null;
    if (call.arguments.length < 1 || call.arguments.length > 2) return null;
    L.requireDynamicApi("'fetch'", call);
    const loc = locOf(call);
    const fetchFn: IrExpr = { kind: "jsOp", op: "globalGet", name: "fetch", args: [], type: JSVAL, loc };
    // Init OBJECT LITERALS build natively in the island (the general
    // 'any'-contextual literal path can't claim them: the optional param's
    // contextual type is `RequestInit | undefined`, a union) — field
    // values marshal individually, so an AbortSignal HANDLE passes
    // through and dashed header keys ("content-type") are plain engine
    // property names. Non-literal inits marshal as a whole (JSON-safe
    // records; a signal field inside one fences with the boundary rule).
    const args = call.arguments.map((a) =>
      ts.isObjectLiteralExpression(a) ? lowerIslandObjectLiteral(L, a) : L.jsvalIn(L.lowerExpr(a), a),
    );
    const raw: IrExpr = { kind: "jsOp", op: "callFn", args: [fetchFn, ...args], type: JSVAL, loc };
    return { kind: "jsBridgePromise", value: raw, type: { kind: "promise", inner: JSVAL }, loc };
  }

/** The program's OWN module a STATIC-tier dynamic `import()` names, or
   * null. Relative specifiers, '#' project aliases and self-names all
   * route through the same two resolvers the collection pass uses (the
   * checker's module symbol for a literal; the program resolver for a
   * folded constant), so this answers exactly the set the fall-through
   * arm below would otherwise hand to requireDynamicApi. Builtins and
   * declaration files answer null — their own arms own them.
   *
   * A BARE specifier can land here too, and deliberately: a
   * --provenance-sources package resolves to a real program source file
   * through the checker's module symbol, so `import("@zapo-js/store-sqlite")`
   * names a program module the same way `import("./m.ts")` does. It is
   * NOT served today, because the module-order walk reaches its deps
   * through dynamicImportProgramTargetOf, which takes relative
   * specifiers only — so the dep has no %init and
   * dynImportBindingDeclOf answers null for it. What the site gets from
   * the message tree below is the accurate reason ("not part of the
   * compiled module graph") and advice that works (import it
   * statically), rather than the blanket engine refusal. Teaching the
   * order walk this same resolver would serve those sites too; that is
   * a separate change, with a separate subgraph to compile. */
  export function dynImportOwnModuleOf(L: Lowerer, call: ts.CallExpression): ts.SourceFile | null {
    if (call.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
    if (call.arguments.length !== 1) return null;
    const arg = call.arguments[0];
    if (arg === undefined) return null;
    const spec = dynamicImportSpecOf(L.checker, arg);
    if (spec === null) return null;
    if (ts.isStringLiteralLike(arg)) {
      const modSym = L.checker.getSymbolAtLocation(arg);
      for (const d of modSym ? L.checker.declarationsOf(modSym) : []) {
        if (ts.isSourceFile(d) && !d.isDeclarationFile) return d;
      }
    }
    return dynamicImportProgramTargetOf(L.program, call.getSourceFile(), spec);
  }

/** `const ns = await import("./m.ts")` / `const { a, b } = await
   * import("./m.ts")` over one of the program's OWN modules, in a STATIC
   * build: the two spellings the static tier serves, and the ONLY two.
   *
   * The declaration is ALIAS PLUMBING with no storage — exactly the
   * shape a top-level `const { x } = require("./m")` already takes
   * (lowerOneVarDecl's require arm): the bindings resolve through
   * resolveValueSymbol to the exporter's own symbols, so a class comes
   * out a CLASS and `new ServerRpc()` is the same construction a static
   * `import { ServerRpc }` compiles, and `ns.<member>` is the same
   * member read a static `import * as ns` compiles. What the statement
   * leaves behind is the module's EVALUATION: one microtask park (Node
   * evaluates a dynamically-imported module after the importer's
   * synchronous code, never at the site) and then the dep's guarded
   * %init.
   *
   * What this deliberately does NOT do is materialize a namespace
   * OBJECT. Node's is exotic — null prototype, "Module" toStringTag,
   * one instance per module, a [[Set]] that always fails — and the
   * static tier has no such value; the identifier paths already refuse a
   * static `import * as ns` used as a first-class value (SC1013) and
   * this binding inherits that refusal by construction, which is why
   * `typeof ns` and passing `ns` along stay refused instead of
   * answering something Node does not.
   *
   * Null for every other shape (a bare `import()` expression, `.then()`,
   * `let`, a default/rest/renamed-to-pattern binding element) — the
   * caller keeps the fence. */
  export function dynImportBindingDepOf(
    L: Lowerer,
    decl: ts.VariableDeclaration,
  ): { dep: ts.SourceFile; call: ts.CallExpression } | null {
    if (L.dynamic) return null; // --dynamic keeps the engine's namespace object
    const init = decl.initializer;
    if (init === undefined || !ts.isAwaitExpression(init)) return null;
    const call = init.expression;
    if (!ts.isCallExpression(call)) return null;
    const list = decl.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return null;
    if (call.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
    if (call.arguments.length !== 1) return null;
    const arg = call.arguments[0];
    if (arg === undefined) return null;
    const spec = dynamicImportSpecOf(L.checker, arg);
    if (spec === null) return null;
    if (ts.isIdentifier(decl.name)) {
      // A plain binding is the `import * as ns` equivalence.
    } else if (ts.isObjectBindingPattern(decl.name)) {
      const ok = decl.name.elements.every(
        (el) =>
          !el.dotDotDotToken &&
          el.initializer === undefined &&
          el.name !== undefined &&
          ts.isIdentifier(el.name) &&
          (el.propertyName === undefined || ts.isIdentifier(el.propertyName)),
      );
      if (!ok) return null;
    } else {
      return null;
    }
    // The SERVING resolver is the module-ORDER walk's own
    // (dynamicImportProgramTargetOf), never the wider one the message tree
    // uses: a dep the order did not append has no %init, and serving a
    // declaration whose module never evaluates would be worse than
    // refusing it.
    const dep = dynamicImportModuleTargetOf(L.program, call.getSourceFile(), spec);
    if (dep === null || dep === L.entry) return null;
    return { dep, call };
  }

/** The same predicate one phase later, when the module tables exist.
   *
   * The split is not cosmetic: collectProgram (and so collectGlobals) runs
   * BEFORE prepareModuleInits, so initNameOf and asyncInitFiles are EMPTY
   * while file-scope globals are being collected. Consulting them there
   * answered "cannot serve" for every top-level declaration, which gave
   * the binding storage, which then made the statement lowering refuse
   * because storage existed — a served shape that worked inside a
   * function and silently did not at file scope. collectGlobals asks the
   * question it can answer at its phase (shape, and the order walk's own
   * resolver, so the two agree by construction); the statement lowering
   * adds the two facts that only exist later. */
  export function dynImportBindingDeclOf(
    L: Lowerer,
    decl: ts.VariableDeclaration,
  ): { dep: ts.SourceFile; call: ts.CallExpression } | null {
    const found = dynImportBindingDepOf(L, decl);
    if (found === null) return null;
    // A module whose init is ASYNC (top-level await in the dep: its
    // evaluation is a promise, and rooting that promise the way a cycle
    // needs has no static twin yet), and one that never joined the
    // compiled graph. Each keeps its own message at the import
    // expression (lowerDynamicImportCall).
    if (L.asyncInitFiles.has(found.dep)) return null;
    if (L.initNameOf.get(found.dep) === undefined) return null;
    return found;
  }

/** The statements a served STATIC-tier `const ... = await import("./m")`
   * declaration leaves behind, and the binding registrations that make
   * its names resolve — or null when this particular declaration cannot
   * be served after all, in which case the caller falls through to the
   * ordinary variable path and the import expression keeps its fence.
   *
   * (dynImportBindingDeclOf already ruled out the modules the tier
   * cannot serve at all; what can still answer null here is a binding
   * NAME that does not resolve to an export of the dep, or one that
   * already owns storage. Either way nothing is emitted: a declaration
   * that evaluated the module and then fenced at its reads would give
   * two answers for one statement.) */
  export function dynImportBindingStmts(
    L: Lowerer,
    decl: ts.VariableDeclaration,
    dep: ts.SourceFile,
    call: ts.CallExpression,
  ): IrStmt[] | null {
    const initName = L.initNameOf.get(dep);
    if (initName === undefined) return null; // dynImportBindingDeclOf already checked
    const loc = locOf(call);

    // The names first: a declaration whose every binding cannot be
    // routed must leave NOTHING behind, or the module would evaluate and
    // the reads would then fence — two answers for one statement.
    const pending: [ts.Symbol, ts.Symbol][] = [];
    if (ts.isObjectBindingPattern(decl.name)) {
      const modSym = L.checker.getSymbolAtLocation(dep);
      const table = new Map<string, ts.Symbol>();
      modSym?.getExports().forEach((sym: ts.Symbol, key: ts.__String) => {
        const n = String(key);
        if (!n.startsWith("__") && n !== "export=") table.set(n, sym);
      });
      // `export *` re-exports are not in the own table; the namespace
      // sees them and so must a destructure off it.
      const star = moduleNsStarExports(L, dep);
      if (star.unresolved !== null) return null;
      for (const [n, sym] of star.entries) if (!table.has(n)) table.set(n, sym);
      for (const el of decl.name.elements) {
        if (el.name === undefined) return null;
        const exportName = (el.propertyName ?? el.name) as ts.Identifier;
        const local = L.checker.getSymbolAtLocation(el.name);
        const exported = table.get(exportName.text);
        if (local === undefined || exported === undefined) return null;
        pending.push([local, exported]);
      }
    }

    const nameSym = ts.isIdentifier(decl.name) ? L.checker.getSymbolAtLocation(decl.name) : undefined;
    if (ts.isIdentifier(decl.name) && nameSym === undefined) return null;
    // A binding that ALREADY owns storage (a module-level global the
    // collect pass registered before this arm existed for it) would have
    // two homes; refuse rather than leave one of them unwritten.
    if (nameSym !== undefined && L.globalsBySymbol.has(nameSym)) return null;
    for (const [local] of pending) if (L.globalsBySymbol.has(local)) return null;

    if (nameSym !== undefined) L.dynNsModuleBindings.set(nameSym, dep);
    for (const [local, exported] of pending) L.dynNsBindings.set(local, exported);

    const evalFn = dynEvalOnceOf(L, dep, initName, loc);
    // `await Promise.resolve()`: one microtask park, so the module body
    // runs on the continuation of the importer's synchronous code —
    // Node's evaluation point — and not inline at the site.
    const park: IrStmt = {
      kind: "exprStmt",
      expr: {
        kind: "awaitExpr",
        value: { kind: "intrinsic", name: "promise.resolve", args: [], type: { kind: "promise", inner: VOID }, loc },
        type: VOID,
        loc,
      },
      loc,
    };
    const init: IrStmt = {
      kind: "exprStmt",
      expr: { kind: "call", callee: evalFn, args: [], type: VOID, loc },
      loc,
    };
    return [park, init];
  }

/** The once-only EVALUATION of a module reached through a served static
   * `import()`, as a synthesized function shared by every site
   * (`%dyneval.<tag>`).
   *
   * It exists for one cell the guarded %init alone gets WRONG, and gets
   * wrong in the shipping --dynamic lane too (measured on v25.9.0 against
   * a module whose body throws): Node remembers a module that threw while
   * evaluating and rejects EVERY later import() of it with the same
   * error, while %loaded only records "ran" — so the second import
   * returned a half-initialized namespace, at exit 0, with the program's
   * own catch never firing. A latch set BEFORE the init call and cleared
   * after needs no stored error to see that: a set latch on entry means
   * the previous evaluation left through the exception edge.
   *
   * The refusal it raises is a DIVERGENCE, not a fix — Node's answer
   * is the original error and this build does not carry it. What it buys
   * is that the wrong value never reaches the program.
   *
   * A re-entrant call (a dynamic import cycle) reads the same latch and
   * takes the same refusal: Node answers a partially-initialized
   * namespace there, which this tier equally cannot build. */
/** A module's file name without its directory — the refusal above names
   * the module, and an absolute path would make the program's own output
   * depend on where the build ran. */
  function baseNameOf(fileName: string): string {
    const cut = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
    return cut < 0 ? fileName : fileName.slice(cut + 1);
  }

  function dynEvalOnceOf(L: Lowerer, dep: ts.SourceFile, initName: string, loc: IrExpr["loc"]): string {
    const cached = L.dynEvalOnce.get(dep);
    if (cached !== undefined) return cached;
    const rawTag = L.fileTag.get(dep) ?? "";
    const tag = rawTag === "" ? "e." : rawTag.replace(/^%/, "");
    const name = `%dyneval.${tag}`;
    L.dynEvalOnce.set(dep, name);
    const flagId = `%g.${tag}%dynentered`;
    L.globalsList.push({ id: flagId, name: "%dynentered", type: BOOL, mutable: true });
    L.noteEdge(initName);
    const flag: IrExpr = { kind: "varRef", localId: flagId, type: BOOL, loc };
    const boolLit = (v: boolean): IrExpr => ({ kind: "boolLit", value: v, type: BOOL, loc });
    L.liftedFns.push({
      name,
      params: [],
      returnType: VOID,
      locals: [],
      // No `captures` key at all: this function is CALLED BY NAME, and a
      // captures array (even an empty one) marks a function as a lifted
      // CLOSURE, which both backends refuse to call directly.
      body: [
        {
          kind: "if",
          cond: flag,
          then: [
            {
              // CENSUS: a runtime fence with no `[SCxxxx at file:line]` of
              // its own — attributed by host name (`%dyneval.<tag>`).
              kind: "runtimeFence",
              code: "SC1090",
              message:
                `re-importing '${baseNameOf(dep.fileName)}' after an evaluation of it did not ` +
                `COMPLETE: Node remembers a module whose body threw and rejects every later ` +
                `import() of it with that same error (and answers a partially-initialized ` +
                `namespace for a re-entrant one). This build carries neither, and the ` +
                `namespace it could build here is the half-initialized one — so it refuses ` +
                `instead of answering that at exit 0. Move the work that can throw out of the ` +
                `module body into an exported function and call it: the failure then belongs ` +
                `to the call, the module evaluates once, and re-importing it is ordinary`,
              loc,
            },
          ],
          else_: null,
          loc,
        },
        { kind: "assign", localId: flagId, value: boolLit(true), loc },
        { kind: "exprStmt", expr: { kind: "call", callee: initName, args: [], type: VOID, loc }, loc },
        { kind: "assign", localId: flagId, value: boolLit(false), loc },
      ],
      loc,
    });
    return name;
  }

/** Dynamic `import(spec)` — the island's module system at a USER site.
   * Under --dynamic the call lowers to island.importDyn(key): the engine
   * loads the module (embedded npm graph, a shipped local .js/.mjs the
   * build embedded, or a builtin shim — collectDynamicImports resolved and
   * embedded the specifier at collection time) and answers an ENGINE
   * promise of the namespace object, bridged to a static
   * `Promise<jsval>` (jsBridgePromise, the fetch precedent) — so `await
   * import(x)` parks the fiber and resumes with the namespace HANDLE, and
   * a load/evaluation failure crosses as a catchable rejection, exactly
   * where Node puts it. Specifiers must be string literals: the module
   * graph is a BUILD-time artifact — a runtime-computed name has nothing
   * to embed, and the fence says so. Static builds report the per-site
   * SC2012. Null for anything that isn't `import(...)`. */
  export function lowerDynamicImportCall(L: Lowerer, call: ts.CallExpression): IrExpr | null {
    if (call.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
    const loc = locOf(call);
    const arg = call.arguments[0];
    // Literals and const-propagated string-LITERAL types both name the
    // module (dynamicImportSpecOf — the named-constant idiom); genuinely
    // computed specifiers keep the fence.
    const spec = arg === undefined ? null : dynamicImportSpecOf(L.checker, arg);
    // STATIC tier, --npm-static: `import()` of an opted-in package is a
    // PROGRAM-MODULE load — no engine anywhere. The guarded %init runs AT
    // the site (a numbered-divergence-style snapshot: Node evaluates on
    // the microtask after the importer's synchronous code; here the
    // argument of the resolved promise evaluates synchronously), and the
    // namespace is a checked-dynamic OBJECT of the module's exports,
    // delivered through an already-resolved static promise. Exports with
    // no dyn crossing ride as trap functions that throw when USED — the
    // namespace still builds, exactly the island path's stance.
    if (!L.dynamic && spec !== null && call.arguments.length === 1) {
      /* STATIC tier, better-sqlite3: the ONE npm package the static lane
       * serves ITSELF, over the vendored SQLite amalgamation
       * (lower-sqlite.ts). A static `import` of it binds a compiler-known
       * surface and the island owns nothing (lower-modules' twin arm);
       * `import()` names the SAME package, so it answers the SAME
       * namespace, through an already-resolved promise. Every use of the
       * namespace is decided by TYPE, not by the value: `new
       * ns.default(path)` is claimed by its RESULT type (lowerSqliteNew
       * never lowers the callee), and `ns.default` as a VALUE is refused
       * by name — the same SC2020 a static `import * as` namespace gives
       * for the same spelling. What the value still has to get right is
       * everything a program can ask of the namespace OBJECT without
       * reading a member, which is the note on the literal below.
       *
       * The guard is the CHECKER's type, not our fold: only
       * `import("better-sqlite3")` — a STRING LITERAL — types as the
       * module namespace. `import(CONST)`, the named-constant idiom
       * dynamicImportSpecOf accepts, does NOT: TypeScript leaves the
       * awaited value `any`, and under `any` none of the type-directed
       * machinery fires — the `new` site would not be claimed and the
       * `.default` refusal would not fire, so the program would reach the
       * namespace VALUE for a construction the compiler never compiled.
       * (Measured, on typescript 5.9.3 AND on the 7.0.2 checker this
       * build uses: `import(SPEC)` types as `any` for a `const SPEC =
       * "better-sqlite3"`, and so does `import(SPEC_LIT)` for a
       * `declare const SPEC_LIT: "better-sqlite3"`. The fold is not the
       * constraint; the CHECKER is.) The values below make that reach a
       * named refusal rather than a wrong answer, but a refusal at the
       * construction is still worse than a build that works, so the
       * constant form keeps the loud failure below, with a message that
       * names the spelling that works. */
      if (spec === "better-sqlite3" && arg !== undefined && ts.isStringLiteralLike(arg)) {
        // The namespace OBJECT, key for key. Node builds this one by
        // running cjs-module-lexer over the package's entry, so it is
        // three keys in this order — better-sqlite3's detected named
        // export, the default, and the `module.exports` alias the lexer
        // adds for a whole-export replacement. (That third key is NODE
        // VERSION dependent — v25 emits it, v22 does not — so the
        // recording it is pinned against names its Node; see the fixture.)
        //
        // Every read of a member as a VALUE is refused by name at its
        // type — but ONLY while the namespace still HAS that type. `let
        // loaded: unknown = await import("better-sqlite3")` widens it in
        // one step, and from there every read is a plain checked-dynamic
        // member access that no type-directed fence can claim. So what
        // these values answer is not a formality: it is the whole
        // boundary, for any program that stores the namespace before
        // using it (zapo's store-sqlite/src/connection.ts:301 declares
        // exactly that `let loaded: unknown`, and its
        // connection.ts:72-83 then probes it with `typeof`).
        //
        // Each of the three is a FUNCTION under Node — better-sqlite3's
        // entry is a whole-export replacement (`module.exports =
        // Database`), so the lexer's named export, the interop `default`,
        // and the `module.exports` alias are all the constructor or the
        // error class. They ride here as TRAP functions (dynTrapFnValue,
        // the --npm-static namespace's own stance one arm below): `typeof`
        // answers "function" the way Node does, `Object.keys` lists them,
        // `in` finds them, and JSON.stringify skips them — and only
        // INVOKING one throws, with the spelling that works named in the
        // message.
        //
        // Two earlier cuts, both silent wrong answers. An EMPTY object
        // failed twice over: `Object.keys(ns)` came back `[]` where Node
        // says three, and `"default" in ns` came back false.
        // UNDEFINED-valued own properties fixed those four cells and left
        // a fifth broken — `typeof ns.default` read "undefined" where
        // Node reads "function", so the standard optional-driver probe
        // (`typeof candidate === 'function'`) took the wrong arm and the
        // program reported "invalid sqlite driver export" at exit 0. A
        // trap function answers that cell correctly and turns the use
        // into a named refusal.
        const nsKey = (name: string, what: string): { key: IrExpr; value: IrExpr } => ({
          key: { kind: "strLit", value: name, type: STRING, loc },
          value: dynTrapFnValue(
            L,
            `the better-sqlite3 namespace's '${name}' export is ${what}, which the ` +
              `static lane serves by TYPE and not as a value — the namespace reached ` +
              `this call through a widening (unknown/any), and nothing left in it ` +
              `names the compiler-served surface. Keep the namespace's type and ` +
              `construct AT the site: \`const ns = await import("better-sqlite3"); ` +
              `const db = new ns.default(path);\` — with no \`: unknown\` (or other ` +
              `annotation) on the binding in between, and no annotation on what ` +
              `\`db.prepare()\` returns`,
            loc,
          ),
        });
        const ns: IrExpr = {
          kind: "dynObjLit",
          fields: [
            nsKey("SqliteError", "the error class"),
            nsKey("default", "the Database constructor"),
            nsKey("module.exports", "the Database constructor (the lexer's whole-export alias)"),
          ],
          type: DYN,
          loc,
        };
        return {
          kind: "intrinsic",
          name: "promise.resolve",
          args: [ns],
          type: { kind: "promise", inner: DYN },
          loc,
        };
      }
      const dep = npmStaticDepSf7(L.program, call.getSourceFile(), spec);
      const builder = dep !== null ? staticDynNsBuilderOf(L, dep, loc) : null;
      if (process.env["SCRIPTC_DYNNS_TRACE"]) {
        console.error(
          `[dynns] spec='${spec}' dep=${dep?.fileName ?? "null"} ` +
            `inOrder=${dep !== null && L.initNameOf.has(dep)} builder=${builder ?? "null"}`,
        );
      }
      if (builder !== null) {
        const ns: IrExpr = { kind: "call", callee: builder, args: [], type: DYN, loc };
        return { kind: "intrinsic", name: "promise.resolve", args: [ns], type: { kind: "promise", inner: DYN }, loc };
      }
      // A bare npm specifier with NO static compilation in this build
      // (not opted in through --npm-static, or the opt-in fell back to
      // the island): the load has no compiled story, and import()'s
      // failure channel is IN-BAND — the site compiles to a REJECTED
      // promise carrying the pointed fence error, catchable at the await
      // exactly where Node surfaces load failures (the optional-
      // dependency try/import pattern is built on that channel). A
      // numbered-divergence-style honesty note: Node with the package
      // installed would LOAD it — this build answers the same failure it
      // would give for a missing loader, never a silent wrong value.
      // Own modules, builtins, '#' project aliases, and relative
      // specifiers keep their compile fences.
      const litModSym = arg !== undefined && ts.isStringLiteralLike(arg) ? L.checker.getSymbolAtLocation(arg) : undefined;
      const ownModule =
        (litModSym !== undefined &&
          L.checker.declarationsOf(litModSym).some((d) => ts.isSourceFile(d) && !d.isDeclarationFile)) ||
        dynamicImportProgramTargetOf(L.program, call.getSourceFile(), spec) !== null;
      if (
        !ownModule &&
        !isRelativeSpecifier(spec) &&
        !spec.startsWith("#") &&
        !spec.startsWith("/") &&
        canonicalBuiltinModule(spec) === null
      ) {
        const msg =
          spec === "better-sqlite3"
            ? // The static lane DOES serve this package (the arm at the top of
              // this function). What it cannot serve is this SPELLING: only a
              // string literal makes TypeScript type the namespace, and every
              // use of a better-sqlite3 namespace is type-directed, so a
              // constant-folded specifier has nothing to bind against. Naming
              // the spelling beats naming the package.
              //
              // The advice used to end "or build with --dynamic". It was
              // RUN, and it is a dead end: under --dynamic the engine loads
              // the real package, but the very use this message names —
              // `new ns.default(path)` — is SC1090 ("constructing values
              // other than classes declared in the program"), so the reader
              // trades a rejected promise for a build error one line later.
              // Only the literal spelling actually gets a database open.
              `Cannot load module 'better-sqlite3': the static lane serves this ` +
              `package itself, but only through a STRING LITERAL specifier — ` +
              `import(<const>) leaves the namespace untyped, and every use of it ` +
              `(new ns.default(path)) is decided by type. Write ` +
              `import("better-sqlite3") at the site and keep the namespace's ` +
              `type: \`const ns = await import("better-sqlite3"); const db = ` +
              `new ns.default(path);\``
            : `Cannot load module '${spec}': dynamic import() of npm packages runs in the ` +
              `embedded dynamic engine, which this build does not include ` +
              `(compile it statically with --npm-static ${spec}, or build with --dynamic)`;
        const err: IrExpr = {
          kind: "libCall",
          fn: "error.new",
          args: [{ kind: "strLit", value: msg, type: STRING, loc }],
          type: { kind: "object", className: "%Error" },
          loc,
        };
        return { kind: "intrinsic", name: "promise.reject", args: [err], type: { kind: "promise", inner: DYN }, loc };
      }
    }
    // A STATIC build reaching an own-module import() here means the site
    // is not one of the two spellings the tier serves (or the module
    // itself cannot be served). The generic SC2012 named none of that,
    // and the advice a reader needs is different in each case — so it
    // is spelled per case, and every spelling below is one that compiles
    // and runs today.
    if (!L.dynamic) {
      const own = dynImportOwnModuleOf(L, call);
      if (own !== null) {
        const named = spec === null ? "the program's own module" : `'${spec}'`;
        const shown = spec === null ? '"./m.ts"' : `"${spec}"`;
        const positionServed = staticDynImportBindingShape(call);
        const why =
          !positionServed
            ? {
                what: `${named} in this position`,
                how:
                  `the static tier serves this import at a CONST binding, where the names ` +
                  `resolve to the module's own declarations (a class stays a class): ` +
                  `\`const ns = await import(${shown})\` for member reads and ` +
                  `Object.keys, or \`const { a, b } = await import(${shown})\` for named ` +
                  `exports. A namespace stored, passed on, or awaited anywhere else has no ` +
                  `static value to be — Node's namespace object is exotic and this build ` +
                  `materializes no stand-in for it`,
              }
            : own === L.entry
            ? {
                what: `the ENTRY module importing itself`,
                how:
                  `the entry's own body is already running or has run, so there is no evaluation ` +
                  `left to order — read the exports directly instead of importing the file that ` +
                  `declares them`,
              }
            : L.asyncInitFiles.has(own)
              ? {
                  what: `${named}, whose module graph uses TOP-LEVEL AWAIT`,
                  how:
                    `its evaluation is a promise, and rooting that promise the way a cycle needs ` +
                    `has no static form yet — import it statically, or move the top-level await ` +
                    `into an exported async function`,
                }
              : {
                  what: `${named}, which is not part of the compiled module graph`,
                  how: `import it statically so the build compiles it`,
                };
        L.pushDiag({
          code: "SC2012",
          message: `'import()' of ${why.what} runs in the embedded dynamic engine, which this build does not include`,
          loc,
          milestone: "M4",
          hint: why.how,
        });
        throw new PoisonError();
      }
    }
    L.requireDynamicApi("'import()'", call);
    if (arg === undefined || spec === null) {
      L.unsupported(
        "SC1090",
        call,
        "dynamic import() of computed specifiers (the module graph embeds at " +
          "build time — the specifier must be a string literal or a constant " +
          "whose type pins one)",
      );
    }
    if (call.arguments.length !== 1) {
      L.unsupported("SC1090", call, "dynamic import() with import attributes");
    }
    const res = L.dynImports.get(`${call.getSourceFile().fileName}\u0000${spec}`);
    if (!res) {
      // Collection walks every file before bodies lower, so a missing
      // entry is a lowerer bug, not user error.
      throw new Error(`lowerer bug: unresolved dynamic import '${spec}'`);
    }
    if (res.kind === "program-module") {
      return lowerOwnModuleImport(L, call, spec, ts.isStringLiteralLike(arg) ? arg : null);
    }
    if (res.kind !== "module") {
      throw new PoisonError(); // resolution failed — collection reported it
    }
    const raw: IrExpr = {
      kind: "libCall",
      fn: "island.importDyn",
      args: [{ kind: "strLit", value: res.key, type: STRING, loc }],
      type: JSVAL,
      loc,
    };
    return { kind: "jsBridgePromise", value: raw, type: { kind: "promise", inner: JSVAL }, loc };
  }

/** Dynamic `import()` of one of the program's OWN modules: the compiled
   * module's exports, marshaled into the engine as a namespace object.
   * The site lowers to `Promise.resolve().then(<builder>)` in the engine —
   * the builder is a synthesized compiled function (dynNsBuilderOf) that
   * runs on the engine MICROTASK, calls the target module's run-once %init
   * (Node's evaluation point for a module first reached through import():
   * after the importer's synchronous code, before the .then handlers), and
   * returns the exports object. Node differences (numbered divergences,
   * pinned in island.test.ts): the namespace is a SNAPSHOT taken when the
   * import resolves (Node's is live), a plain engine object (no Module
   * toStringTag, keys still sorted like Node's, each import minting a
   * fresh object where Node caches one), and exports with no island
   * representation (classes, generic functions, un-marshalable
   * signatures) cross as trap functions that throw a pointed TypeError
   * when USED — the namespace still builds, exactly like Node still
   * resolves it. */
  function lowerOwnModuleImport(L: Lowerer, call: ts.CallExpression, spec: string, litArg: ts.StringLiteralLike | null): IrExpr {
    const loc = locOf(call);
    let dep: ts.SourceFile | null = null;
    // Literal specifiers resolve through the checker's module symbol (the
    // historic route, self-name/#alias answers included); folded constants
    // have no module symbol at the argument, so the resolver answers.
    const modSym = litArg !== null ? L.checker.getSymbolAtLocation(litArg) : undefined;
    for (const d of (modSym ? L.checker.declarationsOf(modSym) : [])) {
      if (ts.isSourceFile(d) && !d.isDeclarationFile) {
        dep = d;
        break;
      }
    }
    if (dep === null) {
      dep = dynamicImportProgramTargetOf(L.program, call.getSourceFile(), spec);
    }
    if (dep !== null && (dep.fileName.endsWith(".cts") || isCjsJsFile(dep))) {
      L.unsupported(
        "SC1090",
        call,
        `dynamic import of the program's own CommonJS module '${spec}' ` +
          "(its namespace comes from module.exports through Node's CJS lexer, " +
          "which has no compiled story — require it, or import it statically)",
      );
    }
    const builder = dep !== null ? dynNsBuilderOf(L, dep, loc) : null;
    if (builder === null) {
      L.unsupported(
        "SC1090",
        call,
        `dynamic import of the program's own module '${spec}' ` +
          "(this module is not part of the compiled module graph — import it statically)",
      );
    }
    const promiseCtor: IrExpr = { kind: "jsOp", op: "globalGet", name: "Promise", args: [], type: JSVAL, loc };
    const resolved: IrExpr = { kind: "jsOp", op: "callMethod", name: "resolve", args: [promiseCtor], type: JSVAL, loc };
    const builderAsync = dep !== null && L.asyncInitFiles.has(dep);
    const builderFn: IrType & { kind: "func" } = {
      kind: "func",
      params: [],
      ret: builderAsync ? { kind: "promise", inner: JSVAL } : JSVAL,
    };
    const marshaled: IrExpr = {
      kind: "jsMarshal",
      value: { kind: "closure", fnName: builder, captures: [], type: builderFn, loc },
      type: JSVAL,
      loc,
    };
    const chained: IrExpr = { kind: "jsOp", op: "callMethod", name: "then", args: [resolved, marshaled], type: JSVAL, loc };
    return { kind: "jsBridgePromise", value: chained, type: { kind: "promise", inner: JSVAL }, loc };
  }

/** The namespace-BUILDER function for one program module, synthesized on
   * first demand and shared by every import() of that module (deterministic
   * name per file tag, so the discovery and emit passes agree). Body: the
   * module's guarded %init (skipped for the entry — it is running or ran),
   * then `return { <sorted exports> }` as an engine object. Null when the
   * module never joined the compiled graph (no %init exists — an empty
   * preflight order or a cycle the extension refused). */
  function dynNsBuilderOf(L: Lowerer, dep: ts.SourceFile, loc: IrExpr["loc"]): string | null {
    const cached = L.dynNsBuilders.get(dep);
    if (cached !== undefined) return cached;
    const initName = L.initNameOf.get(dep);
    if (initName === undefined) return null;
    const rawTag = L.fileTag.get(dep) ?? "";
    const name = `%dynns.${rawTag === "" ? "e." : rawTag.replace(/^%/, "")}`;
    L.dynNsBuilders.set(dep, name);
    const isAsync = L.asyncInitFiles.has(dep);
    const fnCtx = newFnCtx(true, null, null, JSVAL);
    fnCtx.isAsync = isAsync;
    L.fnStack.push(fnCtx);
    try {
      const body: IrStmt[] = [];
      // A synchronous entry has no run-once guard, so its historical
      // self-import path must not call %init again. An ASYNC entry does
      // have the stronger evaluation-promise cache: awaiting that cached
      // promise is essential for top-level `await import("./self")`,
      // which deadlocks (and ultimately exits 13) in Node rather than
      // exposing a half-evaluated namespace.
      if (dep !== L.entry || isAsync) {
        const call: IrExpr = {
          kind: "call",
          callee: initName,
          args: [],
          type: isAsync ? { kind: "promise", inner: VOID } : VOID,
          loc,
        };
        const cyclePromiseId = L.asyncCyclePromiseOf.get(dep);
        if (isAsync && cyclePromiseId !== undefined) {
          // Starting the REQUESTED member matters for dynamically-only
          // cycles: build-time discovery may have encountered another
          // member first, but Node roots evaluation at the first module
          // actually imported at runtime. The spawn wrapper publishes
          // that outermost promise in the SCC's shared slot after eager
          // recursive spawning returns. Discard the member promise here
          // and await the shared root before exposing any namespace.
          body.push({ kind: "exprStmt", expr: call, loc });
          const promiseT: IrType = { kind: "promise", inner: VOID };
          body.push({
            kind: "exprStmt",
            expr: {
              kind: "awaitExpr",
              value: { kind: "varRef", localId: cyclePromiseId, type: promiseT, loc },
              type: VOID,
              loc,
            },
            loc,
          });
        } else {
          body.push({
            kind: "exprStmt",
            expr: isAsync
              ? { kind: "awaitExpr", value: call, type: VOID, loc }
              : call,
            loc,
          });
        }
      }
      // Node sorts module-namespace keys (code-unit order); tsc erases
      // type-only exports, so only VALUE exports appear.
      //
      // getExports() is the module's OWN table and does NOT carry `export
      // *` re-exports — the checker resolves those lazily, per member
      // access. Reading the namespace off it alone answered `undefined`
      // for a star-re-exported binding where Node answers its value, at
      // exit 0, with no diagnostic (measured on main at 27343f6f).
      // moduleNsStarExports walks the chain by Node's own rules.
      const entries: [string, ts.Symbol][] = [];
      const modSym = L.checker.getSymbolAtLocation(dep);
      modSym?.getExports().forEach((sym: ts.Symbol, key: ts.__String) => {
        const n = String(key);
        if (!n.startsWith("__") && n !== "export=") entries.push([n, sym]);
      });
      const star = moduleNsStarExports(L, dep);
      if (star.unresolved !== null) {
        L.unsupported(
          "SC1090",
          dep,
          `a namespace of a module whose \`export * from "${star.unresolved}"\` names a module the build did not compile`,
          "the namespace would silently omit every name that star contributes, which is worse than refusing to build it",
        );
      }
      for (const pair of star.entries) entries.push(pair);
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const args: IrExpr[] = [];
      for (const [exportName, sym] of entries) {
        const value = exportJsvalValue(L, exportName, sym, loc);
        if (value === null) continue;
        args.push(
          { kind: "jsMarshal", value: { kind: "strLit", value: exportName, type: STRING, loc }, type: JSVAL, loc },
          value,
        );
      }
      body.push({ kind: "return", value: { kind: "jsOp", op: "objLit", args, type: JSVAL, loc }, loc });
      const ctx = L.ctx;
      L.liftedFns.push({
        name,
        params: [],
        returnType: JSVAL,
        locals: ctx.locals,
        captures: ctx.captures ?? [],
        body,
        ...(isAsync ? { async: true as const } : {}),
        loc,
      });
    } finally {
      L.fnStack.pop();
    }
    return name;
  }

/** One export's island value for the namespace object — the jsvalIn
   * marshal set (primitives and JSON-safe composites by deep copy, units as
   * the engine's own, marshalable closures as host functions, jsval-bearing
   * composites through the per-field lift), with every UN-marshalable
   * export crossing as a trap function that throws a pointed TypeError when
   * called or constructed — the namespace still builds (Node resolves it;
   * only the USE has no compiled story). Null for exports that do not exist
   * at runtime (type-only). */
  function exportJsvalValue(L: Lowerer, name: string, sym: ts.Symbol, loc: IrExpr["loc"]): IrExpr | null {
    const trap = (what: string): IrExpr =>
      islandTrapFnValue(
        L,
        `the '${name}' export is ${what} of the compiled program, which cannot cross into dynamically-executed code yet`,
        loc,
      );
    let resolved = sym;
    if (sym.flags & ts.SymbolFlags.Alias) {
      // `export type { x }` / `export { type x }`: erased at runtime.
      for (const d of L.checker.declarationsOf(sym)) {
        if (ts.isExportSpecifier(d)) {
          const exportDecl = d.parent.parent;
          if (d.isTypeOnly || (ts.isExportDeclaration(exportDecl) && exportDecl.isTypeOnly)) return null;
        }
        if (ts.isImportSpecifier(d)) {
          const clause = d.parent.parent;
          if (d.isTypeOnly || (ts.isImportClause(clause) && clause.phaseModifier === ts.SyntaxKind.TypeKeyword)) return null;
        }
      }
      resolved = L.checker.getAliasedSymbol(sym);
    }
    if (!(resolved.flags & ts.SymbolFlags.Value)) return null; // pure type surface
    const g = L.globalsBySymbol.get(resolved);
    if (g) {
      const ref: IrExpr = { kind: "varRef", localId: g.id, type: g.type, loc };
      if (ref.type.kind === "jsval") return ref;
      if (isUnitType(ref.type)) {
        return { kind: "jsOp", op: ref.type.kind === "undefinedT" ? "undefLit" : "nullLit", args: [], type: JSVAL, loc };
      }
      if (ref.type.kind === "func") {
        return canMarshalTypedFuncIntoIsland(ref.type, (id) => L.shapes.get(id), (id) => L.unions.get(id))
          ? { kind: "jsMarshal", value: ref, type: JSVAL, loc }
          : trap(`a function value of type '${L.fmt(ref.type)}'`);
      }
      if (L.boundarySafe(ref.type)) return { kind: "jsMarshal", value: ref, type: JSVAL, loc };
      if (L.jsvalLiftable(ref.type)) return L.jsvalLiftExpr(ref, loc);
      return trap(`a value of type '${L.fmt(ref.type)}'`);
    }
    const sig = L.fnSigsBySymbol.get(resolved);
    const decl0 = L.checker.declarationsOf(resolved).find(
      (d) => ts.isFunctionDeclaration(d) && (ts.isSourceFile(d.parent) || L.nsBlocks.get(d.parent) === "flattened"),
    );
    if (sig && decl0) {
      if (!sig.params.every((p) => p.mode === "required")) {
        return trap("a function with optional, default, or rest parameters");
      }
      const funcType: IrType & { kind: "func" } = {
        kind: "func",
        params: sig.params.map((p) => p.type),
        ret: sig.returnType,
      };
      if (!canMarshalTypedFuncIntoIsland(funcType, (id) => L.shapes.get(id), (id) => L.unions.get(id))) {
        return trap(`a function of type '${L.fmt(funcType)}'`);
      }
      L.noteEdge(sig.name);
      return {
        kind: "jsMarshal",
        value: { kind: "closure", fnName: sig.name, captures: [], type: funcType, loc },
        type: JSVAL,
        loc,
      };
    }
    if (L.genericFnsBySymbol.has(resolved)) return trap("a generic function");
    const flags = resolved.flags;
    if (flags & ts.SymbolFlags.Class) return trap("a class");
    if (flags & ts.SymbolFlags.Enum) return trap("an enum object");
    if (flags & ts.SymbolFlags.ValueModule || flags & ts.SymbolFlags.NamespaceModule) {
      return trap("a namespace object");
    }
    return trap("a binding");
  }

/** An engine value whose any USE throws: `new Function("<throw>")` — a
   * real engine function, so the namespace member reads back fine (Node's
   * namespace holds the value too), property probes answer like a
   * function's, and calling or `new`-ing it runs the body, which throws
   * the pointed TypeError. */
  function islandTrapFnValue(L: Lowerer, message: string, loc: IrExpr["loc"]): IrExpr {
    void L;
    const code = `throw new TypeError(${JSON.stringify(message)})`;
    return {
      kind: "jsOp",
      op: "construct",
      args: [
        { kind: "jsOp", op: "globalGet", name: "Function", args: [], type: JSVAL, loc },
        { kind: "jsMarshal", value: { kind: "strLit", value: code, type: STRING, loc }, type: JSVAL, loc },
      ],
      type: JSVAL,
      loc,
    };
  }

/** The STATIC tier's namespace builder for an --npm-static package
   * reached through dynamic `import()` (`%dynnsd.<tag>`): the module's
   * guarded %init, then `return { <sorted exports> }` as a CHECKED-DYNAMIC
   * object — dynNsBuilderOf's shape with the engine replaced by the dyn
   * tree. Interned per module (the dynNsBuilders map serves both tiers —
   * a build is one tier). Null when the module never joined the compiled
   * graph, or when its init is async (top-level await in a package — the
   * island path's business). */
  function staticDynNsBuilderOf(L: Lowerer, dep: ts.SourceFile, loc: IrExpr["loc"]): string | null {
    const cached = L.dynNsBuilders.get(dep);
    if (cached !== undefined) return cached;
    const initName = L.initNameOf.get(dep);
    if (initName === undefined) return null;
    if (L.asyncInitFiles.has(dep)) return null;
    const rawTag = L.fileTag.get(dep) ?? "";
    const name = `%dynnsd.${rawTag === "" ? "e." : rawTag.replace(/^%/, "")}`;
    L.dynNsBuilders.set(dep, name);
    const fnCtx = newFnCtx(true, null, null, DYN);
    L.fnStack.push(fnCtx);
    try {
      const body: IrStmt[] = [];
      L.noteEdge(initName);
      body.push({
        kind: "exprStmt",
        expr: { kind: "call", callee: initName, args: [], type: VOID, loc },
        loc,
      });
      // Node sorts module-namespace keys (code-unit order); type-only
      // exports erase. A CommonJS `export=` becomes the namespace's
      // `default`, exactly Node's CJS-to-ESM view.
      const entries: [string, ts.Symbol][] = [];
      const modSym = L.checker.getSymbolAtLocation(dep);
      modSym?.getExports().forEach((sym: ts.Symbol, key: ts.__String) => {
        const n = String(key);
        if (n === "export=") {
          if (!entries.some(([k]) => k === "default")) entries.push(["default", sym]);
          return;
        }
        if (!n.startsWith("__")) entries.push([n, sym]);
      });
      // getExports() carries the module's OWN table only — `export *`
      // re-exports are not in it, and a namespace built without them
      // answers `undefined` for a name Node answers, silently. Walked.
      const star = moduleNsStarExports(L, dep);
      if (star.unresolved !== null) {
        L.unsupported(
          "SC1090",
          dep,
          `a namespace of a module whose \`export * from "${star.unresolved}"\` names a module the build did not compile`,
          "the namespace would silently omit every name that star contributes, which is worse than refusing to build it",
        );
      }
      for (const pair of star.entries) {
        if (!entries.some(([k]) => k === pair[0])) entries.push(pair);
      }
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const fields: { key: IrExpr; value: IrExpr }[] = [];
      for (const [exportName, sym] of entries) {
        const value = exportDynValue(L, exportName, sym, loc);
        if (value === null) continue;
        fields.push({
          key: { kind: "strLit", value: exportName, type: STRING, loc },
          value,
        });
      }
      body.push({ kind: "return", value: { kind: "dynObjLit", fields, type: DYN, loc }, loc });
      const ctx = L.ctx;
      L.liftedFns.push({
        name,
        params: [],
        returnType: DYN,
        locals: ctx.locals,
        captures: ctx.captures ?? [],
        body,
        loc,
      });
    } finally {
      L.fnStack.pop();
    }
    return name;
  }

/** One export's checked-dynamic value for the static namespace object —
   * the dyn boxing set (dyn globals by reference, convertible values
   * through dynFrom's deep copy, boxable closures through the function
   * boundary), with every un-boxable export crossing as a TRAP function
   * that throws its pointed fence when CALLED — the namespace still
   * builds (the island path's stance: Node resolves it; only the USE has
   * no compiled story). Null for exports that do not exist at runtime
   * (type-only). */
  function exportDynValue(L: Lowerer, name: string, sym: ts.Symbol, loc: IrExpr["loc"]): IrExpr | null {
    const trap = (what: string): IrExpr =>
      dynTrapFnValue(
        L,
        `the '${name}' export is ${what} of the compiled program, which cannot cross into 'unknown' yet`,
        loc,
      );
    let resolved = sym;
    if (sym.flags & ts.SymbolFlags.Alias) {
      for (const d of L.checker.declarationsOf(sym)) {
        if (ts.isExportSpecifier(d)) {
          const exportDecl = d.parent.parent;
          if (d.isTypeOnly || (ts.isExportDeclaration(exportDecl) && exportDecl.isTypeOnly)) return null;
        }
        if (ts.isImportSpecifier(d)) {
          const clause = d.parent.parent;
          if (d.isTypeOnly || (ts.isImportClause(clause) && clause.phaseModifier === ts.SyntaxKind.TypeKeyword)) return null;
        }
      }
      resolved = L.checker.getAliasedSymbol(sym);
    }
    if (!(resolved.flags & ts.SymbolFlags.Value)) return null; // pure type surface
    const g = L.globalsBySymbol.get(resolved);
    if (g) {
      const ref: IrExpr = { kind: "varRef", localId: g.id, type: g.type, loc };
      if (g.type.kind === "dyn") return ref;
      if (g.type.kind === "undefinedT") return dynUndefinedExpr(loc);
      if (g.type.kind === "func") {
        return canBoxFuncIntoDyn(g.type, (id) => L.shapes.get(id), (id) => L.unions.get(id))
          ? { kind: "dynFrom", value: ref, type: DYN, loc }
          : trap(`a function value of type '${L.fmt(g.type)}'`);
      }
      if (L.dynConvertible(g.type)) return { kind: "dynFrom", value: ref, type: DYN, loc };
      return trap(`a value of type '${L.fmt(g.type)}'`);
    }
    const sig = L.fnSigsBySymbol.get(resolved);
    const decl0 = L.checker.declarationsOf(resolved).find(
      (d) => ts.isFunctionDeclaration(d) && (ts.isSourceFile(d.parent) || L.nsBlocks.get(d.parent) === "flattened"),
    );
    if (sig && decl0) {
      if (!sig.params.every((p) => p.mode === "required")) {
        return trap("a function with optional, default, or rest parameters");
      }
      const funcType: IrType & { kind: "func" } = {
        kind: "func",
        params: sig.params.map((p) => p.type),
        ret: sig.returnType,
      };
      if (!canBoxFuncIntoDyn(funcType, (id) => L.shapes.get(id), (id) => L.unions.get(id))) {
        return trap(`a function of type '${L.fmt(funcType)}'`);
      }
      L.noteEdge(sig.name);
      return {
        kind: "dynFrom",
        value: { kind: "closure", fnName: sig.name, captures: [], type: funcType, loc },
        type: DYN,
        loc,
      };
    }
    if (L.genericFnsBySymbol.has(resolved)) return trap("a generic function");
    const flags = resolved.flags;
    if (flags & ts.SymbolFlags.Class) return trap("a class");
    if (flags & ts.SymbolFlags.Enum) return trap("an enum object");
    if (flags & ts.SymbolFlags.ValueModule || flags & ts.SymbolFlags.NamespaceModule) {
      return trap("a namespace object");
    }
    return trap("a binding");
  }

/** A checked-dynamic value whose any CALL throws the pointed fence: a
   * boxed zero-param closure whose body is the runtime fence — `typeof`
   * answers "function", property probes answer like a function's, and
   * only invoking it throws (the island trap's stance, one tier over). */
  function dynTrapFnValue(L: Lowerer, message: string, loc: IrExpr["loc"]): IrExpr {
    const fnName = `%fn${L.lambdaCounter++}_dyntrap`;
    L.liftedFns.push({
      name: fnName,
      params: [],
      returnType: VOID,
      locals: [],
      captures: [],
      // CENSUS: `message` arrives from exportDynValue with no `[SCxxxx at
      // file:line]`, so this refusal is untagged.  Attributed by host name
      // (`%fnN_dyntrap`) in `scripts/tu-census.mjs`.
      body: [{ kind: "runtimeFence", code: "SC1090", message, loc }],
      loc,
    });
    return {
      kind: "dynFrom",
      value: { kind: "closure", fnName, captures: [], type: { kind: "func", params: [], ret: VOID }, loc },
      type: DYN,
      loc,
    };
  }

/** An object literal built NATIVELY in the island — one engine object,
   * each field marshaled individually (nested object/array literals
   * recurse, island handles pass straight through, everything else takes
   * the JSON-safe copy-marshal). The same jsOp the 'any'-contextual
   * literal path emits, callable from lowerings that KNOW the literal is
   * island-bound (fetch's init) even when the contextual type is a union
   * the generic path declines. Identifier AND string-literal keys — engine
   * property names have no identifier restriction ("content-type"). */
  export function lowerIslandObjectLiteral(L: Lowerer, expr: ts.ObjectLiteralExpression): IrExpr {
    const loc = locOf(expr);
    const args: IrExpr[] = [];
    for (const prop of expr.properties) {
      if (
        !ts.isPropertyAssignment(prop) ||
        !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
      ) {
        L.unsupported(
          "SC1090",
          prop,
          "this property form in an island-built object literal (only `name: value` is supported)",
        );
      }
      const nameLoc = locOf(prop.name);
      args.push({
        kind: "jsMarshal",
        value: { kind: "strLit", value: prop.name.text, type: STRING, loc: nameLoc },
        type: JSVAL, loc: nameLoc,
      });
      const init = prop.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        args.push(lowerIslandObjectLiteral(L, init));
      } else if (ts.isArrayLiteralExpression(init) && !init.elements.some(ts.isSpreadElement)) {
        const elems = init.elements.map((el) => L.jsvalIn(L.lowerExpr(el), el));
        args.push({ kind: "jsOp", op: "arrLit", args: elems, type: JSVAL, loc: locOf(init) });
      } else {
        args.push(L.jsvalIn(L.lowerExpr(init), init));
      }
    }
    return { kind: "jsOp", op: "objLit", args, type: JSVAL, loc };
  }

/** Method calls on the island-backed ambient surface: `Math.<fn>(...)`
   * (the engine's own Math object executes) and the number/string methods
   * the static runtime doesn't implement (`x.toPrecision(2)`,
   * `s.replace("a", "b")`, ...). Each site is self-contained — the receiver
   * and arguments marshal in, the engine executes with JS-exact semantics,
   * and the result exits (validated) to the DECLARED static return type,
   * so no jsval leaks into the program's types. tsc has already checked
   * receiver, arity, and argument types against ambient/scriptc.d.ts; an
   * ambient member missing from ISLAND_SURFACE returns null into the
   * existing generic rejections. */
  export function lowerIslandMethodCall(L: Lowerer, call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    if (L.chainBlocked(access, call)) return null;
    const name = access.name.text;
    const loc = locOf(call);
    const finish = (receiver: IrExpr, entry: IslandFnEntry): IrExpr => {
      const args = call.arguments.map((a) => L.jsvalIn(L.lowerExpr(a), a));
      const result: IrExpr = {
        kind: "jsOp", op: "callMethod", name, args: [receiver, ...args], type: JSVAL, loc,
      };
      return { kind: "jsExit", value: result, type: entry.ret, loc };
    };
    // `AbortSignal.timeout(ms)` / `.abort(reason?)` / `.any(signals)` —
    // the fetch-cancellation ambient: the engine's own AbortSignal mints
    // the signal, which stays a HANDLE (its checker type, AbortSignal,
    // maps to jsval — see ISLAND_AMBIENT_TYPES) so it can ride a
    // RequestInit literal into fetch without a JSON detour. The prelude
    // implements all three statics.
    {
      const sigMember = L.stdlibGlobalMember(access, "AbortSignal");
      if (
        (sigMember === "timeout" || sigMember === "abort" || sigMember === "any") &&
        call.arguments.length <= 1 &&
        (sigMember === "abort" || call.arguments.length === 1)
      ) {
        L.requireDynamicApi(`'AbortSignal.${sigMember}'`, call);
        const args = call.arguments.map((a) => L.jsvalIn(L.lowerExpr(a), a));
        const signalGlobal: IrExpr = {
          kind: "jsOp", op: "globalGet", name: "AbortSignal", args: [], type: JSVAL, loc,
        };
        return {
          kind: "jsOp", op: "callMethod", name: sigMember,
          args: [signalGlobal, ...args], type: JSVAL, loc,
        };
      }
    }
    const isMath = L.stdlibGlobalMember(access, "Math") !== null;
    // The STATIC Math members (floor/min/max/random): one C call IS the
    // JS operation — no island, no --dynamic. Only the tabled arity with
    // plain (non-spread) arguments takes this path; other forms fall
    // through to the spread fold / island / lib fence below.
    const staticMath = isMath ? own(STATIC_MATH_FNS, name) : undefined;
    if (
      staticMath &&
      call.arguments.every((a) => !ts.isSpreadElement(a))
    ) {
      // Math.max/Math.min at ANY plain arity — Node's are variadic. The
      // spec's reduction is a left fold of the same NaN-poisoning
      // ±0-ordered scalar compare the two-arg form lowers to, so n
      // arguments nest n-1 scalar calls (arguments still evaluate left to
      // right, before any compare that involves them). One argument is
      // the value itself (every argument here is number-typed, so the
      // spec's ToNumber is the identity — NaN included), and zero
      // arguments are the fold's seed: -Infinity for max, +Infinity for
      // min, exactly Node.
      if (name === "max" || name === "min") {
        if (call.arguments.length === 0) {
          return { kind: "numLit", value: name === "max" ? -Infinity : Infinity, type: F64, loc };
        }
        const args = call.arguments.map((a) => L.lowerExprExpecting(a, F64));
        let acc = args[0]!;
        for (let i = 1; i < args.length; i++) {
          acc = { kind: "libCall", fn: staticMath.fn, args: [acc, args[i]!], type: F64, loc };
        }
        return acc;
      }
      if (call.arguments.length === staticMath.arity) {
        const args = call.arguments.map((a) => L.lowerExprExpecting(a, F64));
        return { kind: "libCall", fn: staticMath.fn, args, type: F64, loc };
      }
    }
    // `Math.max(...xs)` / `Math.min(...xs)` over a number[]: a STATIC
    // runtime fold (JS-exact: NaN poisons, ±0 order by the JS rules, the
    // empty array yields ∓Infinity like the zero-arg calls) — no island
    // involved, so it works without --dynamic too. Only the exact
    // one-spread form lowers; mixed spread/positional argument lists keep
    // the nest-calls fence.
    if (
      isMath &&
      (name === "max" || name === "min") &&
      call.arguments.length === 1 &&
      ts.isSpreadElement(call.arguments[0]!)
    ) {
      const spread = call.arguments[0]! as ts.SpreadElement;
      const src = L.lowerExpr(spread.expression);
      if (src.type.kind !== "array" || src.type.elem.kind !== "f64") {
        L.unsupported(
          "SC1090",
          spread,
          `spreading '${L.fmt(src.type)}' into Math.${name} (only a number[] spreads)`,
        );
      }
      return {
        kind: "libCall",
        fn: name === "max" ? "math.maxArr" : "math.minArr",
        args: [src],
        type: F64,
        loc,
      };
    }
    const mathFn = isMath ? own(ISLAND_SURFACE.math.fns, name) : undefined;
    if (mathFn && call.arguments.length === mathFn.args.length) {
      L.requireDynamicApi(`'Math.${name}'`, call);
      return finish(
        { kind: "jsOp", op: "globalGet", name: "Math", args: [], type: JSVAL, loc },
        mathFn,
      );
    }
    const kind = L.mapTypeOf(L.typeOf(access.expression))?.kind;
    const entry =
      kind === "f64"
        ? own(ISLAND_SURFACE.number, name)
        : kind === "string"
          ? own(ISLAND_SURFACE.string, name)
          : undefined;
    if (!entry || call.arguments.length !== entry.args.length) return null;
    if (!L.isStdlibMember(access)) return null;
    L.requireDynamicApi(
      `'.${name}()' on ${kind === "f64" ? "numbers" : "strings"}`,
      call,
    );
    return finish(L.jsvalIn(L.lowerExpr(access.expression), access.expression), entry);
  }

/** `Math.PI` / `Math.LN2` / … property READS. A Math constant is a
   * LITERAL — the spec pins each one to a double, and the same double is
   * what Node answers — so it folds to a numLit in every build. It used
   * to go through the island's getProp, which meant `Math.PI` needed
   * --dynamic and `Math.LN2` (declared but untabled) fell through to the
   * lib fence; both were accidents of the table, not of the value.
   *
   * Math methods referenced without a call are rejected specifically (no
   * value form exists, --dynamic or not). Null for non-Math receivers
   * (the property chain keeps trying), and null for any island-tabled
   * property the constants table does not name. */
  export function lowerMathProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    const member = L.stdlibGlobalMember(expr, "Math");
    if (member === null) return null;
    const loc = locOf(expr);
    const constant = own(STATIC_MATH_CONSTS, member);
    if (constant !== undefined) return { kind: "numLit", value: constant, type: F64, loc };
    const propType = own(ISLAND_SURFACE.math.props, member);
    if (propType !== undefined) {
      L.requireDynamicApi(`'Math.${member}'`, expr);
      const math: IrExpr = { kind: "jsOp", op: "globalGet", name: "Math", args: [], type: JSVAL, loc };
      const read: IrExpr = { kind: "jsOp", op: "getProp", name: member, args: [math], type: JSVAL, loc };
      return { kind: "jsExit", value: read, type: propType, loc };
    }
    {
      const lifted = mathStaticFnValueOf(L, expr, member);
      if (lifted) return lifted;
    }
    if (
      own(ISLAND_SURFACE.math.fns, member) !== undefined ||
      own(STATIC_MATH_FNS, member) !== undefined
    ) {
      L.unsupported("SC1090", expr, `Math methods as values (call '${member}' directly)`);
    }
    return null; // declared-but-untabled members fall through generically
  }

/** A Math static with a STATIC lowering — `pow`, `floor`, `abs`, `log`,
   * … — taken as a VALUE rather than called, as a memoized lifted
   * function. The `numberStaticPredicateFnValueOf` lift (lower-builtins.ts),
   * one surface over, and for the same reason: a builtin lowers to a
   * libCall at its CALL sites, so it has no closure to hand out and the
   * bare member read fenced.
   *
   * The bundled `long` library is the caller that matters:
   *
   *     var pow = Math.pow;                       // long/umd/index.js
   *     ... s = a <= 48 ? 1 : pow(2, a - 48);     // Long.prototype.divide
   *     ... radixToPower = fromNumber(pow(radix, 6));
   *
   * — the static bound once at module scope and called through the
   * binding, which is how a minifier spells any repeated builtin.
   *
   * The admission rule is the CHECKER's type, not a table of arities: the
   * lift is built only when the declared type maps to exactly
   * `(f64 × arity) => f64`, which is what `lib.es5.d.ts` declares for
   * every fixed-arity entry of STATIC_MATH_FNS. `min`/`max` are declared
   * `(...values: number[]) => number`, which does not map to that shape,
   * so they keep the fence rather than silently becoming binary — the
   * one place where the n-ary call form and a value form would disagree.
   *
   * One divergence, stated (the Number lift's, verbatim): the closure is
   * a fresh allocation per read, so `Math.pow === Math.pow` is false
   * where Node says true. No lowered function value in this compiler
   * carries JS's identity.
   *
   * STATIC builds only — under --dynamic the island owns the value
   * position, exactly as the Number lift does. Memoized per program, per
   * member. Null for everything else. */
  function mathStaticFnValueOf(
    L: Lowerer,
    expr: ts.PropertyAccessExpression,
    member: string,
  ): IrExpr | null {
    if (L.chainBlocked(expr)) return null;
    if (L.dynamic) return null;
    // The CALL form is lowerMathCall's — including the arities and the
    // n-ary min/max fold it handles, which must keep their own paths.
    const parent = expr.parent;
    if (parent && ts.isCallExpression(parent) && parent.expression === expr) return null;
    const entry = own(STATIC_MATH_FNS, member);
    if (entry === undefined) return null;
    const params: IrType[] = [];
    for (let i = 0; i < entry.arity; i++) params.push(F64);
    const fnT = funcOf(params, F64);
    const ft = L.mapTypeOf(L.typeOf(expr));
    if (ft === null || ft === undefined || !typeEquals(ft, fnT)) return null;
    const loc = locOf(expr);
    const name = `%math.${member}.value`;
    if (!L.liftedFns.some((f) => f.name === name)) {
      const ids = params.map((_, i) => `v.${i}`);
      L.liftedFns.push({
        name,
        params: ids.map((id, i) => ({ localId: id, name: `v${i}`, type: F64 })),
        returnType: F64,
        locals: ids.map((id, i) => ({ id, name: `v${i}`, type: F64, mutable: false })),
        body: [
          {
            kind: "return",
            value: {
              kind: "libCall",
              fn: entry.fn,
              args: ids.map((id) => ({ kind: "varRef", localId: id, type: F64, loc }) as IrExpr),
              type: F64,
              loc,
            },
            loc,
          },
        ],
        loc,
      });
    }
    return { kind: "closure", fnName: name, captures: [], type: fnT, loc };
  }

/** The npm package a type is declared by ("commander", "@scope/pkg"),
   * or null when the type isn't package-declared. Union parts are searched
   * too: `string | Command` fails mapping as a whole, but the blame (and
   * the --dynamic attribution) belongs to the package-declared part. */
  export function npmPackageOf(L: Lowerer, type: ts.Type): string | null {
    const pkg = L.npmPackageOfSymbol(type.getAliasSymbol() ?? type.getSymbol());
    if (pkg) return pkg;
    if (type.isUnionType()) {
      for (const part of type.getTypes()) {
        const partPkg = L.npmPackageOf(part);
        if (partPkg) return partPkg;
      }
    }
    return null;
  }

/** The npm chokepoint for member reads and method calls in a STATIC
   * build: a receiver whose type (or member whose symbol) a package's
   * .d.ts declares means the operation runs in the embedded engine —
   * attribute the site to the package instead of the generic property/
   * method rejection. No-op under --dynamic (the island paths claimed
   * these) and for non-package receivers, so callers' fallbacks apply. */
  export function npmMemberFence(L: Lowerer, access: ts.PropertyAccessExpression): void {
    if (L.dynamic) return;
    const pkg =
      L.npmPackageOf(L.typeOf(access.expression)) ??
      L.npmPackageOfSymbol(L.checker.getSymbolAtLocation(access.name));
    if (!pkg) return;
    L.pushDiag(requiresDynamicPackageDiag(pkg, locOf(access)));
    throw new PoisonError();
  }

/** The npm package a SYMBOL is declared by, or null. The symbol half of
   * npmPackageOf, also asked directly for import-alias bindings (whose
   * aliased symbol is the package's export). */
  export function npmPackageOfSymbol(L: Lowerer, sym: ts.Symbol | undefined): string | null {
    const decls = sym ? L.checker.declarationsOf(sym) : undefined;
    if (!decls || decls.length === 0) return null;
    if (!decls.every((d) => L.isNpmFile(d.getSourceFile()))) return null;
    return npmPackageNameOf(decls[0]!.getSourceFile().fileName);
  }
