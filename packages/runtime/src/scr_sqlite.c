/* better-sqlite3 over the VENDORED SQLite amalgamation — the static
 * lane's only route to a SQL database.
 *
 * Why interception and not compilation. The other four store drivers in
 * this project's survey (pg, mysql2, ioredis, mongodb) are pure-JS
 * protocol clients: their own source is what would run, and what stops
 * them is a language construct in the compiler, not a missing host
 * capability. better-sqlite3 is the one that has no JS to compile at all
 * — 653 lines of argument validation over
 * `require('bindings')('better_sqlite3.node')`, with 2,186 lines of C++
 * behind it. Compiling the package would compile the validation and
 * arrive at a `require` of machine code. So the implementation has to be
 * ours, and this unit is it.
 *
 * This translation unit links ONLY into binaries whose IR holds a
 * sqliteDb / sqliteStmt value or calls one of the `sqlite.*` libCalls
 * (moduleUsesSqlite — the moduleUsesFetchStatic precedent), and the
 * vendored amalgamation rides the same gate. That matters more here than
 * anywhere else in the runtime: sqlite3.c is 269,649 lines and about
 * 660 KB of object code, which would double a hello-world. A
 * SQLite-free program must produce a BYTE-IDENTICAL binary to the one it
 * produced before this unit existed, and the gate is what makes that
 * true.
 *
 * ── the surface, and what is refused ──────────────────────────────────
 *
 * IMPLEMENTED, completely:
 *   new Database(path)                 new Database(path, options)
 *     options: readonly, fileMustExist, timeout
 *   db.prepare  db.exec  db.pragma  db.close
 *   db.name  db.open  db.inTransaction  db.readonly  db.memory
 *   stmt.run  stmt.get  stmt.all
 *   stmt.pluck  stmt.raw  stmt.expand  stmt.safeIntegers  stmt.columns
 *   stmt.reader  stmt.readonly  stmt.busy  stmt.source
 *   binding by position (varargs and array), by name (plain object)
 *   the five storage classes, both integer stances, BLOB as Buffer
 *   SqliteError-shaped throws: name, code, message
 *
 * REFUSED BY NAME at the call site, never silently:
 *   db.transaction  db.function  db.aggregate  db.table  db.backup
 *   db.serialize  db.loadExtension  db.unsafeMode  db.defaultSafeIntegers
 *   db.explain  stmt.iterate  stmt.bind
 *   the `verbose` and `nativeBinding` options, a Buffer filename
 *   Database.SqliteError as a value (`instanceof` has no static answer)
 *
 * The refusals are the compiler's (lower-sqlite.ts); nothing in this file
 * can be reached by a refused name. The rule they exist for is the one
 * this project paid for in the npm surface: a partial surface answers
 * `undefined` where Node answers a function, at exit 0 with nothing
 * printed, and eleven of thirty require shapes were silently wrong before
 * anyone noticed. A refusal replaced by a wrong answer is worse than the
 * refusal.
 *
 * ── fidelity ──────────────────────────────────────────────────────────
 *
 * Every behaviour below was read off better-sqlite3 13.0.3's own C++
 * (src/util/binder.cpp, src/util/data.cpp, src/objects/statement.cpp,
 * src/objects/database.cpp) and then CHECKED against it running on Node
 * v22.18.0 — the ABI-locked .node refuses to load on Node 25, which is
 * itself an argument for a vendored C engine with no ABI at all. The
 * non-obvious ones, each verified by probe:
 *
 * - A JS NUMBER binds with sqlite3_bind_double, ALWAYS, integral or not.
 *   `insert into t(a) values(?)` with 1 into an affinity-free column
 *   stores REAL, and `typeof(a)` says 'real'. Binding integral doubles as
 *   int64 would be the "obviously right" thing and would diverge.
 * - `undefined` binds as NULL (it shares the null arm of the macro).
 * - A boolean does NOT bind: TypeError "SQLite3 can only bind numbers,
 *   strings, bigints, buffers, and null".
 * - run()'s `changes` is 0 when sqlite3_total_changes did not move,
 *   otherwise sqlite3_changes — NOT sqlite3_changes alone.
 * - get() on a statement that returns no data is a TypeError, not an
 *   empty answer; get() with no matching row is undefined; all() is [].
 * - Too few / too many bound values are RangeErrors, and a missing named
 *   parameter is a RangeError naming the parameter.
 * - prepare() accepts exactly ONE statement; a trailing second statement
 *   is a RangeError, but trailing whitespace and comments are not.
 * - The thrown database error carries the EXTENDED result code's name
 *   (SQLITE_CONSTRAINT_PRIMARYKEY, not SQLITE_CONSTRAINT).
 *
 * The one deliberate divergence: better-sqlite3's SqliteError is a real
 * class, so `err instanceof SqliteError` is answerable there. Here the
 * throw is an Error whose `name` is "SqliteError" and whose `code` is the
 * result-code name — `err.name`, `err.code`, `err.message` and
 * `err instanceof Error` all agree with Node — and the CLASS is refused
 * by name rather than half-served.
 */
#include "scr_runtime.h"
#include "sqlite3.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ── the two handles ──────────────────────────────────────────────────
 *
 * Both are ordinary refcounted runtime objects (the ScrWatcher shape).
 * A statement RETAINS its database: better-sqlite3 keeps the statement
 * alive through the database object it froze onto `stmt.database`, and a
 * statement outliving its handle would step a freed sqlite3*.
 */
typedef struct ScrSqliteDb {
  size_t rc;
  sqlite3 *h;
  ScrStr *name;   /* the filename EXACTLY as the program spelled it */
  bool open;
  bool readonly;
  bool memory;
} ScrSqliteDb;

/* Data::mode, spelled out. FLAT is the default row shape. */
enum { SCR_SQL_FLAT = 0, SCR_SQL_PLUCK = 1, SCR_SQL_EXPAND = 2, SCR_SQL_RAW = 3 };

typedef struct ScrSqliteStmt {
  size_t rc;
  ScrSqliteDb *db; /* retained */
  sqlite3_stmt *h;
  ScrStr *source;
  int mode;
  bool safe_ints;
  bool reader; /* sqlite3_column_count >= 1 — `stmt.reader` */
  bool ro;     /* sqlite3_stmt_readonly — `stmt.readonly` */
  bool alive;
} ScrSqliteStmt;

/* ── result-code names ────────────────────────────────────────────────
 * better-sqlite3's CS::SetCode table, verbatim and in its order. A code
 * absent from the table renders as UNKNOWN_SQLITE_ERROR_<n>, exactly as
 * CS::Code does. */
typedef struct {
  int code;
  const char *name;
} ScrSqliteCode;

