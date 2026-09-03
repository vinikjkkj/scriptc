/* better-sqlite3 as VALUES — the checked-dynamic half of the one npm
 * package the static lane serves itself.
 *
 * scr_sqlite.c serves the package by TYPE: `new Database(p)` is claimed
 * by its result type and every member call lowers to a libCall on a
 * typed handle. That covers a program that keeps the namespace's type
 * from the import to the construction. It does not cover the shape most
 * optional-driver code is written in, which stores the namespace first:
 *
 *     let loaded: unknown = await import("better-sqlite3")
 *     const Database = loaded as new (p: string) => DatabaseLike
 *     const db = new Database(path)
 *     const prepare = db.prepare ?? db.query
 *
 * From the `unknown` on, nothing is typed, so nothing type-directed can
 * fire — and the namespace's three exports used to ride as TRAP
 * functions whose only correct answer was `typeof`. This unit is what
 * those three become: real callable values, over the SAME entry points
 * the typed lowering calls, so the two lanes cannot answer differently
 * about the same database.
 *
 * ── the shape, and why it is this shape ───────────────────────────────
 *
 * A Database value here is a plain checked-dynamic OBJECT whose members
 * are OWN NON-ENUMERABLE data properties (scr_dyn_obj_define_hidden_data
 * — the encoding scr_dyn_from_error already uses for `message`). Node
 * puts them on Database.prototype, and the observable consequences of
 * "own non-enumerable" and "inherited" are the same for every surface a
 * compiled program has: `Object.keys(db)` is [] both ways,
 * `JSON.stringify(db)` is "{}" both ways, `'prepare' in db` is true both
 * ways, `db.prepare` is the function both ways, and the record walkers
 * read it (scr_dyn_obj_own_data consults the hidden table). They differ
 * on `Object.getOwnPropertyNames`, which this runtime already fences on
 * for a different reason (scr_dyn_own_names_fence), and on
 * `Object.getPrototypeOf`, which no compiled program can spell against
 * an unknown value.
 *
 * COMPLETE OR REFUSE, the rule scr_sqlite.c's header states: every
 * member of better-sqlite3's documented surface is installed below
 * exactly once — with the real lowering, or as a refusal function whose
 * CALL throws the same text the typed lane's refusal prints. There is no
 * third case, because the third case is what the namespace's trap
 * functions were: a member that reads `undefined` where Node reads
 * `function` sends the standard `typeof candidate === 'function'` probe
 * down the wrong arm at exit 0.
 *
 * ── `return this`, and the ring it makes ──────────────────────────────
 *
 * exec/close answer the DATABASE and pluck/raw/expand/safeIntegers answer
 * the STATEMENT (lib/methods/wrappers.js), so each method closure holds
 * the object it was installed on: obj -> hidden member -> FUNC box ->
 * closure capture -> obj. That ring is deliberate and it is COLLECTABLE:
 * the capture is a TRACED box (scr_dyn_trace_v), and a FUNC box traces
 * its closure, so trial deletion sees every edge. Returning a FRESH
 * object over the same handle instead would make `db.exec(a) === db`
 * false where Node says true, which is the silent-wrong-answer direction.
 */
#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>

/* ── captures ─────────────────────────────────────────────────────────*/

static ScrBox *sv_db_cap(ScrSqliteDb *db) {
  ScrBox *b = scr_box_new_obj(scr_sqlite_db_retain_v, scr_sqlite_db_release_v, NULL);
  scr_box_set_ref(b, scr_sqlite_db_retain(db));
  return b;
}

static ScrBox *sv_stmt_cap(ScrSqliteStmt *st) {
  ScrBox *b = scr_box_new_obj(scr_sqlite_stmt_retain_v, scr_sqlite_stmt_release_v, NULL);
  scr_box_set_ref(b, scr_sqlite_stmt_retain(st));
  return b;
}

/* The `return this` capture: TRACED, so the ring above is collectable. */
static ScrBox *sv_self_cap(void) {
  return scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v);
}

/* ── argument reading ─────────────────────────────────────────────────
 * better-sqlite3's own validators, message for message. */

