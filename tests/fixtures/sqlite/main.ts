/* The better-sqlite3 differential fixture — one program, two runtimes.
 *
 * Under Node it imports the real better-sqlite3 (a native addon).
 * Compiled, it reaches packages/runtime/src/scr_sqlite.c over the
 * vendored SQLite amalgamation. Every line printed here is a cell the
 * harness compares; nothing is a hand-written expectation.
 *
 * The database path arrives in argv so the file-backed half (WAL, a real
 * upsert, a real fsync) runs against a real file. Nothing PATH-dependent
 * is printed: the recorded answers must not move when the temp directory
 * does.
 */
import Database from "better-sqlite3";

function show(label: string, v: string): void {
  console.log(label + " " + v);
}
function hex(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i++) {
    const b = u[i];
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

const path = process.argv[2];
const db = new Database(path);

show("open", String(db.open));
show("readonly", String(db.readonly));
show("memory", String(db.memory));
show("inTransaction", String(db.inTransaction));

// ── pragmas, both shapes ────────────────────────────────────────────
show("pragma.journal", String(db.pragma("journal_mode = WAL", { simple: true })));
db.pragma("busy_timeout = 5000");
show("pragma.busy", String(db.pragma("busy_timeout", { simple: true })));
show("pragma.fk", String(db.pragma("foreign_keys", { simple: true })));
const uv = db.pragma("user_version") as { user_version: number }[];
show("pragma.rows", String(uv.length) + ":" + String(uv[0].user_version));

// ── the five storage classes ────────────────────────────────────────
db.exec("create table t(i integer, r real, tx text, bl blob, nu)");
const ins = db.prepare("insert into t values(?,?,?,?,?)");
show("stmt.source", ins.source);
show("stmt.reader", String(ins.reader));
show("stmt.readonly", String(ins.readonly));
show("stmt.busy", String(ins.busy));

const info = ins.run(42, 1.5, "str", new Uint8Array([0, 254, 255]), null) as {
  changes: number;
  lastInsertRowid: number;
};
show("run.changes", String(info.changes));
show("run.rowid", String(info.lastInsertRowid));

const row = db
  .prepare(
    "select i, r, tx, typeof(i) as ti, typeof(r) as tr, typeof(tx) as tt, typeof(bl) as tb, typeof(nu) as tn from t",
  )
  .get() as {
  i: number;
  r: number;
  tx: string;
  ti: string;
  tr: string;
  tt: string;
  tb: string;
  tn: string;
};
show("row.i", String(row.i));
show("row.r", String(row.r));
show("row.tx", row.tx);
show("row.typeof", row.ti + "," + row.tr + "," + row.tt + "," + row.tb + "," + row.tn);

const bl = db.prepare("select bl from t").pluck().get() as Uint8Array;
show("blob.len", String(bl.length));
show("blob.hex", hex(bl));
show("blob.isBuffer", String(Buffer.isBuffer(bl)));
show("blob.isView", String(ArrayBuffer.isView(bl)));

/* A JS number binds as a DOUBLE whatever its value, so an integral 1
 * lands in an affinity-free column as REAL. The single most surprising
 * cell in this file, and the one a reasonable-looking implementation gets
 * wrong by binding integral doubles as int64. */
db.exec("create table aff(a)");
db.prepare("insert into aff values(?)").run(1);
show("affinity", String(db.prepare("select typeof(a) as t from aff").pluck().get()));

// ── binding: positional, array, named ───────────────────────────────
db.exec("create table p(a, b, c)");
db.prepare("insert into p values(?,?,?)").run(1, "two", null);
db.prepare("insert into p values(?,?,?)").run([3, "four", null]);
db.prepare("insert into p values(:x, @y, $z)").run({ x: 5, y: "six", z: null });
const all = db.prepare("select a, b from p order by rowid").all() as { a: number; b: string }[];
show("all.length", String(all.length));
show("all.0", String(all[0].a) + "/" + all[0].b);
show("all.1", String(all[1].a) + "/" + all[1].b);
show("all.2", String(all[2].a) + "/" + all[2].b);

// ── row modes ───────────────────────────────────────────────────────
show("pluck", String(db.prepare("select a from p order by rowid").pluck().get()));
const raw = db.prepare("select a, b from p order by rowid").raw().get() as unknown[];
show("raw.length", String(raw.length));
show("raw.0", String(raw[0]));
show("raw.1", String(raw[1]));
const exp = db.prepare("select a from p order by rowid").expand().get() as { p: { a: number } };
show("expand", String(exp.p.a));
// Turning a mode OFF returns to FLAT.
const flat = db.prepare("select a from p order by rowid").pluck().pluck(false).get() as { a: number };
show("pluck.off", String(flat.a));

// ── safe integers ───────────────────────────────────────────────────
db.exec("create table big(v integer)");
db.prepare("insert into big values(9007199254740993)").run();
show("safe", (db.prepare("select v from big").pluck().safeIntegers().get() as bigint).toString());
show("unsafe", String(db.prepare("select v from big").pluck().get()));
// ...and a bigint binds back losslessly.
db.prepare("insert into big values(?)").run(9007199254740995n);
show(
  "bigbind",
  (db.prepare("select v from big order by v desc").pluck().safeIntegers().get() as bigint).toString(),
);

// ── columns() ───────────────────────────────────────────────────────
const cols = db.prepare("select i as alias, 1 as lit from t").columns() as {
  name: string;
  column: string | null;
  table: string | null;
  database: string | null;
  type: string | null;
}[];
show("columns.length", String(cols.length));
for (let i = 0; i < cols.length; i++) {
  const c = cols[i];
  show(
    "columns." + String(i),
    c.name + "|" + String(c.column) + "|" + String(c.table) + "|" + String(c.database) + "|" + String(c.type),
  );
}

// ── empty results ───────────────────────────────────────────────────
show("get.none", String(db.prepare("select i from t where i = 999").get()));
show("all.none", String((db.prepare("select i from t where i = 999").all() as unknown[]).length));

// ── transactions, driven by exec ────────────────────────────────────
db.exec("BEGIN");
show("tx.in", String(db.inTransaction));
db.prepare("insert into p values(?,?,?)").run(99, "ninety", null);
db.exec("ROLLBACK");
show("tx.out", String(db.inTransaction));
show("tx.rows", String((db.prepare("select a from p").all() as unknown[]).length));

// ── upsert and changes(), the zapo store's own shape ────────────────
db.exec(
  "create table sess (sid TEXT NOT NULL, addr TEXT NOT NULL, record BLOB NOT NULL, PRIMARY KEY (sid, addr))",
);
const up = db.prepare(
  "insert into sess values (?,?,?) on conflict(sid, addr) do update set record = excluded.record",
);
up.run("s1", "a@x", new Uint8Array([1, 2, 3]));
up.run("s1", "b@x", new Uint8Array([4, 5]));
up.run("s1", "a@x", new Uint8Array([9]));
show("upsert.changes", String(db.prepare("select changes() as total").pluck().get()));
show("upsert.count", String(db.prepare("select count(*) as c from sess").pluck().get()));
show(
  "upsert.hex",
  hex(db.prepare("select record from sess where sid = ? and addr = ?").pluck().get("s1", "a@x") as Uint8Array),
);

// A BLOB inside a primary key compares byte-exactly.
db.exec("create table bk(id blob primary key, n integer)");
const insk = db.prepare("insert into bk values(?, ?)");
insk.run(new Uint8Array([1, 2]), 1);
insk.run(new Uint8Array([1, 3]), 2);
show("blobkey.count", String(db.prepare("select count(*) as c from bk").pluck().get()));
show("blobkey.lookup", String(db.prepare("select n from bk where id = ?").pluck().get(new Uint8Array([1, 3]))));

// ── every error shape ───────────────────────────────────────────────
function err(label: string, f: () => void): void {
  try {
    f();
    show(label, "NO THROW");
  } catch (e) {
    const x = e as NodeJS.ErrnoException;
    show(label, x.name + "|" + String(x.code) + "|" + x.message);
  }
}
err("e.notable", () => void db.prepare("select * from nope").get());
db.exec("create table u(id text primary key)");
db.prepare("insert into u values(?)").run("a");
err("e.unique", () => void db.prepare("insert into u values(?)").run("a"));
err("e.few", () => void db.prepare("insert into u values(?)").run());
err("e.many", () => void db.prepare("insert into u values(?)").run("x", "y"));
err("e.nodata", () => void db.prepare("insert into u values(?)").get("z"));
err("e.two", () => void db.prepare("select 1; select 2").get());
err("e.empty", () => void db.prepare("   ").get());
err("e.named", () => void db.prepare("select :a as a").get({ b: 1 }));
err("e.bool", () => void db.prepare("insert into u values(?)").run(true as unknown as null));
err("e.twoobj", () => void db.prepare("select :a as a, :b as b").get({ a: 1 }, { b: 2 }));

// A trailing comment is NOT a second statement.
show("comment", String(db.prepare("select 1 as one -- trailing\n").pluck().get()));

db.close();
show("closed.open", String(db.open));
err("e.closed", () => void db.prepare("select 1").get());
show("END", "done");