static const ScrSqliteCode scr_sqlite_codes[] = {
  {SQLITE_OK, "SQLITE_OK"},
  {SQLITE_ERROR, "SQLITE_ERROR"},
  {SQLITE_INTERNAL, "SQLITE_INTERNAL"},
  {SQLITE_PERM, "SQLITE_PERM"},
  {SQLITE_ABORT, "SQLITE_ABORT"},
  {SQLITE_BUSY, "SQLITE_BUSY"},
  {SQLITE_LOCKED, "SQLITE_LOCKED"},
  {SQLITE_NOMEM, "SQLITE_NOMEM"},
  {SQLITE_READONLY, "SQLITE_READONLY"},
  {SQLITE_INTERRUPT, "SQLITE_INTERRUPT"},
  {SQLITE_IOERR, "SQLITE_IOERR"},
  {SQLITE_CORRUPT, "SQLITE_CORRUPT"},
  {SQLITE_NOTFOUND, "SQLITE_NOTFOUND"},
  {SQLITE_FULL, "SQLITE_FULL"},
  {SQLITE_CANTOPEN, "SQLITE_CANTOPEN"},
  {SQLITE_PROTOCOL, "SQLITE_PROTOCOL"},
  {SQLITE_EMPTY, "SQLITE_EMPTY"},
  {SQLITE_SCHEMA, "SQLITE_SCHEMA"},
  {SQLITE_TOOBIG, "SQLITE_TOOBIG"},
  {SQLITE_CONSTRAINT, "SQLITE_CONSTRAINT"},
  {SQLITE_MISMATCH, "SQLITE_MISMATCH"},
  {SQLITE_MISUSE, "SQLITE_MISUSE"},
  {SQLITE_NOLFS, "SQLITE_NOLFS"},
  {SQLITE_AUTH, "SQLITE_AUTH"},
  {SQLITE_FORMAT, "SQLITE_FORMAT"},
  {SQLITE_RANGE, "SQLITE_RANGE"},
  {SQLITE_NOTADB, "SQLITE_NOTADB"},
  {SQLITE_NOTICE, "SQLITE_NOTICE"},
  {SQLITE_WARNING, "SQLITE_WARNING"},
  {SQLITE_ROW, "SQLITE_ROW"},
  {SQLITE_DONE, "SQLITE_DONE"},
  {SQLITE_ERROR_MISSING_COLLSEQ, "SQLITE_ERROR_MISSING_COLLSEQ"},
  {SQLITE_ERROR_RETRY, "SQLITE_ERROR_RETRY"},
  {SQLITE_ERROR_SNAPSHOT, "SQLITE_ERROR_SNAPSHOT"},
  {SQLITE_IOERR_READ, "SQLITE_IOERR_READ"},
  {SQLITE_IOERR_SHORT_READ, "SQLITE_IOERR_SHORT_READ"},
  {SQLITE_IOERR_WRITE, "SQLITE_IOERR_WRITE"},
  {SQLITE_IOERR_FSYNC, "SQLITE_IOERR_FSYNC"},
  {SQLITE_IOERR_DIR_FSYNC, "SQLITE_IOERR_DIR_FSYNC"},
  {SQLITE_IOERR_TRUNCATE, "SQLITE_IOERR_TRUNCATE"},
  {SQLITE_IOERR_FSTAT, "SQLITE_IOERR_FSTAT"},
  {SQLITE_IOERR_UNLOCK, "SQLITE_IOERR_UNLOCK"},
  {SQLITE_IOERR_RDLOCK, "SQLITE_IOERR_RDLOCK"},
  {SQLITE_IOERR_DELETE, "SQLITE_IOERR_DELETE"},
  {SQLITE_IOERR_BLOCKED, "SQLITE_IOERR_BLOCKED"},
  {SQLITE_IOERR_NOMEM, "SQLITE_IOERR_NOMEM"},
  {SQLITE_IOERR_ACCESS, "SQLITE_IOERR_ACCESS"},
  {SQLITE_IOERR_CHECKRESERVEDLOCK, "SQLITE_IOERR_CHECKRESERVEDLOCK"},
  {SQLITE_IOERR_LOCK, "SQLITE_IOERR_LOCK"},
  {SQLITE_IOERR_CLOSE, "SQLITE_IOERR_CLOSE"},
  {SQLITE_IOERR_DIR_CLOSE, "SQLITE_IOERR_DIR_CLOSE"},
  {SQLITE_IOERR_SHMOPEN, "SQLITE_IOERR_SHMOPEN"},
  {SQLITE_IOERR_SHMSIZE, "SQLITE_IOERR_SHMSIZE"},
  {SQLITE_IOERR_SHMLOCK, "SQLITE_IOERR_SHMLOCK"},
  {SQLITE_IOERR_SHMMAP, "SQLITE_IOERR_SHMMAP"},
  {SQLITE_IOERR_SEEK, "SQLITE_IOERR_SEEK"},
  {SQLITE_IOERR_DELETE_NOENT, "SQLITE_IOERR_DELETE_NOENT"},
  {SQLITE_IOERR_MMAP, "SQLITE_IOERR_MMAP"},
  {SQLITE_IOERR_GETTEMPPATH, "SQLITE_IOERR_GETTEMPPATH"},
  {SQLITE_IOERR_CONVPATH, "SQLITE_IOERR_CONVPATH"},
  {SQLITE_IOERR_VNODE, "SQLITE_IOERR_VNODE"},
  {SQLITE_IOERR_AUTH, "SQLITE_IOERR_AUTH"},
  {SQLITE_IOERR_BEGIN_ATOMIC, "SQLITE_IOERR_BEGIN_ATOMIC"},
  {SQLITE_IOERR_COMMIT_ATOMIC, "SQLITE_IOERR_COMMIT_ATOMIC"},
  {SQLITE_IOERR_ROLLBACK_ATOMIC, "SQLITE_IOERR_ROLLBACK_ATOMIC"},
  {SQLITE_IOERR_DATA, "SQLITE_IOERR_DATA"},
  {SQLITE_IOERR_CORRUPTFS, "SQLITE_IOERR_CORRUPTFS"},
  {SQLITE_LOCKED_SHAREDCACHE, "SQLITE_LOCKED_SHAREDCACHE"},
  {SQLITE_LOCKED_VTAB, "SQLITE_LOCKED_VTAB"},
  {SQLITE_BUSY_RECOVERY, "SQLITE_BUSY_RECOVERY"},
  {SQLITE_BUSY_SNAPSHOT, "SQLITE_BUSY_SNAPSHOT"},
  {SQLITE_BUSY_TIMEOUT, "SQLITE_BUSY_TIMEOUT"},
  {SQLITE_CANTOPEN_NOTEMPDIR, "SQLITE_CANTOPEN_NOTEMPDIR"},
  {SQLITE_CANTOPEN_ISDIR, "SQLITE_CANTOPEN_ISDIR"},
  {SQLITE_CANTOPEN_FULLPATH, "SQLITE_CANTOPEN_FULLPATH"},
  {SQLITE_CANTOPEN_CONVPATH, "SQLITE_CANTOPEN_CONVPATH"},
  {SQLITE_CANTOPEN_DIRTYWAL, "SQLITE_CANTOPEN_DIRTYWAL"},
  {SQLITE_CANTOPEN_SYMLINK, "SQLITE_CANTOPEN_SYMLINK"},
  {SQLITE_CORRUPT_VTAB, "SQLITE_CORRUPT_VTAB"},
  {SQLITE_CORRUPT_SEQUENCE, "SQLITE_CORRUPT_SEQUENCE"},
  {SQLITE_CORRUPT_INDEX, "SQLITE_CORRUPT_INDEX"},
  {SQLITE_READONLY_RECOVERY, "SQLITE_READONLY_RECOVERY"},
  {SQLITE_READONLY_CANTLOCK, "SQLITE_READONLY_CANTLOCK"},
  {SQLITE_READONLY_ROLLBACK, "SQLITE_READONLY_ROLLBACK"},
  {SQLITE_READONLY_DBMOVED, "SQLITE_READONLY_DBMOVED"},
  {SQLITE_READONLY_CANTINIT, "SQLITE_READONLY_CANTINIT"},
  {SQLITE_READONLY_DIRECTORY, "SQLITE_READONLY_DIRECTORY"},
  {SQLITE_ABORT_ROLLBACK, "SQLITE_ABORT_ROLLBACK"},
  {SQLITE_CONSTRAINT_CHECK, "SQLITE_CONSTRAINT_CHECK"},
  {SQLITE_CONSTRAINT_COMMITHOOK, "SQLITE_CONSTRAINT_COMMITHOOK"},
  {SQLITE_CONSTRAINT_FOREIGNKEY, "SQLITE_CONSTRAINT_FOREIGNKEY"},
  {SQLITE_CONSTRAINT_FUNCTION, "SQLITE_CONSTRAINT_FUNCTION"},
  {SQLITE_CONSTRAINT_NOTNULL, "SQLITE_CONSTRAINT_NOTNULL"},
  {SQLITE_CONSTRAINT_PRIMARYKEY, "SQLITE_CONSTRAINT_PRIMARYKEY"},
  {SQLITE_CONSTRAINT_TRIGGER, "SQLITE_CONSTRAINT_TRIGGER"},
  {SQLITE_CONSTRAINT_UNIQUE, "SQLITE_CONSTRAINT_UNIQUE"},
  {SQLITE_CONSTRAINT_VTAB, "SQLITE_CONSTRAINT_VTAB"},
  {SQLITE_CONSTRAINT_ROWID, "SQLITE_CONSTRAINT_ROWID"},
  {SQLITE_CONSTRAINT_PINNED, "SQLITE_CONSTRAINT_PINNED"},
  {SQLITE_CONSTRAINT_DATATYPE, "SQLITE_CONSTRAINT_DATATYPE"},
  {SQLITE_NOTICE_RECOVER_WAL, "SQLITE_NOTICE_RECOVER_WAL"},
  {SQLITE_NOTICE_RECOVER_ROLLBACK, "SQLITE_NOTICE_RECOVER_ROLLBACK"},
  {SQLITE_WARNING_AUTOINDEX, "SQLITE_WARNING_AUTOINDEX"},
  {SQLITE_AUTH_USER, "SQLITE_AUTH_USER"},
  {SQLITE_OK_LOAD_PERMANENTLY, "SQLITE_OK_LOAD_PERMANENTLY"},
  {SQLITE_OK_SYMLINK, "SQLITE_OK_SYMLINK"},
};

