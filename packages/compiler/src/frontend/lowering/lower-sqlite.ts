/* better-sqlite3 — the ONE npm package the static lane serves itself.
 *
 * The other four store drivers this project surveyed (pg, mysql2,
 * ioredis, mongodb) are pure-JS protocol clients whose own source is what
 * would run; what stops them is a language construct, and the fix is in
 * the compiler, not in a vendored library. better-sqlite3 has no JS worth
 * compiling — 653 lines of argument validation over
 * `require('bindings')('better_sqlite3.node')` — so interception is not a
 * preference here, it is the only route. See scr_sqlite.c's header and
 * ambient/scriptc-sqlite.d.ts's.
 *
 * ── the rule this file is written to ──────────────────────────────────
 *
 * COMPLETE OR REFUSE. Measured on this project: serving a partial surface
 * produces `undefined` where Node returns a function, at exit 0 with
 * nothing printed, and eleven of thirty `require` shapes were silently
 * wrong before anyone noticed. So every member of better-sqlite3's
 * documented surface appears below EXACTLY ONCE — either with a lowering
 * that matches the package byte for byte, or in the refusal table with
 * the reason and the alternative. There is no third case, and a member
 * this file does not name cannot reach the runtime.
 *
 * The refusals are deliberate scope, not omissions:
 *
 *   db.transaction        needs a FUNCTION VALUE carrying four sibling
 *                         functions and a `database` back-reference as
 *                         own properties. The static lane has no
 *                         representation for a function with properties,
 *                         and the wrapper's semantics (savepoint when
 *                         already in a transaction, rollback-to on
 *                         throw) are reproducible from exec() — which is
 *                         what zapo's own store-sqlite does, using plain
 *                         BEGIN/COMMIT/ROLLBACK and never touching this
 *                         member.
 *   db.function           each wants a JS callback invoked from INSIDE
 *   db.aggregate          the engine, on a stack the compiled program
 *   db.table              does not own. A partial answer here would be a
 *                         callback that never fires.
 *   db.backup             answers a Promise driven by the engine's
 *                         incremental backup stepping.
 *   db.serialize          answers a Buffer of the whole database.
 *   db.loadExtension      loads a shared object; a static binary has no
 *                         loader, and the vendored build omits the API.
 *   db.unsafeMode         only relaxes checks this build does not make.
 *   db.defaultSafeIntegers per-CONNECTION integer stance; the per-
 *                         statement one (stmt.safeIntegers) IS served.
 *   db.explain            answers a second Statement over EXPLAIN.
 *   stmt.iterate          answers an IterableIterator that holds the
 *                         statement open across the loop body.
 *   stmt.bind             pre-binds parameters for every later call —
 *                         its whole point is that later calls take NO
 *                         arguments, which is a mode the three
 *                         executors here do not carry.
 *   Database.SqliteError  the CLASS as a value. Thrown errors DO carry
 *                         name "SqliteError" and the result code as
 *                         `.code`; what has no static answer is
 *                         `instanceof`.
 *   verbose, nativeBinding  the two constructor options above.
 *   new Database(buffer)  deserializing a database from a Buffer.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import {
  BOOL,
  DYN,
  F64,
  IrExpr,
  SQLITEDB_T,
  SQLITESTMT_T,
  SrcLoc,
  STRING,
} from "../../ir/nodes.js";
import { locOf } from "../program.js";

/** better-sqlite3's constructor options. Anything outside this set is a
 * key the package itself ignores — Node's options-record stance — so an
 * unknown key is NOT an error here; the two refused ones are named
 * explicitly because they are real options with real behaviour. */
const OPTION_KEYS = new Set(["readonly", "fileMustExist", "timeout", "verbose", "nativeBinding"]);

/** Members of `Database` with no lowering, each with the reason its
 * refusal prints. Present in the ambient declarations on purpose: a
 * DECLARED member refuses by name, where an undeclared one would refuse
 * as "property does not exist" and send the reader hunting for a typo. */
