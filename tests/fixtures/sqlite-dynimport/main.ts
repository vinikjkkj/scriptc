/* better-sqlite3 reached through a DYNAMIC import — one program, two
 * runtimes.
 *
 * Under Node this is an ordinary `await import("better-sqlite3")`: the
 * addon loads and `ns.default` is the Database constructor. Compiled in
 * the static lane there is no loader and no package — the import answers
 * the namespace the compiler serves itself, and `new ns.default(path)` is
 * claimed by its RESULT type and lowered onto the vendored SQLite
 * amalgamation. Every line printed here is a cell the harness compares.
 *
 * The point of the fixture is the SEAM, not the driver: sqlite.test.ts
 * already pins 64 cells of the driver through the static import. What is
 * new here is that the same answers come out the other side of an
 * `await import()`, and that `typeof ns` is the namespace's answer
 * ("object") rather than the constructor's ("function") — the one cell
 * that would be silently wrong if the namespace were lowered to the
 * constructor, or to nothing.
 *
 * The namespace cells come in two groups and the second is the one that
 * bites. `Object.keys` / `in` / `JSON.stringify` / `typeof ns` are all
 * answered correctly by a namespace whose properties are UNDEFINED. What
 * that stand-in gets wrong is `typeof ns.default`, which reads
 * "undefined" where Node reads "function" — and that is the exact probe
 * every optional-driver loader in the wild performs, so the wrong arm is
 * taken and the program reports "no driver" at exit 0. Both groups are
 * printed below.
 *
 * The database path arrives in argv so the file-backed half runs against
 * a real file. Nothing PATH-dependent is printed.
 */

function show(label: string, v: string): void {
  console.log(label + " " + v);
}

async function main(): Promise<void> {
  const path = process.argv[2] as string;

  const ns = await import("better-sqlite3");
  // The namespace OBJECT itself, before anything is constructed from it.
  // Node builds these keys by lexing the package's CommonJS entry; the
  // static lane has no package to lex, so every one of these cells is a
  // way the compiler's stand-in could be silently wrong. An empty object
  // passes the first and third and fails the second and fourth.
  show("ns.typeof", typeof ns);
  show("ns.keys", Object.keys(ns).join(","));
  show("ns.json", JSON.stringify(ns));
  show("ns.hasDefault", String("default" in ns));
  show("ns.hasInherited", String("toString" in ns));

  // The exports read as VALUES, through a WIDENING. Off the typed
  // namespace each of these is refused by name (SC2020); a real program
  // reaches them anyway, because the idiomatic optional-driver loader
  // stores the namespace first (`let loaded: unknown = await
  // import(...)` — zapo store-sqlite/src/connection.ts:301) and probes
  // it with `typeof`. Every cell above passes with undefined-valued
  // properties, and these three do not: they are the ones that decide
  // whether the probe takes the right arm. `ns.json {}` above is what
  // proves the recording's own values are functions and not data — a
  // JSON-visible value would print here.
  const wide: unknown = ns;
  show("ns.typeof.default", typeof (wide as { default?: unknown }).default);
  show("ns.typeof.SqliteError", typeof (wide as { SqliteError?: unknown }).SqliteError);
  show("ns.typeof.absent", typeof (wide as Record<string, unknown>)["nosuchexport"]);

  const db = new ns.default(path);
  show("open", String(db.open));
  show("readonly", String(db.readonly));
  show("memory", String(db.memory));

  db.exec("create table t(k text primary key, i integer, r real, bl blob, nu)");

  const ins = db.prepare("insert into t values(?,?,?,?,?)");
  const info = ins.run("a", 42, 1.5, new Uint8Array([0, 254, 255]), null) as {
    changes: number;
    lastInsertRowid: number;
  };
  show("run.changes", String(info.changes));
  show("run.rowid", String(info.lastInsertRowid));

  const row = db
    .prepare("select k, i, r, typeof(i) as ti, typeof(r) as tr, typeof(bl) as tb, typeof(nu) as tn from t where k = ?")
    .get("a") as { k: string; i: number; r: number; ti: string; tr: string; tb: string; tn: string };
  show("get.k", row.k);
  show("get.i", String(row.i));
  show("get.r", String(row.r));
  show("get.types", row.ti + "/" + row.tr + "/" + row.tb + "/" + row.tn);

  const blob = db.prepare("select bl from t where k = ?").get("a") as { bl: Uint8Array };
  show("blob.len", String(blob.bl.length));
  show("blob.isBuffer", String(Buffer.isBuffer(blob.bl)));
  show("blob.bytes", String(blob.bl[0]) + "," + String(blob.bl[1]) + "," + String(blob.bl[2]));

  ins.run("b", 7, 0.5, new Uint8Array([1]), null);
  const all = db.prepare("select k from t order by k").all() as { k: string }[];
  show("all.len", String(all.length));
  show("all.keys", all[0].k + "," + all[1].k);

  const missing = db.prepare("select k from t where k = ?").get("zz");
  show("get.missing", String(missing));

  // The error surface, through the same handle: name, EXTENDED code, text.
  try {
    ins.run("a", 1, 1, new Uint8Array([1]), null);
    show("err.unique", "NO THROW");
  } catch (e) {
    const x = e as NodeJS.ErrnoException;
    show("err.unique", x.name + "/" + String(x.code) + "/" + x.message);
  }

  show("pragma.journal", String(db.pragma("journal_mode = WAL", { simple: true })));

  db.close();
  show("closed", String(db.open));
  show("END", "done");
}

void main();