/* ── throwing ─────────────────────────────────────────────────────────
 *
 * The SqliteError shape: an Error whose `name` slot reads "SqliteError"
 * and whose `code` slot carries the result-code name. scr_error_new
 * stamps the kind's builtin name into `name`; replacing that one field is
 * what the JS class does too (it defines `name` on its prototype), so
 * `String(err)` reads "SqliteError: no such table: nope" exactly as it
 * does under Node.
 */
static void scr_sqlite_throw_coded(const char *message, size_t mlen, int code) {
  const char *name = NULL;
  char fallback[48];
  size_t i;
  ScrStr *msg;
  ScrError *e;
  for (i = 0; i < sizeof scr_sqlite_codes / sizeof scr_sqlite_codes[0]; i++) {
    if (scr_sqlite_codes[i].code == code) {
      name = scr_sqlite_codes[i].name;
      break;
    }
  }
  if (name == NULL) {
    /* CS::Code's fallback, spelled the same way. */
    int n = 0;
    unsigned u = (unsigned)(code < 0 ? -(long)code : (long)code);
    char digits[16];
    int d = 0;
    do {
      digits[d++] = (char)('0' + (u % 10u));
      u /= 10u;
    } while (u != 0);
    memcpy(fallback, "UNKNOWN_SQLITE_ERROR_", 21);
    n = 21;
    if (code < 0) fallback[n++] = '-';
    while (d > 0) fallback[n++] = digits[--d];
    fallback[n] = '\0';
    name = fallback;
  }
  msg = scr_str_new(message, mlen);
  e = scr_error_new(SCR_ERR_ERROR, msg);
  scr_str_release(msg);
  if (e != NULL) {
    ScrStr *sqname = scr_str_new("SqliteError", 11);
    scr_str_release(e->name);
    e->name = sqname; /* moves the +1 */
    scr_error_set_code(e, name);
    /* MOVES the +1 into the exception cell — scr_throw_obj takes
     * ownership, so there is no release to pair with scr_error_new here. */
    scr_throw_obj(e, scr_error_retain_v, scr_error_release_v, scr_error_trace_arg());
  }
}

/* ── int64 ⇄ BigInt ───────────────────────────────────────────────────
 * scr_bigint.c has no int64 entry point (its constructors are a decimal
 * parse and an integral double), so both directions go through decimal
 * text. That is not a shortcut: a double cannot carry an int64 past 2^53,
 * which is the whole reason safeIntegers exists.
 *
 * The unit is GATED, so every one of these symbols requires scr_bigint.c
 * in the link — cc.ts makes the sqlite gate imply the bigint gate for
 * exactly this reason. */
static ScrBigInt *scr_sqlite_big_from_i64(sqlite3_int64 v) {
  char buf[24];
  int n = 0;
  uint64_t u = v < 0 ? (uint64_t)0 - (uint64_t)v : (uint64_t)v;
  char digits[24];
  int d = 0;
  do {
    digits[d++] = (char)('0' + (int)(u % 10u));
    u /= 10u;
  } while (u != 0);
  if (v < 0) buf[n++] = '-';
  while (d > 0) buf[n++] = digits[--d];
  return scr_big_parse(buf, (size_t)n);
}

/* Napi::BigInt::Int64Value(&lossless): the low 64 bits, plus whether they
 * ARE the value. Round-tripping through the same decimal path is the
 * cheapest exact test available on this API surface. */