static ScrStr *sv_str_arg(ScrDyn *const *args, size_t argc, const char *msg) {
  ScrDyn *a = argc > 0 ? args[0] : NULL;
  if (a == NULL || a->kind != SCR_DYN_STR) {
    scr_throw_error_msg(SCR_ERR_TYPE, msg, strlen(msg));
    return NULL;
  }
  return a->v.str;
}

/* The EFFECTIVE argument list, for every member that takes a variadic
 * one. A STATIC call through a `(...args: unknown[]) => T` slot hands ONE
 * argument — the emitted PACK — while a direct checked-dynamic call hands
 * one dyn per argument, so a lone dyn ARRAY is the pack and is unwrapped.
 * The rule is stated once here and used by both consumers (sv_args and
 * sv_toggle) rather than spelled twice: `stmt.pluck(true)` through a rest
 * slot arrives as `[[true]]`, and a toggle that read args[0] straight
 * threw "Expected first argument to be a boolean" for a program that had
 * passed one.
 *
 * The optional trailing boolean of pluck/raw/expand/safeIntegers —
 * absent means true, which is the package's own default. */
static bool sv_toggle(ScrDyn *const *args, size_t argc, bool *ok) {
  ScrDyn *first;
  *ok = true;
  if (argc == 1 && args[0] != NULL && args[0]->kind == SCR_DYN_ARR) {
    /* the rest-slot PACK — see sv_args */
    if (args[0]->v.arr.len == 0) return true;
    first = args[0]->v.arr.items[0];
  } else {
    first = argc == 0 ? NULL : args[0];
  }
  if (first == NULL || first->kind == SCR_DYN_UNDEF) return true;
  if (first->kind != SCR_DYN_BOOL) {
    static const char m[] = "Expected first argument to be a boolean";
    scr_throw_error_msg(SCR_ERR_TYPE, m, sizeof m - 1);
    *ok = false;
    return false;
  }
  return first->v.b;
}

/* The bound-parameter LIST run/get/all take — the list scr_sqlite_bind
 * spreads (a bare value binds positionally, an ARRAY spreads
 * positionally, one plain OBJECT supplies the named parameters), so the
 * value lane and the typed lane's argsNew/argsPush chain reach the same
 * Binder with the same list.
 *
 * ── the ONE lone-array rule, and why ──────────────────────────────────
 *
 * These arrive by two routes with two ABIs. A DIRECT checked-dynamic call
 * (`stmt.run(1, 2)`) hands one dyn per argument. A STATIC call through a
 * `(...args: unknown[]) => unknown` slot hands ONE argument: the emitted
 * PACK of the call's arguments, because that is the ABI a rest signature
 * has on the static side (IrType func's `restIn`). A lone dyn ARRAY is
 * therefore ambiguous, and this UNWRAPS it — treats its elements as the
 * argument list.
 *
 * The unwrap agrees with Node on everything either route can produce,
 * because better-sqlite3's own Binder spreads a lone array argument
 * positionally anyway: `run([1, 2])` and `run(1, 2)` are the same call
 * there, so reading the pack as the list and reading it as one array
 * argument only differ where the Binder's two spellings differ — a
 * single OBJECT (named parameters, which the pack must not hide inside
 * an array) and a nested array. Both come out right here.
 *
 * The stated divergence is `stmt.run([[1, 2]])` reached through a DIRECT
 * dyn call: Node spreads the outer array, finds one ARRAY element, and
 * throws "Invalid value" for an unbindable nested array; this binds 1
 * and 2. An error case, and the only cell in the surface where the two
 * routes' ABIs cannot both be honoured. */
static ScrDyn *sv_args(ScrDyn *const *args, size_t argc) {
  ScrDyn *list = scr_dyn_new_arr();
  if (argc == 1 && args[0] != NULL && args[0]->kind == SCR_DYN_ARR) {
    for (uint32_t i = 0; i < args[0]->v.arr.len; i++) {
      scr_dyn_arr_push(list, scr_dyn_retain(args[0]->v.arr.items[i]));
    }
    return list;
  }
  for (size_t i = 0; i < argc; i++) {
    scr_dyn_arr_push(list, args[i] == NULL ? scr_dyn_undefined() : scr_dyn_retain(args[i]));
  }
  return list;
}