const DB_REFUSALS: Record<string, string> = {
  transaction:
    "the wrapper is a function value carrying four sibling functions and a `database` back-reference as own properties, which the static lane cannot represent — drive transactions with db.exec(\"BEGIN\") / db.exec(\"COMMIT\") / db.exec(\"ROLLBACK\"), which is what the semantics reduce to",
  function:
    "user-defined SQL functions call back into the program from inside the engine, on a stack a compiled binary does not own",
  aggregate:
    "user-defined aggregates call back into the program from inside the engine, on a stack a compiled binary does not own",
  table:
    "virtual-table modules call back into the program from inside the engine, on a stack a compiled binary does not own",
  backup: "the incremental backup API has no lowering — copy the database file instead",
  serialize: "sqlite3_serialize has no lowering — read the database file instead",
  loadExtension:
    "a compiled binary has no shared-object loader, and the vendored engine is built with SQLITE_OMIT_LOAD_EXTENSION",
  unsafeMode: "it only relaxes checks this build does not make",
  defaultSafeIntegers:
    "the per-connection integer stance has no lowering — set it per statement with stmt.safeIntegers()",
  explain: "it answers a second Statement over EXPLAIN, which has no lowering",
};

/** Members of `Statement` with no lowering. Same contract as DB_REFUSALS. */
const STMT_REFUSALS: Record<string, string> = {
  iterate:
    "the iterator holds the statement open across the loop body, which has no lowering — all() reads every row, and a LIMIT clause bounds it",
  bind:
    "pre-binding exists so that later calls take NO arguments, a statement mode the three executors here do not carry — pass the parameters to run/get/all instead",
};

function strLit(value: string, loc: SrcLoc): IrExpr {
  return { kind: "strLit", value, type: STRING, loc };
}

function boolLit(value: boolean, loc: SrcLoc): IrExpr {
  return { kind: "boolLit", value, type: BOOL, loc };
}

/** The IR type of an expression, or null when it maps to nothing. */
function irTypeOf(L: Lowerer, node: ts.Expression) {
  return L.mapTypeOf(L.typeOf(node));
}

/** True when the expression's own type is a SQLite handle of `kind`. */
function receiverIs(L: Lowerer, node: ts.Expression, kind: "sqliteDb" | "sqliteStmt"): boolean {
  return irTypeOf(L, node)?.kind === kind;
}

/* ── construction ─────────────────────────────────────────────────────
 *
 * `new Database(path, options?)`, and the without-`new` call form the
 * package also supports (its constructor re-enters itself when
 * `new.target` is null — lib/database.js).
 *
 * Claimed by the RESULT TYPE, not by the callee's identity: `new X(...)`
 * whose type is better-sqlite3's `Database` is this constructor whatever
 * name the import bound, and a differently-named `Database` from some
 * other package never maps to the kind (frontend/types.ts requires the
 * declaration's module or package).
 */