static bool scr_sqlite_big_to_i64(const ScrBigInt *b, sqlite3_int64 *out) {
  sqlite3_int64 v = (sqlite3_int64)scr_big_low_u64(b);
  ScrBigInt *back = scr_sqlite_big_from_i64(v);
  bool ok;
  if (back == NULL) return false;
  ok = scr_big_eq(back, b);
  scr_big_release(back);
  if (ok) *out = v;
  return ok;
}

/* sqlite3_errmsg + sqlite3_extended_errcode — Database::ThrowSqliteError. */
static void scr_sqlite_throw_db(sqlite3 *h) {
  const char *m = sqlite3_errmsg(h);
  if (m == NULL) m = "unknown error";
  scr_sqlite_throw_coded(m, strlen(m), sqlite3_extended_errcode(h));
}

static void scr_sqlite_throw_type(const char *m) {
  scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m));
}

static void scr_sqlite_throw_range(const char *m) {
  scr_throw_error_msg(SCR_ERR_RANGE, m, strlen(m));
}

/* ── lifetimes ────────────────────────────────────────────────────────*/

ScrSqliteDb *scr_sqlite_db_retain(ScrSqliteDb *d) {
  if (d != NULL) d->rc++;
  return d;
}

void scr_sqlite_db_release(ScrSqliteDb *d) {
  if (d == NULL || --d->rc != 0) return;
  if (d->h != NULL) sqlite3_close_v2(d->h);
  scr_str_release(d->name);
  free(d);
}

void *scr_sqlite_db_retain_v(void *p) { return scr_sqlite_db_retain((ScrSqliteDb *)p); }
void scr_sqlite_db_release_v(void *p) { scr_sqlite_db_release((ScrSqliteDb *)p); }

ScrSqliteStmt *scr_sqlite_stmt_retain(ScrSqliteStmt *s) {
  if (s != NULL) s->rc++;
  return s;
}

void scr_sqlite_stmt_release(ScrSqliteStmt *s) {
  if (s == NULL || --s->rc != 0) return;
  if (s->alive && s->h != NULL) sqlite3_finalize(s->h);
  scr_str_release(s->source);
  scr_sqlite_db_release(s->db);
  free(s);
}

void *scr_sqlite_stmt_retain_v(void *p) { return scr_sqlite_stmt_retain((ScrSqliteStmt *)p); }
void scr_sqlite_stmt_release_v(void *p) { scr_sqlite_stmt_release((ScrSqliteStmt *)p); }

/* ── open ─────────────────────────────────────────────────────────────
 *
 * Database::JS_new, minus the pieces behind refused options: no logger
 * (verbose), no deserialize (a Buffer filename), no nativeBinding. The
 * flag mask, the extended result codes, the busy timeout and the two
 * db_config calls are its exact sequence.
 *
 * The `anonymous` rule and the readonly check are createDatabase's, in
 * lib/database.js: a filename that trims to "" or ":memory:" is
 * anonymous, and an anonymous readonly database is a TypeError.
 */
ScrSqliteDb *scr_sqlite_open(const ScrStr *path, bool readonly, bool must_exist, double timeout) {
  ScrSqliteDb *db;
  sqlite3 *h = NULL;
  int mask;
  size_t start = 0, end;
  bool anonymous;
  char *cpath;

  if (!(timeout >= 0.0) || timeout != (double)(int32_t)timeout) {
    scr_sqlite_throw_type("Expected the \"timeout\" option to be a positive integer");
    return NULL;
  }

  /* String.prototype.trim over the JS whitespace set, which is what
   * `filenameGiven.trim()` runs. The ASCII half is all that can matter
   * for the ":memory:" / "" comparison below. */
  end = path->len;
  while (start < end && (path->data[start] == ' ' || path->data[start] == '\t' ||
                         path->data[start] == '\n' || path->data[start] == '\r' ||
                         path->data[start] == '\f' || path->data[start] == '\v'))
    start++;
  while (end > start && (path->data[end - 1] == ' ' || path->data[end - 1] == '\t' ||
                         path->data[end - 1] == '\n' || path->data[end - 1] == '\r' ||
                         path->data[end - 1] == '\f' || path->data[end - 1] == '\v'))
    end--;

  anonymous = (end == start) ||
              (end - start == 9 && memcmp(path->data + start, ":memory:", 8) == 0 &&
               path->data[start + 8] == '\0') ||
              (end - start == 8 && memcmp(path->data + start, ":memory:", 8) == 0);

  if (readonly && anonymous) {
    scr_sqlite_throw_type("In-memory/temporary databases cannot be readonly");
    return NULL;
  }

  cpath = (char *)malloc(end - start + 1);
  if (cpath == NULL) {
    scr_trap("scriptc: out of memory opening a database\n");
    return NULL;
  }
  memcpy(cpath, path->data + start, end - start);
  cpath[end - start] = '\0';

  mask = readonly ? SQLITE_OPEN_READONLY
       : must_exist ? SQLITE_OPEN_READWRITE
       : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);

  if (sqlite3_open_v2(cpath, &h, mask, NULL) != SQLITE_OK) {
    scr_sqlite_throw_db(h);
    sqlite3_close(h);
    free(cpath);
    return NULL;
  }
  free(cpath);

  sqlite3_extended_result_codes(h, 1);
  sqlite3_busy_timeout(h, (int)timeout);
  sqlite3_limit(h, SQLITE_LIMIT_LENGTH, 0x7fffffff);
  sqlite3_limit(h, SQLITE_LIMIT_SQL_LENGTH, 0x7fffffff);
  sqlite3_db_config(h, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);

  db = (ScrSqliteDb *)calloc(1, sizeof *db);
  if (db == NULL) {
    sqlite3_close(h);
    scr_trap("scriptc: out of memory opening a database\n");
    return NULL;
  }
  db->rc = 1;
  db->h = h;
  /* `db.name` is the filename AS GIVEN, untrimmed — createDatabase passes
   * filenameGiven through, and only the OPEN uses the trimmed form. */
  db->name = scr_str_retain((ScrStr *)path);
  db->open = true;
  db->readonly = readonly;
  db->memory = sqlite3_db_filename(h, "main") == NULL || sqlite3_db_filename(h, "main")[0] == '\0';
  return db;
}

/* REQUIRE_DATABASE_OPEN. Answers false with the throw pending. */
static bool scr_sqlite_require_open(ScrSqliteDb *db) {
  if (db->open) return true;
  scr_sqlite_throw_type("The database connection is not open");
  return false;
}

/* Answers the DATABASE, not void: lib/methods/wrappers.js returns `this`
 * from close() and exec(), so `db.exec(a).exec(b)` is a real spelling and
 * the shipped declarations say so. */