/* ── the refusal function ─────────────────────────────────────────────
 * A member better-sqlite3 HAS and this lane does not lower. It is
 * present (so `typeof db.transaction` reads "function" like Node's and a
 * feature probe takes the arm it takes there) and its CALL throws the
 * typed lane's own text, so a reader gets one answer for one member
 * whichever lane they reached it through. */
typedef struct {
  const char *name;
  const char *why;
} SvRefusal;

/* The refused member the closure names, as an INDEX into the one table
 * below rather than a captured pointer: ScrBox has no pointer kind, and
 * an index is the spelling that needs no new one. */
static const SvRefusal *sv_refusal_table(size_t *n);

static ScrDyn *sv_refuse_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args;
  (void)argc;
  size_t n = 0;
  const SvRefusal *tab = sv_refusal_table(&n);
  size_t i = (size_t)scr_box_get_f64(clo->caps[0]);
  const char *text = i < n ? tab[i].why : "an unlowered better-sqlite3 member";
  scr_throw_error_msg(SCR_ERR_ERROR, text, strlen(text));
  return NULL;
}

/* ── Database ─────────────────────────────────────────────────────────*/

static ScrDyn *sv_db_prepare(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_db_exec(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_db_close(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_db_pragma(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_run(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_get(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_all(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_pluck(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_raw(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_expand(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_safe_ints(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *sv_stmt_columns(ScrClosure *clo, ScrDyn *const *args, size_t argc);

ScrDyn *scr_sqlite_value_db(ScrSqliteDb *db);
static ScrDyn *sv_stmt_value(ScrSqliteStmt *st, ScrDyn *dbObj);

/* One installed member: a FUNC box over `thunk`, holding the handle and
 * (for the `return this` methods) the object itself. The signature
 * string is "%better-sqlite3" for every one of them, deliberately: a
 * dynCheck's exact-signature unwrap hands the raw closure to a STATIC
 * call site, and these closures are dyn thunks with the dyn ABI — a
 * name no emitted typeKey can equal keeps every crossing on the ADAPTER
 * path, which converts. */
static const char SV_SIG[] = "%better-sqlite3";

static void sv_install(ScrDyn *obj, const char *name, void *thunk, ScrBox *handle,
                       bool wants_self, uint32_t arity) {
  ScrClosure *clo = scr_closure_new(thunk, wants_self ? 2 : 1);
  clo->caps[0] = handle;
  if (wants_self) {
    clo->caps[1] = sv_self_cap();
    scr_box_set_ref(clo->caps[1], scr_dyn_retain(obj));
  }
  ScrDyn *fn = scr_dyn_new_func(clo, (ScrDynThunk)thunk, arity, SV_SIG, name);
  scr_dyn_obj_define_hidden_data(obj, name, strlen(name), fn, true, true);
  scr_dyn_release(fn);
}

static void sv_install_refusals(ScrDyn *obj, size_t first, size_t count) {
  size_t n = 0;
  const SvRefusal *tab = sv_refusal_table(&n);
  for (size_t i = first; i < first + count && i < n; i++) {
    ScrClosure *clo = scr_closure_new((void *)&sv_refuse_thunk, 1);
    clo->caps[0] = scr_box_new(SCR_BOX_F64);
    scr_box_set_f64(clo->caps[0], (double)i);
    ScrDyn *fn = scr_dyn_new_func(clo, &sv_refuse_thunk, 0, SV_SIG, tab[i].name);
    scr_dyn_obj_define_hidden_data(obj, tab[i].name, strlen(tab[i].name), fn, true, true);
    scr_dyn_release(fn);
  }
}

/* Database's five getters (name/open/readonly/memory/inTransaction).
 * They are ACCESSORS and not data snapshots because two of them CHANGE:
 * `open` is false after close() and `inTransaction` tracks the engine's
 * autocommit flag. A snapshot taken at construction would answer the
 * opening value forever, at exit 0. */
static ScrDyn *sv_db_get_name(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args; (void)argc;
  ScrSqliteDb *db = (ScrSqliteDb *)scr_box_get_ref(clo->caps[0]);
  ScrStr *s = scr_sqlite_db_name(db);
  ScrDyn *r = scr_dyn_new_str(s);
  scr_str_release(s);
  scr_sqlite_db_release(db);
  return r;
}

#define SV_DB_BOOL_GETTER(fn, call)                                                   \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) {              \
    (void)args; (void)argc;                                                           \
    ScrSqliteDb *db = (ScrSqliteDb *)scr_box_get_ref(clo->caps[0]);                   \
    ScrDyn *r = scr_dyn_new_bool(call(db));                                           \
    scr_sqlite_db_release(db);                                                        \
    return r;                                                                         \
  }

SV_DB_BOOL_GETTER(sv_db_get_open, scr_sqlite_db_open)
SV_DB_BOOL_GETTER(sv_db_get_readonly, scr_sqlite_db_readonly)
SV_DB_BOOL_GETTER(sv_db_get_memory, scr_sqlite_db_memory)
SV_DB_BOOL_GETTER(sv_db_get_in_tx, scr_sqlite_db_in_transaction)

#define SV_STMT_BOOL_GETTER(fn, call)                                                 \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) {              \
    (void)args; (void)argc;                                                           \
    ScrSqliteStmt *st = (ScrSqliteStmt *)scr_box_get_ref(clo->caps[0]);               \
    ScrDyn *r = scr_dyn_new_bool(call(st));                                           \
    scr_sqlite_stmt_release(st);                                                      \
    return r;                                                                         \
  }

SV_STMT_BOOL_GETTER(sv_stmt_get_reader, scr_sqlite_stmt_reader)
SV_STMT_BOOL_GETTER(sv_stmt_get_readonly, scr_sqlite_stmt_readonly)
SV_STMT_BOOL_GETTER(sv_stmt_get_busy, scr_sqlite_stmt_busy)

static ScrDyn *sv_stmt_get_source(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args; (void)argc;
  ScrSqliteStmt *st = (ScrSqliteStmt *)scr_box_get_ref(clo->caps[0]);
  ScrStr *s = scr_sqlite_stmt_source(st);
  ScrDyn *r = scr_dyn_new_str(s);
  scr_str_release(s);
  scr_sqlite_stmt_release(st);
  return r;
}

/* The getters are OWN ENUMERABLE accessors, and both halves of that are
 * measured rather than assumed. better-sqlite3 installs them on the
 * INSTANCE, so `Object.keys(db)` answers
 * `name,open,inTransaction,readonly,memory` and `JSON.stringify(db)`
 * answers their VALUES — not `[]` and `{}`, which is what a prototype
 * placement or a non-enumerable one would give, and what this file did
 * before the oracle was read. They are accessors and not data snapshots
 * because two of them CHANGE: `open` is false after close() and
 * `inTransaction` tracks the engine's autocommit flag.
 *
 * INSTALL ORDER IS THE ANSWER: own enumerable keys enumerate in creation
 * order, so the sequence of calls below is Object.keys's output. */
static void sv_install_getter(ScrDyn *obj, const char *name, void *thunk, ScrBox *handle) {
  ScrClosure *clo = scr_closure_new(thunk, 1);
  clo->caps[0] = handle;
  ScrDyn *fn = scr_dyn_new_func(clo, (ScrDynThunk)thunk, 0, SV_SIG, name);
  scr_dyn_obj_define_accessor(obj, name, strlen(name), fn, scr_dyn_undefined(), true, true);
  scr_dyn_release(fn);
}

/* `stmt.database` — the Database the statement was prepared against, the
 * one member of either surface whose value is the OTHER object. Held in
 * a TRACED capture like the `return this` members'. */
static ScrDyn *sv_stmt_get_database(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args; (void)argc;
  return (ScrDyn *)scr_box_get_ref(clo->caps[0]); /* +1 */
}

static void sv_install_db_getter(ScrDyn *obj, ScrDyn *dbObj) {
  ScrClosure *clo = scr_closure_new((void *)&sv_stmt_get_database, 1);
  clo->caps[0] = sv_self_cap();
  scr_box_set_ref(clo->caps[0], scr_dyn_retain(dbObj));
  ScrDyn *fn = scr_dyn_new_func(clo, &sv_stmt_get_database, 0, SV_SIG, "database");
  scr_dyn_obj_define_accessor(obj, "database", 8, fn, scr_dyn_undefined(), true, true);
  scr_dyn_release(fn);
}

/* ONE table, Database's members then Statement's: the thunk names a row
 * by index and the two installers name a RANGE, so a member cannot be
 * installed with another member's text. */
static const SvRefusal SV_REFUSALS[] = {
  { "transaction",
    "Database.transaction is not supported yet: the wrapper is a function value carrying four "
    "sibling functions and a `database` back-reference as own properties, which the static lane "
    "cannot represent — drive transactions with db.exec(\"BEGIN\") / db.exec(\"COMMIT\") / "
    "db.exec(\"ROLLBACK\"), which is what the semantics reduce to" },
  { "function",
    "Database.function is not supported yet: user-defined SQL functions call back into the "
    "program from inside the engine, on a stack a compiled binary does not own" },
  { "aggregate",
    "Database.aggregate is not supported yet: user-defined aggregates call back into the program "
    "from inside the engine, on a stack a compiled binary does not own" },
  { "table",
    "Database.table is not supported yet: virtual-table modules call back into the program from "
    "inside the engine, on a stack a compiled binary does not own" },
  { "backup",
    "Database.backup is not supported yet: the incremental backup API has no lowering — copy the "
    "database file instead" },
  { "serialize",
    "Database.serialize is not supported yet: sqlite3_serialize has no lowering — read the "
    "database file instead" },
  { "loadExtension",
    "Database.loadExtension is not supported yet: a compiled binary has no shared-object loader, "
    "and the vendored engine is built with SQLITE_OMIT_LOAD_EXTENSION" },
  { "unsafeMode",
    "Database.unsafeMode is not supported yet: it only relaxes checks this build does not make" },
  { "defaultSafeIntegers",
    "Database.defaultSafeIntegers is not supported yet: the per-connection integer stance has no "
    "lowering — set it per statement with stmt.safeIntegers()" },
  { "explain",
    "Database.explain is not supported yet: it answers a second Statement over EXPLAIN, which has "
    "no lowering" },

  /* Statement's, from SV_STMT_FIRST. */
  { "iterate",
    "Statement.iterate is not supported yet: the iterator holds the statement open across the "
    "loop body, which has no lowering — all() reads every row, and a LIMIT clause bounds it" },
  { "bind",
    "Statement.bind is not supported yet: pre-binding exists so that later calls take NO "
    "arguments, a statement mode the three executors here do not carry — pass the parameters to "
    "run/get/all instead" },
};

#define SV_DB_FIRST 0
#define SV_DB_COUNT 10
#define SV_STMT_FIRST 10
#define SV_STMT_COUNT 2

static const SvRefusal *sv_refusal_table(size_t *n) {
  *n = sizeof SV_REFUSALS / sizeof SV_REFUSALS[0];
  return SV_REFUSALS;
}

ScrDyn *scr_sqlite_value_db(ScrSqliteDb *db) {
  ScrDyn *obj = scr_dyn_new_obj();
  scr_dyn_obj_set_ctor_name(obj, "Database");
  sv_install(obj, "prepare", (void *)&sv_db_prepare, sv_db_cap(db), true, 1);
  sv_install(obj, "exec", (void *)&sv_db_exec, sv_db_cap(db), true, 1);
  sv_install(obj, "close", (void *)&sv_db_close, sv_db_cap(db), true, 0);
  sv_install(obj, "pragma", (void *)&sv_db_pragma, sv_db_cap(db), false, 2);
  sv_install_refusals(obj, SV_DB_FIRST, SV_DB_COUNT);
  /* Node's creation order — Object.keys(db) and JSON.stringify(db) read
   * name,open,inTransaction,readonly,memory. */
  sv_install_getter(obj, "name", (void *)&sv_db_get_name, sv_db_cap(db));
  sv_install_getter(obj, "open", (void *)&sv_db_get_open, sv_db_cap(db));
  sv_install_getter(obj, "inTransaction", (void *)&sv_db_get_in_tx, sv_db_cap(db));
  sv_install_getter(obj, "readonly", (void *)&sv_db_get_readonly, sv_db_cap(db));
  sv_install_getter(obj, "memory", (void *)&sv_db_get_memory, sv_db_cap(db));
  return obj;
}

static ScrDyn *sv_stmt_value(ScrSqliteStmt *st, ScrDyn *dbObj) {
  ScrDyn *obj = scr_dyn_new_obj();
  scr_dyn_obj_set_ctor_name(obj, "Statement");
  sv_install(obj, "run", (void *)&sv_stmt_run, sv_stmt_cap(st), false, 0);
  sv_install(obj, "get", (void *)&sv_stmt_get, sv_stmt_cap(st), false, 0);
  sv_install(obj, "all", (void *)&sv_stmt_all, sv_stmt_cap(st), false, 0);
  sv_install(obj, "pluck", (void *)&sv_stmt_pluck, sv_stmt_cap(st), true, 1);
  sv_install(obj, "raw", (void *)&sv_stmt_raw, sv_stmt_cap(st), true, 1);
  sv_install(obj, "expand", (void *)&sv_stmt_expand, sv_stmt_cap(st), true, 1);
  sv_install(obj, "safeIntegers", (void *)&sv_stmt_safe_ints, sv_stmt_cap(st), true, 1);
  sv_install(obj, "columns", (void *)&sv_stmt_columns, sv_stmt_cap(st), false, 0);
  sv_install_refusals(obj, SV_STMT_FIRST, SV_STMT_COUNT);
  /* Node's creation order — Object.keys(stmt) reads
   * reader,readonly,source,database,busy. */
  sv_install_getter(obj, "reader", (void *)&sv_stmt_get_reader, sv_stmt_cap(st));
  sv_install_getter(obj, "readonly", (void *)&sv_stmt_get_readonly, sv_stmt_cap(st));
  sv_install_getter(obj, "source", (void *)&sv_stmt_get_source, sv_stmt_cap(st));
  sv_install_db_getter(obj, dbObj);
  sv_install_getter(obj, "busy", (void *)&sv_stmt_get_busy, sv_stmt_cap(st));
  return obj;
}

/* The `return this` answer: the object the method was installed on, +1.
 * caps[1] is the traced self box every such method carries. */
static ScrDyn *sv_self(ScrClosure *clo) {
  return (ScrDyn *)scr_box_get_ref(clo->caps[1]); /* +1 */
}

static ScrDyn *sv_db_prepare(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  static const char m[] = "Expected first argument to be a string";
  ScrSqliteDb *db = (ScrSqliteDb *)scr_box_get_ref(clo->caps[0]);
  ScrStr *sql = sv_str_arg(args, argc, m);
  ScrSqliteStmt *st;
  ScrDyn *r;
  if (sql == NULL) {
    scr_sqlite_db_release(db);
    return NULL;
  }
  st = scr_sqlite_prepare(db, sql);
  scr_sqlite_db_release(db);
  if (st == NULL) return NULL;
  {
    ScrDyn *self = sv_self(clo); /* +1 — the statement's `database` */
    r = sv_stmt_value(st, self);
    scr_dyn_release(self);
  }
  scr_sqlite_stmt_release(st);
  return r;
}

static ScrDyn *sv_db_exec(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  static const char m[] = "Expected first argument to be a string";
  ScrSqliteDb *db = (ScrSqliteDb *)scr_box_get_ref(clo->caps[0]);
  ScrStr *sql = sv_str_arg(args, argc, m);
  ScrSqliteDb *back;
  if (sql == NULL) {
    scr_sqlite_db_release(db);
    return NULL;
  }
  back = scr_sqlite_exec(db, sql);
  scr_sqlite_db_release(db);
  if (back == NULL) return NULL; /* the SqliteError is pending */
  scr_sqlite_db_release(back);
  return sv_self(clo);
}

static ScrDyn *sv_db_close(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args;
  (void)argc;
  ScrSqliteDb *db = (ScrSqliteDb *)scr_box_get_ref(clo->caps[0]);
  ScrSqliteDb *back = scr_sqlite_close(db);
  scr_sqlite_db_release(db);
  if (back == NULL) return NULL;
  scr_sqlite_db_release(back);
  return sv_self(clo);
}

/* db.pragma(source, { simple }) — the options record is READ here rather
 * than folded at a call site, because a value-lane call has no literal to
 * read: `simple` is whatever the caller passed. Node ignores an unknown
 * key in an options record and so does this. */
static ScrDyn *sv_db_pragma(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  static const char m[] = "Expected first argument to be a string";
  ScrSqliteDb *db = (ScrSqliteDb *)scr_box_get_ref(clo->caps[0]);
  ScrStr *src = sv_str_arg(args, argc, m);
  bool simple = false;
  ScrDyn *r;
  if (src == NULL) {
    scr_sqlite_db_release(db);
    return NULL;
  }
  if (argc > 1 && args[1] != NULL && args[1]->kind == SCR_DYN_OBJ) {
    ScrDyn *s = scr_dyn_obj_get(args[1], "simple", 6); /* borrowed */
    simple = s != NULL && s->kind == SCR_DYN_BOOL && s->v.b;
  }
  r = scr_sqlite_pragma(db, src, simple);
  scr_sqlite_db_release(db);
  return r;
}

/* ── Statement ────────────────────────────────────────────────────────*/

#define SV_STMT_EXEC(fn, call)                                                        \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) {              \
    ScrSqliteStmt *st = (ScrSqliteStmt *)scr_box_get_ref(clo->caps[0]);               \
    ScrDyn *list = sv_args(args, argc);                                               \
    ScrDyn *r = call(st, list);                                                       \
    scr_dyn_release(list);                                                            \
    scr_sqlite_stmt_release(st);                                                      \
    return r;                                                                         \
  }

SV_STMT_EXEC(sv_stmt_run, scr_sqlite_run)
SV_STMT_EXEC(sv_stmt_get, scr_sqlite_get)
SV_STMT_EXEC(sv_stmt_all, scr_sqlite_all)

#define SV_STMT_MODE(fn, call)                                                        \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) {              \
    ScrSqliteStmt *st = (ScrSqliteStmt *)scr_box_get_ref(clo->caps[0]);               \
    bool ok = true;                                                                   \
    bool use = sv_toggle(args, argc, &ok);                                            \
    ScrSqliteStmt *back;                                                              \
    if (!ok) {                                                                        \
      scr_sqlite_stmt_release(st);                                                    \
      return NULL;                                                                    \
    }                                                                                 \
    back = call(st, use);                                                             \
    scr_sqlite_stmt_release(st);                                                      \
    if (back == NULL) return NULL;                                                    \
    scr_sqlite_stmt_release(back);                                                    \
    return sv_self(clo);                                                              \
  }

SV_STMT_MODE(sv_stmt_pluck, scr_sqlite_stmt_pluck)
SV_STMT_MODE(sv_stmt_raw, scr_sqlite_stmt_raw)
SV_STMT_MODE(sv_stmt_expand, scr_sqlite_stmt_expand)
SV_STMT_MODE(sv_stmt_safe_ints, scr_sqlite_stmt_safe_ints)

static ScrDyn *sv_stmt_columns(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args;
  (void)argc;
  ScrSqliteStmt *st = (ScrSqliteStmt *)scr_box_get_ref(clo->caps[0]);
  ScrDyn *r = scr_sqlite_stmt_columns(st);
  scr_sqlite_stmt_release(st);
  return r;
}

/* ── the constructor value ────────────────────────────────────────────
 *
 * `new ns.default(path)` and `ns.default(path)` both reach this: the
 * package's own constructor re-enters itself when new.target is null
 * (lib/database.js), so the call form is the same call. scr_dyn_construct
 * builds a fresh instance and then takes an OBJECT result in its place,
 * which is exactly what this returns.
 *
 * The options record is read key by key at RUN time — the typed lowering
 * folds an object literal at the site because it must decide the open
 * mask at compile time, and a value-lane call has no literal to fold. The
 * two REFUSED options (verbose, nativeBinding) refuse here too, by name.
 */
static ScrDyn *sv_database_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrStr *path;
  ScrStr *empty = NULL;
  bool readonly = false, must_exist = false;
  double timeout = 5000.0;
  ScrSqliteDb *db;
  ScrDyn *r;

  if (argc == 0 || args[0] == NULL || args[0]->kind == SCR_DYN_UNDEF) {
    /* `new Database()` — the package's own default is the empty string,
     * which sqlite3_open_v2 reads as a private temporary database. */
    empty = scr_str_new("", 0);
    path = empty;
  } else if (args[0]->kind == SCR_DYN_STR) {
    path = args[0]->v.str;
  } else if (args[0]->kind == SCR_DYN_BYTES) {
    static const char m[] =
        "new Database(<Buffer>) (the deserialize form) is not supported yet: sqlite3_deserialize "
        "has no lowering — write the bytes to a file and open that";
    scr_throw_error_msg(SCR_ERR_ERROR, m, sizeof m - 1);
    return NULL;
  } else {
    static const char m[] = "Expected first argument to be a string";
    scr_throw_error_msg(SCR_ERR_TYPE, m, sizeof m - 1);
    return NULL;
  }

  if (argc > 1 && args[1] != NULL && args[1]->kind == SCR_DYN_OBJ) {
    ScrDyn *v;
    if ((v = scr_dyn_obj_get(args[1], "verbose", 7)) != NULL && v->kind != SCR_DYN_UNDEF) {
      static const char m[] =
          "the Database `verbose` option is not supported yet: it invokes a program callback from "
          "inside the engine, on a stack a compiled binary does not own";
      if (empty) scr_str_release(empty);
      scr_throw_error_msg(SCR_ERR_ERROR, m, sizeof m - 1);
      return NULL;
    }
    if ((v = scr_dyn_obj_get(args[1], "nativeBinding", 13)) != NULL && v->kind != SCR_DYN_UNDEF) {
      static const char m[] =
          "the Database `nativeBinding` option is not supported yet: there is no .node addon to "
          "point at — the engine is vendored into the binary";
      if (empty) scr_str_release(empty);
      scr_throw_error_msg(SCR_ERR_ERROR, m, sizeof m - 1);
      return NULL;
    }
    if ((v = scr_dyn_obj_get(args[1], "readonly", 8)) != NULL) readonly = scr_dyn_truthy(v);
    if ((v = scr_dyn_obj_get(args[1], "fileMustExist", 13)) != NULL) must_exist = scr_dyn_truthy(v);
    if ((v = scr_dyn_obj_get(args[1], "timeout", 7)) != NULL && v->kind == SCR_DYN_NUM) {
      timeout = v->v.num;
    }
  }

  db = scr_sqlite_open(path, readonly, must_exist, timeout);
  if (empty) scr_str_release(empty);
  if (db == NULL) return NULL;
  r = scr_sqlite_value_db(db);
  scr_sqlite_db_release(db);
  return r;
}

/* ONE constructor value per process, and it has to be one: Node's
 * namespace answers the SAME function object for `default` and for the
 * `module.exports` alias the lexer adds (better-sqlite3's entry is a
 * whole-export replacement), and every `import("better-sqlite3")` in one
 * process answers the same module namespace. Two fresh boxes would make
 * `ns.default === ns["module.exports"]` false where Node says true. */
static ScrDyn *sv_ctor_singleton;

ScrDyn *scr_sqlite_value_ctor(void) {
  if (sv_ctor_singleton == NULL) {
    ScrClosure *clo = scr_closure_new((void *)&sv_database_ctor, 0);
    sv_ctor_singleton = scr_dyn_new_func(clo, &sv_database_ctor, 1, SV_SIG, "Database");
  }
  return scr_dyn_retain(sv_ctor_singleton);
}

/* better-sqlite3's error CLASS as a value. `typeof ns.SqliteError` reads
 * "function" like Node's, and the errors this lane throws already carry
 * name "SqliteError" and the result code as `.code` — what has no static
 * answer is `instanceof`, which is why the CALL refuses by name instead
 * of answering a class nothing can be an instance of. */
static ScrDyn *sv_sqlite_error_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  static const char m[] =
      "Database.SqliteError as a constructor is not supported yet: the static lane has no class "
      "value to instantiate — a thrown sqlite error already carries name \"SqliteError\" and the "
      "result code as `.code`, so read those instead of testing `instanceof`";
  scr_throw_error_msg(SCR_ERR_ERROR, m, sizeof m - 1);
  return NULL;
}

static ScrDyn *sv_error_singleton;

ScrDyn *scr_sqlite_value_error_class(void) {
  if (sv_error_singleton == NULL) {
    ScrClosure *clo = scr_closure_new((void *)&sv_sqlite_error_ctor, 0);
    sv_error_singleton = scr_dyn_new_func(clo, &sv_sqlite_error_ctor, 1, SV_SIG, "SqliteError");
  }
  return scr_dyn_retain(sv_error_singleton);
}