export function lowerSqliteNew(L: Lowerer, expr: ts.NewExpression | ts.CallExpression): IrExpr | null {
  const t = L.mapTypeOf(L.typeOf(expr));
  if (t?.kind !== "sqliteDb") return null;
  const loc = locOf(expr);
  const args = expr.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);

  if (args.length > 2) {
    L.noLowering(
      "new Database with more than two arguments",
      expr,
      "the constructor takes a filename and an options record",
    );
  }

  /* The filename. A BUFFER first argument is better-sqlite3's
   * deserialize form (lib/database.js swaps in ":memory:" and hands the
   * bytes to sqlite3_deserialize) — refused by name rather than opened
   * as a file whose path is the buffer's string coercion, which is what
   * silently accepting it would do. */
  let path: IrExpr;
  if (args.length === 0) {
    // `new Database()` — the package's own default is the empty string,
    // which sqlite3_open_v2 reads as a private temporary database.
    path = strLit("", loc);
  } else {
    const first = args[0]!;
    const ft = irTypeOf(L, first);
    if (ft?.kind === "bytes") {
      L.noLowering(
        "new Database(<Buffer>) (the deserialize form)",
        first,
        "sqlite3_deserialize has no lowering — write the bytes to a file and open that",
      );
    }
    if (ft?.kind !== "string") {
      L.noLowering(
        `new Database with a ${L.checker.typeToString(L.typeOf(first))} filename`,
        first,
        "the filename must be a string",
      );
    }
    path = L.lowerExpr(first);
  }

  /* The options record, read KEY BY KEY off an object literal. A computed
   * options record would need the three flags at run time, and the two
   * booleans decide the open MASK — so a non-literal record refuses here
   * instead of silently taking the defaults. */
  let readonly: IrExpr = boolLit(false, loc);
  let mustExist: IrExpr = boolLit(false, loc);
  let timeout: IrExpr = { kind: "numLit", value: 5000, type: F64, loc };

  if (args.length === 2) {
    const opts = args[1]!;
    if (!ts.isObjectLiteralExpression(opts)) {
      L.noLowering(
        "new Database with a computed options record",
        opts,
        "the options must be written as an object literal at the call site — readonly and fileMustExist decide the open mode",
      );
    }
    for (const prop of opts.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        L.noLowering(
          "a shorthand or computed key in the Database options",
          prop,
          "write each option as `name: value`",
        );
      }
      const key = prop.name.text;
      if (!OPTION_KEYS.has(key)) continue; // Node's options stance: unknown keys are ignored
      if (key === "verbose") {
        L.noLowering(
          "the Database `verbose` option",
          prop,
          "it invokes a program callback from inside the engine, on a stack a compiled binary does not own",
        );
      }
      if (key === "nativeBinding") {
        L.noLowering(
          "the Database `nativeBinding` option",
          prop,
          "there is no .node addon to point at — the engine is vendored into the binary",
        );
      }
      const value = L.lowerExpr(prop.initializer);
      if (key === "timeout") {
        if (value.type.kind !== "f64") {
          L.noLowering(
            `a ${value.type.kind} \`timeout\` option`,
            prop,
            "timeout is a whole number of milliseconds",
          );
        }
        timeout = value;
      } else {
        if (value.type.kind !== "bool") {
          L.noLowering(
            `a ${value.type.kind} \`${key}\` option`,
            prop,
            `${key} is a boolean`,
          );
        }
        if (key === "readonly") readonly = value;
        else mustExist = value;
      }
    }
  }

  return { kind: "libCall", fn: "sqlite.open", args: [path, readonly, mustExist, timeout], type: SQLITEDB_T, loc };
}

/* ── the bound-parameter list ─────────────────────────────────────────
 *
 * better-sqlite3's Binder walks the JS `arguments` object: a bare value
 * binds positionally, an ARRAY spreads positionally, and one plain
 * OBJECT supplies every named parameter. All three may be mixed in one
 * call. The static lane's spelling of that heterogeneous list is a
 * `dyn[]`, one element per argument the site wrote — which is why the
 * three executors take one array and not a variadic tail.
 *
 * SPREAD arguments (`stmt.run(...params)`) have no lowering anywhere in
 * this compiler, so they refuse at the spread with the array form named:
 * `stmt.run(params)` binds an array positionally and is the same call.
 */
function paramsArray(L: Lowerer, call: ts.CallExpression, method: string, loc: SrcLoc): IrExpr {
  let args: IrExpr = { kind: "libCall", fn: "sqlite.argsNew", args: [], type: DYN, loc };
  for (const a of call.arguments) {
    if (ts.isSpreadElement(a)) {
      L.noLowering(
        `a spread argument to Statement.${method}`,
        a,
        "pass the array itself — better-sqlite3 binds an array argument positionally, so stmt." +
          method + "(params) is the same call as stmt." + method + "(...params)",
      );
    }
    const lowered = L.lowerExpr(a);
    if (!L.dynConvertible(lowered.type)) L.badType(a, L.typeOf(a));
    const value: IrExpr =
      lowered.type.kind === "dyn" ? lowered : { kind: "dynFrom", value: lowered, type: DYN, loc: locOf(a) };
    args = { kind: "libCall", fn: "sqlite.argsPush", args: [args, value], type: DYN, loc: locOf(a) };
  }
  return args;
}