ScrSqliteDb *scr_sqlite_close(ScrSqliteDb *db) {
  if (!db->open) return scr_sqlite_db_retain(db); /* idempotent, like JS_close */
  db->open = false;
  /* sqlite3_close_v2 defers the real close until the last statement is
   * finalized, which is what makes a statement outliving its database
   * safe here without better-sqlite3's statement registry. */
  sqlite3_close_v2(db->h);
  db->h = NULL;
  return scr_sqlite_db_retain(db);
}

bool scr_sqlite_db_open(const ScrSqliteDb *db) { return db->open; }
bool scr_sqlite_db_readonly(const ScrSqliteDb *db) { return db->readonly; }
bool scr_sqlite_db_memory(const ScrSqliteDb *db) { return db->memory; }
ScrStr *scr_sqlite_db_name(const ScrSqliteDb *db) { return scr_str_retain(db->name); }

bool scr_sqlite_db_in_transaction(const ScrSqliteDb *db) {
  return db->open && sqlite3_get_autocommit(db->h) == 0;
}

/* ── prepare ──────────────────────────────────────────────────────────*/

/* Statement::JS_new's tail walk: whitespace, block comments and line
 * comments may follow the single statement; anything else is the
 * RangeError. */
static bool scr_sqlite_tail_is_blank(const char *tail) {
  char c;
  while ((c = *tail) != '\0') {
    if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v') {
      tail++;
      continue;
    }
    if (c == '/' && tail[1] == '*') {
      tail += 2;
      for (; (c = *tail) != '\0'; ++tail) {
        if (c == '*' && tail[1] == '/') {
          tail += 2;
          break;
        }
      }
      continue;
    }
    if (c == '-' && tail[1] == '-') {
      tail += 2;
      for (; (c = *tail) != '\0'; ++tail) {
        if (c == '\n') {
          ++tail;
          break;
        }
      }
      continue;
    }
    return false;
  }
  return true;
}

static ScrSqliteStmt *scr_sqlite_prepare_mode(ScrSqliteDb *db, const ScrStr *sql, bool pragma_mode) {
  sqlite3_stmt *h = NULL;
  const char *tail = NULL;
  ScrSqliteStmt *st;
  int flags = pragma_mode ? 0 : SQLITE_PREPARE_PERSISTENT;

  if (!scr_sqlite_require_open(db)) return NULL;

  if (sqlite3_prepare_v3(db->h, sql->data, (int)sql->len + 1, (unsigned)flags, &h, &tail) != SQLITE_OK) {
    scr_sqlite_throw_db(db->h);
    return NULL;
  }
  if (h == NULL) {
    scr_sqlite_throw_range("The supplied SQL string contains no statements");
    return NULL;
  }
  if (!scr_sqlite_tail_is_blank(tail)) {
    sqlite3_finalize(h);
    scr_sqlite_throw_range("The supplied SQL string contains more than one statement");
    return NULL;
  }

  st = (ScrSqliteStmt *)calloc(1, sizeof *st);
  if (st == NULL) {
    sqlite3_finalize(h);
    scr_trap("scriptc: out of memory preparing a statement\n");
    return NULL;
  }
  st->rc = 1;
  st->db = scr_sqlite_db_retain(db);
  st->h = h;
  st->source = scr_str_retain((ScrStr *)sql);
  st->mode = SCR_SQL_FLAT;
  st->safe_ints = false;
  st->reader = sqlite3_column_count(h) >= 1 || pragma_mode;
  st->ro = sqlite3_stmt_readonly(h) != 0;
  st->alive = true;
  return st;
}

ScrSqliteStmt *scr_sqlite_prepare(ScrSqliteDb *db, const ScrStr *sql) {
  return scr_sqlite_prepare_mode(db, sql, false);
}

ScrStr *scr_sqlite_stmt_source(const ScrSqliteStmt *st) { return scr_str_retain(st->source); }
bool scr_sqlite_stmt_reader(const ScrSqliteStmt *st) { return st->reader; }
bool scr_sqlite_stmt_readonly(const ScrSqliteStmt *st) { return st->ro; }
/* `stmt.busy` is true only while an iterator holds the statement open.
 * Iterators are refused, so nothing in a compiled program can observe
 * true — and false is the honest constant answer, not a stub. */
bool scr_sqlite_stmt_busy(const ScrSqliteStmt *st) { (void)st; return false; }

/* pluck/expand/raw share Data::mode, and each is "set this mode, or fall
 * back to FLAT when turning MY mode off" — JS_pluck's exact expression. */
static ScrSqliteStmt *scr_sqlite_set_mode(ScrSqliteStmt *st, int mine, bool use, const char *method) {
  if (!st->reader) {
    char buf[96];
    size_t n = 0;
    memcpy(buf, "The ", 4); n = 4;
    memcpy(buf + n, method, strlen(method)); n += strlen(method);
    memcpy(buf + n, "() method is only for statements that return data", 49); n += 49;
    buf[n] = '\0';
    scr_sqlite_throw_type(buf);
    return NULL;
  }
  st->mode = use ? mine : (st->mode == mine ? SCR_SQL_FLAT : st->mode);
  return scr_sqlite_stmt_retain(st);
}

ScrSqliteStmt *scr_sqlite_stmt_pluck(ScrSqliteStmt *st, bool use) {
  return scr_sqlite_set_mode(st, SCR_SQL_PLUCK, use, "pluck");
}
ScrSqliteStmt *scr_sqlite_stmt_expand(ScrSqliteStmt *st, bool use) {
  return scr_sqlite_set_mode(st, SCR_SQL_EXPAND, use, "expand");
}
ScrSqliteStmt *scr_sqlite_stmt_raw(ScrSqliteStmt *st, bool use) {
  return scr_sqlite_set_mode(st, SCR_SQL_RAW, use, "raw");
}
ScrSqliteStmt *scr_sqlite_stmt_safe_ints(ScrSqliteStmt *st, bool use) {
  st->safe_ints = use;
  return scr_sqlite_stmt_retain(st);
}

/* ── SQLite value → JS value ──────────────────────────────────────────
 * Data::GetValueJS, fallthrough included: with safe integers OFF an
 * INTEGER column reads through the FLOAT arm, i.e. sqlite3_column_double,
 * NOT a cast of the int64.
 */
static ScrDyn *scr_sqlite_col(sqlite3_stmt *h, int i, bool safe_ints) {
  switch (sqlite3_column_type(h, i)) {
    case SQLITE_INTEGER:
      if (safe_ints) {
        ScrBigInt *b = scr_sqlite_big_from_i64(sqlite3_column_int64(h, i));
        ScrDyn *d;
        if (b == NULL) return NULL;
        d = scr_dyn_from_big(b);
        scr_big_release(b);
        return d;
      }
      /* fall through */
    case SQLITE_FLOAT:
      return scr_dyn_new_num(sqlite3_column_double(h, i));
    case SQLITE_TEXT: {
      const unsigned char *t = sqlite3_column_text(h, i);
      int n = sqlite3_column_bytes(h, i);
      ScrStr *s = scr_str_new(t == NULL ? "" : (const char *)t, (size_t)(n < 0 ? 0 : n));
      ScrDyn *d = scr_dyn_new_str(s);
      scr_str_release(s);
      return d;
    }
    case SQLITE_BLOB: {
      const void *p = sqlite3_column_blob(h, i);
      int n = sqlite3_column_bytes(h, i);
      ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)(n < 0 ? 0 : n));
      ScrDyn *d;
      if (b == NULL) return NULL;
      if (n > 0 && p != NULL) memcpy(b->data, p, (size_t)n);
      /* Napi::Buffer<char>::Copy — a Buffer, not a bare Uint8Array. */
      scr_bytes_stamp_buffer(b);
      d = scr_dyn_new_bytes_ref(b);
      scr_bytes_release(b);
      return d;
    }
    default:
      return scr_dyn_new_null();
  }
}

/* Data::GetRowJS across the four modes. */
static ScrDyn *scr_sqlite_row(sqlite3_stmt *h, int mode, bool safe_ints) {
  int n = sqlite3_column_count(h), i;
  if (mode == SCR_SQL_PLUCK) return scr_sqlite_col(h, 0, safe_ints);
  if (mode == SCR_SQL_RAW) {
    ScrDyn *arr = scr_dyn_new_arr();
    for (i = 0; i < n; i++) {
      ScrDyn *v = scr_sqlite_col(h, i, safe_ints);
      if (v == NULL) { scr_dyn_release(arr); return NULL; }
      scr_dyn_arr_push(arr, v);
    }
    return arr;
  }
  if (mode == SCR_SQL_EXPAND) {
    ScrDyn *row = scr_dyn_new_obj();
    for (i = 0; i < n; i++) {
      const char *table = sqlite3_column_table_name(h, i);
      const char *col = sqlite3_column_name(h, i);
      ScrDyn *v = scr_sqlite_col(h, i, safe_ints);
      ScrDyn *nested;
      if (table == NULL) table = "$";
      if (col == NULL) col = "";
      if (v == NULL) { scr_dyn_release(row); return NULL; }
      nested = scr_dyn_obj_own_data(row, table, strlen(table));
      if (nested == NULL) {
        nested = scr_dyn_new_obj();
        scr_dyn_obj_set(nested, col, strlen(col), v);
        scr_dyn_obj_set(row, table, strlen(table), nested);
      } else {
        scr_dyn_obj_set(nested, col, strlen(col), v);
      }
    }
    return row;
  }
  {
    ScrDyn *row = scr_dyn_new_obj();
    for (i = 0; i < n; i++) {
      const char *col = sqlite3_column_name(h, i);
      ScrDyn *v = scr_sqlite_col(h, i, safe_ints);
      if (v == NULL) { scr_dyn_release(row); return NULL; }
      scr_dyn_obj_set(row, col == NULL ? "" : col, col == NULL ? 0 : strlen(col), v);
    }
    return row;
  }
}

/* ── JS value → SQLite ────────────────────────────────────────────────
 * Data::BindValueFromJS. Answers SQLITE_OK, or -1 for "not a bindable
 * kind", which the caller turns into the TypeError better-sqlite3 spells.
 */
static int scr_sqlite_bind_one(sqlite3_stmt *h, int index, const ScrDyn *v) {
  if (v == NULL) return sqlite3_bind_null(h, index);
  switch (v->kind) {
    case SCR_DYN_NUM:
      /* ALWAYS a double, integral or not — probed against the oracle. */
      return sqlite3_bind_double(h, index, v->v.num);
    case SCR_DYN_BIG: {
      ScrBigInt *b = scr_dyn_big_of(v);
      sqlite3_int64 i64;
      /* Data::BindValueFromJS answers SQLITE_TOOBIG for a bigint that is
       * not losslessly an int64 — the RangeError, not the TypeError. */
      if (b == NULL || !scr_sqlite_big_to_i64(b, &i64)) return SQLITE_TOOBIG;
      return sqlite3_bind_int64(h, index, i64);
    }
    case SCR_DYN_STR: {
      ScrStr *s = v->v.str;
      return sqlite3_bind_text(h, index, s->data, (int)s->len, SQLITE_TRANSIENT);
    }
    case SCR_DYN_BYTES: {
      ScrBytes *b = v->v.bytes;
      /* napi_is_buffer is true for node::Buffer AND Uint8Array, and false
       * for every other typed array — so u8 binds and Uint32Array does
       * not. zapo's store-sqlite binds plain Uint8Arrays, which is the
       * case this row exists for. */
      if (b->elem != SCR_BYTES_U8) return -1;
      return sqlite3_bind_blob(h, index, b->len == 0 ? "" : (const char *)b->data, (int)b->len,
                               SQLITE_TRANSIENT);
    }
    case SCR_DYN_NULL:
    case SCR_DYN_UNDEF:
      return sqlite3_bind_null(h, index);
    default:
      return -1;
  }
}

static bool scr_sqlite_bind_fail(int status) {
  switch (status) {
    case -1:
      scr_sqlite_throw_type("SQLite3 can only bind numbers, strings, bigints, buffers, and null");
      return false;
    case SQLITE_TOOBIG:
      scr_sqlite_throw_range("The bound string, buffer, or bigint is too big");
      return false;
    case SQLITE_RANGE:
      scr_sqlite_throw_range("Too many parameter values were provided");
      return false;
    case SQLITE_NOMEM:
      scr_throw_error_msg(SCR_ERR_ERROR, "Out of memory", 13);
      return false;
    default:
      scr_throw_error_msg(SCR_ERR_ERROR,
                          "An unexpected error occured while trying to bind parameters", 58);
      return false;
  }
}

/* Binder::NextAnonIndex — skip every index that HAS a name. */
static int scr_sqlite_next_anon(sqlite3_stmt *h, int *anon) {
  while (sqlite3_bind_parameter_name(h, ++(*anon)) != NULL) {}
  return *anon;
}

static bool scr_sqlite_has_named(sqlite3_stmt *h) {
  int n = sqlite3_bind_parameter_count(h), i;
  for (i = 1; i <= n; i++)
    if (sqlite3_bind_parameter_name(h, i) != NULL) return true;
  return false;
}

/* Binder::BindObject — walk the statement's OWN named parameters (the
 * bind map), demand each as an own property of the object, and bind at
 * the parameter's real index. The map's key is the name with its
 * ':'/'@'/'$' prefix stripped, which is `name + 1`.
 */