/** The optional boolean toggle of pluck/raw/expand/safeIntegers. Absent
 * means true, which is the package's own default. */
function toggle(L: Lowerer, call: ts.CallExpression, method: string, loc: SrcLoc): IrExpr {
  if (call.arguments.length === 0) return boolLit(true, loc);
  if (call.arguments.length > 1) {
    L.noLowering(`Statement.${method} with more than one argument`, call, "it takes an optional boolean");
  }
  const value = L.lowerExpr(call.arguments[0]!);
  if (value.type.kind !== "bool") {
    L.noLowering(
      `Statement.${method} with a ${value.type.kind} argument`,
      call.arguments[0]!,
      "it takes an optional boolean",
    );
  }
  return value;
}

function oneString(L: Lowerer, call: ts.CallExpression, what: string): IrExpr {
  if (call.arguments.length !== 1) {
    L.noLowering(`${what} with ${call.arguments.length} arguments`, call, "it takes one SQL string");
  }
  const value = L.lowerExpr(call.arguments[0]!);
  if (value.type.kind !== "string") {
    L.noLowering(
      `${what} with a ${value.type.kind} argument`,
      call.arguments[0]!,
      "it takes one SQL string",
    );
  }
  return value;
}

/* ── method calls ─────────────────────────────────────────────────────*/

export function lowerSqliteMethodCall(
  L: Lowerer,
  call: ts.CallExpression,
  access: ts.PropertyAccessExpression,
): IrExpr | null {
  if (L.chainBlocked(call, access)) return null;
  const onDb = receiverIs(L, access.expression, "sqliteDb");
  const onStmt = !onDb && receiverIs(L, access.expression, "sqliteStmt");
  if (!onDb && !onStmt) return null;
  const name = access.name.text;
  const loc = locOf(call);

  if (onDb) {
    const refusal = DB_REFUSALS[name];
    if (refusal !== undefined) {
      L.noLowering(`Database.${name}`, call, refusal, L.checker.getSymbolAtLocation(access.name));
    }
    const db = L.lowerExpr(access.expression);
    switch (name) {
      case "prepare":
        return {
          kind: "libCall",
          fn: "sqlite.prepare",
          args: [db, oneString(L, call, "Database.prepare")],
          type: SQLITESTMT_T,
          loc,
        };
      case "exec":
        // Answers the DATABASE, like better-sqlite3's wrapper: the
        // declared type and the IR type must agree about the same
        // expression, or `const x = db.exec(s)` is a disagreement
        // between the checker and the backend.
        return {
          kind: "libCall",
          fn: "sqlite.exec",
          args: [db, oneString(L, call, "Database.exec")],
          type: SQLITEDB_T,
          loc,
        };
      case "close":
        if (call.arguments.length !== 0) {
          L.noLowering("Database.close with arguments", call, "close() takes none");
        }
        return { kind: "libCall", fn: "sqlite.close", args: [db], type: SQLITEDB_T, loc };
      case "pragma": {
        if (call.arguments.length < 1 || call.arguments.length > 2) {
          L.noLowering(
            `Database.pragma with ${call.arguments.length} arguments`,
            call,
            "it takes the pragma text and an optional { simple } record",
          );
        }
        const source = L.lowerExpr(call.arguments[0]!);
        if (source.type.kind !== "string") {
          L.noLowering(
            `Database.pragma with a ${source.type.kind} first argument`,
            call.arguments[0]!,
            "the pragma text is a string",
          );
        }
        let simple: IrExpr = boolLit(false, loc);
        if (call.arguments.length === 2) {
          const opts = call.arguments[1]!;
          if (!ts.isObjectLiteralExpression(opts)) {
            L.noLowering(
              "Database.pragma with a computed options record",
              opts,
              "write it as an object literal at the call site: { simple: true }",
            );
          }
          for (const prop of opts.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
              L.noLowering("a shorthand or computed key in the pragma options", prop, "write `simple: value`");
            }
            if (prop.name.text !== "simple") continue;
            const value = L.lowerExpr(prop.initializer);
            if (value.type.kind !== "bool") {
              L.noLowering(
                `a ${value.type.kind} \`simple\` option`,
                prop,
                "simple is a boolean",
              );
            }
            simple = value;
          }
        }
        return { kind: "libCall", fn: "sqlite.pragma", args: [db, source, simple], type: DYN, loc };
      }
      default:
        L.noLowering(
          `Database.${name}`,
          call,
          "the lowered Database surface is prepare, exec, close and pragma, plus the name/open/inTransaction/readonly/memory properties",
          L.checker.getSymbolAtLocation(access.name),
        );
    }
  }

  const refusal = STMT_REFUSALS[name];
  if (refusal !== undefined) {
    L.noLowering(`Statement.${name}`, call, refusal, L.checker.getSymbolAtLocation(access.name));
  }
  const stmt = L.lowerExpr(access.expression);
  switch (name) {
    case "run":
    case "get":
    case "all":
      return {
        kind: "libCall",
        fn: name === "run" ? "sqlite.run" : name === "get" ? "sqlite.get" : "sqlite.all",
        args: [stmt, paramsArray(L, call, name, loc)],
        type: DYN,
        loc,
      };
    case "pluck":
    case "raw":
    case "expand":
    case "safeIntegers":
      return {
        kind: "libCall",
        fn:
          name === "pluck" ? "sqlite.pluck"
          : name === "raw" ? "sqlite.raw"
          : name === "expand" ? "sqlite.expand"
          : "sqlite.safeIntegers",
        args: [stmt, toggle(L, call, name, loc)],
        type: SQLITESTMT_T,
        loc,
      };
    case "columns":
      if (call.arguments.length !== 0) {
        L.noLowering("Statement.columns with arguments", call, "columns() takes none");
      }
      return { kind: "libCall", fn: "sqlite.columns", args: [stmt], type: DYN, loc };
    default:
      L.noLowering(
        `Statement.${name}`,
        call,
        "the lowered Statement surface is run, get, all, pluck, raw, expand, safeIntegers and columns, plus the reader/readonly/busy/source properties",
        L.checker.getSymbolAtLocation(access.name),
      );
  }
}