static int scr_sqlite_bind_object(sqlite3_stmt *h, const ScrDyn *obj, bool *ok) {
  int count = sqlite3_bind_parameter_count(h), i, bound = 0;
  for (i = 1; i <= count; i++) {
    const char *raw = sqlite3_bind_parameter_name(h, i);
    const char *key;
    ScrDyn *v;
    int status;
    if (raw == NULL) continue;
    key = raw + 1;
    if (!scr_dyn_obj_has_own_prop(obj, key, strlen(key))) {
      char buf[256];
      size_t klen = strlen(key), n = 0;
      if (klen > 180) klen = 180;
      memcpy(buf, "Missing named parameter \"", 25); n = 25;
      memcpy(buf + n, key, klen); n += klen;
      buf[n++] = '"';
      buf[n] = '\0';
      scr_sqlite_throw_range(buf);
      *ok = false;
      return bound;
    }
    v = scr_dyn_obj_own_data(obj, key, strlen(key));
    status = scr_sqlite_bind_one(h, i, v);
    if (status != SQLITE_OK) {
      *ok = scr_sqlite_bind_fail(status);
      return bound;
    }
    bound++;
  }
  return bound;
}

/* ── the argument list ────────────────────────────────────────────────
 *
 * better-sqlite3's Binder walks the JS `arguments` object. The static
 * lane's spelling of that heterogeneous list is a checked-dynamic ARRAY,
 * built at the call site by one `argsNew` and one `argsPush` per
 * argument — a `dyn[]` was the first design and is not available: an
 * array whose element is dyn maps to a dyn value here, not to a ScrArr,
 * so it has no element representation at all (the C emitter says so by
 * name).
 *
 * Both borrow and answer +1, the libCall convention; push MOVES a
 * retained copy of the value into the array and hands the array back so
 * the pushes nest into one expression. */
ScrDyn *scr_sqlite_args_new(void) { return scr_dyn_new_arr(); }

ScrDyn *scr_sqlite_args_push(ScrDyn *args, ScrDyn *v) {
  scr_dyn_arr_push(args, v == NULL ? scr_dyn_undefined() : scr_dyn_retain(v));
  return scr_dyn_retain(args);
}

/* A SPREAD argument -- `stmt.run(...params)`. Every element of the source
 * becomes its OWN entry in this list, which is what the spread means: the
 * Binder below then sees exactly the arguments `run(params[0], params[1],
 * ...)` would have written.
 *
 * That is NOT the same call as `stmt.run(params)`, which the old refusal
 * advised as an equivalent. Passing the array itself makes ONE argument
 * whose elements the Binder spreads positionally -- so the two agree only
 * while every element is a bindable scalar. A single OBJECT element binds
 * NAMED parameters when spread and is an unbindable positional value when
 * nested; a nested ARRAY element spreads one level when spread and is
 * unbindable when nested. Flattening here is the only spelling that is
 * the same call for every element kind.
 *
 * Borrows both, answers +1 like its plain twin. MAY THROW the spread-call
 * TypeError for a non-iterable source (pending; `what` spells the
 * expression for the nullish form). */
ScrDyn *scr_sqlite_args_push_spread(ScrDyn *args, const ScrDyn *src, const ScrStr *what) {
  scr_dyn_arr_push_spread(args, src, what == NULL ? "" : what->data);
  return scr_dyn_retain(args);
}

/* Binder::BindArgs over that list. */
static bool scr_sqlite_bind(sqlite3_stmt *h, const ScrDyn *args) {
  int param_count = sqlite3_bind_parameter_count(h);
  int anon = 0, count = 0;
  bool bound_object = false, ok = true;
  double argc = args == NULL ? 0.0 : scr_dyn_arr_len(args);
  double ai;

  for (ai = 0; ai < argc; ai += 1.0) {
    ScrDyn *arg = scr_dyn_arr_at(args, ai); /* +1 */
    if (arg != NULL && arg->kind == SCR_DYN_ARR) {
      double len = scr_dyn_arr_len(arg), j;
      for (j = 0; j < len; j += 1.0) {
        ScrDyn *el = scr_dyn_arr_at(arg, j);
        int status = scr_sqlite_bind_one(h, scr_sqlite_next_anon(h, &anon), el);
        scr_dyn_release(el);
        if (status != SQLITE_OK) {
          ok = scr_sqlite_bind_fail(status);
          scr_dyn_release(arg);
          goto done;
        }
        count++;
      }
      scr_dyn_release(arg);
      continue;
    }
    if (arg != NULL && arg->kind == SCR_DYN_OBJ) {
      if (bound_object) {
        scr_sqlite_throw_type("You cannot specify named parameters in two different objects");
        ok = false;
        scr_dyn_release(arg);
        goto done;
      }
      bound_object = true;
      count += scr_sqlite_bind_object(h, arg, &ok);
      scr_dyn_release(arg);
      if (!ok) goto done;
      continue;
    }
    {
      int status = scr_sqlite_bind_one(h, scr_sqlite_next_anon(h, &anon), arg);
      scr_dyn_release(arg);
      if (status != SQLITE_OK) {
        ok = scr_sqlite_bind_fail(status);
        goto done;
      }
      count++;
    }
  }

  if (count != param_count) {
    if (count < param_count) {
      if (!bound_object && scr_sqlite_has_named(h)) {
        scr_sqlite_throw_type("Missing named parameters");
      } else {
        scr_sqlite_throw_range("Too few parameter values were provided");
      }
    } else {
      scr_sqlite_throw_range("Too many parameter values were provided");
    }
    ok = false;
  }

done:
  if (!ok) sqlite3_clear_bindings(h);
  return ok;
}

/* ── run / get / all ──────────────────────────────────────────────────*/

ScrDyn *scr_sqlite_run(ScrSqliteStmt *st, const ScrDyn *args) {
  sqlite3 *dbh;
  int before, changes;
  sqlite3_int64 id;
  ScrDyn *info;

  if (!scr_sqlite_require_open(st->db)) return NULL;
  dbh = st->db->h;
  if (!scr_sqlite_bind(st->h, args)) return NULL;

  before = sqlite3_total_changes(dbh);
  sqlite3_step(st->h);
  if (sqlite3_reset(st->h) != SQLITE_OK) {
    scr_sqlite_throw_db(dbh);
    sqlite3_clear_bindings(st->h);
    return NULL;
  }
  changes = sqlite3_total_changes(dbh) == before ? 0 : sqlite3_changes(dbh);
  id = sqlite3_last_insert_rowid(dbh);

  info = scr_dyn_new_obj();
  scr_dyn_obj_set_lit(info, "changes", 7, scr_dyn_new_num((double)changes));
  if (st->safe_ints) {
    ScrBigInt *b = scr_sqlite_big_from_i64(id);
    scr_dyn_obj_set_lit(info, "lastInsertRowid", 15, scr_dyn_from_big(b));
    scr_big_release(b);
  } else {
    scr_dyn_obj_set_lit(info, "lastInsertRowid", 15, scr_dyn_new_num((double)id));
  }
  sqlite3_clear_bindings(st->h);
  return info;
}

/* REQUIRE_STATEMENT_RETURNS_DATA */
static bool scr_sqlite_require_reader(const ScrSqliteStmt *st) {
  if (st->reader) return true;
  scr_sqlite_throw_type("This statement does not return data. Use run() instead");
  return false;
}

ScrDyn *scr_sqlite_get(ScrSqliteStmt *st, const ScrDyn *args) {
  int status;
  ScrDyn *row;
  if (!scr_sqlite_require_reader(st)) return NULL;
  if (!scr_sqlite_require_open(st->db)) return NULL;
  if (!scr_sqlite_bind(st->h, args)) return NULL;

  status = sqlite3_step(st->h);
  if (status == SQLITE_ROW) {
    row = scr_sqlite_row(st->h, st->mode, st->safe_ints);
    sqlite3_reset(st->h);
    sqlite3_clear_bindings(st->h);
    return row;
  }
  if (status == SQLITE_DONE) {
    sqlite3_reset(st->h);
    sqlite3_clear_bindings(st->h);
    return scr_dyn_undefined();
  }
  sqlite3_reset(st->h);
  scr_sqlite_throw_db(st->db->h);
  sqlite3_clear_bindings(st->h);
  return NULL;
}

ScrDyn *scr_sqlite_all(ScrSqliteStmt *st, const ScrDyn *args) {
  ScrDyn *rows;
  if (!scr_sqlite_require_reader(st)) return NULL;
  if (!scr_sqlite_require_open(st->db)) return NULL;
  if (!scr_sqlite_bind(st->h, args)) return NULL;

  rows = scr_dyn_new_arr();
  while (sqlite3_step(st->h) == SQLITE_ROW) {
    ScrDyn *row = scr_sqlite_row(st->h, st->mode, st->safe_ints);
    if (row == NULL) {
      scr_dyn_release(rows);
      sqlite3_reset(st->h);
      sqlite3_clear_bindings(st->h);
      return NULL;
    }
    scr_dyn_arr_push(rows, row);
  }
  if (sqlite3_reset(st->h) != SQLITE_OK) {
    scr_dyn_release(rows);
    scr_sqlite_throw_db(st->db->h);
    sqlite3_clear_bindings(st->h);
    return NULL;
  }
  sqlite3_clear_bindings(st->h);
  return rows;
}

/* Statement::JS_columns — SQLITE_ENABLE_COLUMN_METADATA is what makes the
 * database/table/column halves answerable at all. */
ScrDyn *scr_sqlite_stmt_columns(ScrSqliteStmt *st) {
  int n, i;
  ScrDyn *arr;
  if (!scr_sqlite_require_reader(st)) return NULL;
  if (!scr_sqlite_require_open(st->db)) return NULL;
  n = sqlite3_column_count(st->h);
  arr = scr_dyn_new_arr();
  for (i = 0; i < n; i++) {
    ScrDyn *col = scr_dyn_new_obj();
    struct {
      const char *key;
      size_t klen;
      const char *val;
    } fields[5];
    int f;
    fields[0].key = "name"; fields[0].klen = 4; fields[0].val = sqlite3_column_name(st->h, i);
    fields[1].key = "column"; fields[1].klen = 6; fields[1].val = sqlite3_column_origin_name(st->h, i);
    fields[2].key = "table"; fields[2].klen = 5; fields[2].val = sqlite3_column_table_name(st->h, i);
    fields[3].key = "database"; fields[3].klen = 8; fields[3].val = sqlite3_column_database_name(st->h, i);
    fields[4].key = "type"; fields[4].klen = 4; fields[4].val = sqlite3_column_decltype(st->h, i);
    for (f = 0; f < 5; f++) {
      if (fields[f].val == NULL) {
        scr_dyn_obj_set_lit(col, fields[f].key, fields[f].klen, scr_dyn_new_null());
      } else {
        ScrStr *s = scr_str_new(fields[f].val, strlen(fields[f].val));
        scr_dyn_obj_set_lit(col, fields[f].key, fields[f].klen, scr_dyn_new_str(s));
        scr_str_release(s);
      }
    }
    scr_dyn_arr_push(arr, col);
  }
  return arr;
}

/* ── exec ─────────────────────────────────────────────────────────────
 * Database::JS_exec's own loop, not sqlite3_exec: the difference is
 * observable, because JS_exec prepares each statement itself and reports
 * the error through the same SqliteError path. */
ScrSqliteDb *scr_sqlite_exec(ScrSqliteDb *db, const ScrStr *sql) {
  char *buf;
  const char *p;
  const char *tail;
  sqlite3_stmt *h = NULL;
  int status = SQLITE_OK;

  if (!scr_sqlite_require_open(db)) return NULL;

  buf = (char *)malloc(sql->len + 1);
  if (buf == NULL) {
    scr_trap("scriptc: out of memory in db.exec\n");
    return NULL;
  }
  memcpy(buf, sql->data, sql->len);
  buf[sql->len] = '\0';
  p = buf;

  for (;;) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r' || *p == '\f' || *p == '\v') ++p;
    status = sqlite3_prepare_v2(db->h, p, -1, &h, &tail);
    p = tail;
    if (h == NULL) break;
    do {
      status = sqlite3_step(h);
    } while (status == SQLITE_ROW);
    status = sqlite3_finalize(h);
    h = NULL;
    if (status != SQLITE_OK) break;
  }

  free(buf);
  if (status != SQLITE_OK) {
    scr_sqlite_throw_db(db->h);
    return NULL;
  }
  return scr_sqlite_db_retain(db);
}

/* ── pragma ───────────────────────────────────────────────────────────
 * lib/methods/pragma.js: prepare("PRAGMA " + source) in PRAGMA MODE (no
 * SQLITE_PREPARE_PERSISTENT, and `reader` forced true so a
 * no-result-set pragma still answers []), then all() — or pluck().get()
 * under { simple: true }. */
ScrDyn *scr_sqlite_pragma(ScrSqliteDb *db, const ScrStr *source, bool simple) {
  ScrStr *sql;
  ScrSqliteStmt *st;
  ScrDyn *out;
  size_t n = 7 + source->len;
  char *text = (char *)malloc(n + 1);
  if (text == NULL) {
    scr_trap("scriptc: out of memory in db.pragma\n");
    return NULL;
  }
  memcpy(text, "PRAGMA ", 7);
  memcpy(text + 7, source->data, source->len);
  text[n] = '\0';
  sql = scr_str_new(text, n);
  free(text);

  st = scr_sqlite_prepare_mode(db, sql, true);
  scr_str_release(sql);
  if (st == NULL) return NULL;

  if (simple) {
    st->mode = SCR_SQL_PLUCK;
    out = scr_sqlite_get(st, NULL);
  } else {
    out = scr_sqlite_all(st, NULL);
  }
  scr_sqlite_stmt_release(st);
  return out;
}