/* ── property reads ───────────────────────────────────────────────────
 *
 * Reads only. Every one of these is a getter over an internal slot in
 * better-sqlite3 too, so there is no write to serve.
 */
export function lowerSqliteProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  const onDb = receiverIs(L, expr.expression, "sqliteDb");
  const onStmt = !onDb && receiverIs(L, expr.expression, "sqliteStmt");
  if (!onDb && !onStmt) return null;
  const name = expr.name.text;
  const loc = locOf(expr);

  if (onDb) {
    // The method names reach here when a program takes one as a VALUE
    // rather than calling it; those keep the call-site refusal's voice.
    const fn =
      name === "name" ? "sqlite.dbName" as const
      : name === "open" ? "sqlite.dbOpen" as const
      : name === "readonly" ? "sqlite.dbReadonly" as const
      : name === "memory" ? "sqlite.dbMemory" as const
      : name === "inTransaction" ? "sqlite.dbInTx" as const
      : null;
    if (fn === null) return null;
    return {
      kind: "libCall",
      fn,
      args: [L.lowerExpr(expr.expression)],
      type: fn === "sqlite.dbName" ? STRING : BOOL,
      loc,
    };
  }

  const fn =
    name === "source" ? "sqlite.stmtSource" as const
    : name === "reader" ? "sqlite.stmtReader" as const
    : name === "readonly" ? "sqlite.stmtReadonly" as const
    : name === "busy" ? "sqlite.stmtBusy" as const
    : null;
  if (fn === null) return null;
  return {
    kind: "libCall",
    fn,
    args: [L.lowerExpr(expr.expression)],
    type: fn === "sqlite.stmtSource" ? STRING : BOOL,
    loc,
  };
}
