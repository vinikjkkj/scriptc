/* Build a SQLite page cache, then either go quiet or keep touching it.
 *
 * The idle release (scr_async.c's seam, scr_sqlite.c's per-connection
 * stamp) only has something to give back if a page cache exists, so this
 * writes enough rows to pull real pages through pcache1 before it stops.
 * An empty cache would be released with nothing in it and the arm would
 * pass while measuring nothing — the failure mode a934df42a's second
 * handle was added to avoid.
 *
 * TWO TAILS, AND THE SECOND ONE IS THE POINT. With SQLIDLE_TOUCH_MS=0 the
 * tail is silent, the connection goes untouched for a whole window, and
 * the release must fire. With SQLIDLE_TOUCH_MS>0 the tail keeps querying
 * inside the window, and the release must DECLINE — printing `IN-USE,
 * kept`. That second reading is the only evidence the last-use stamp is
 * read rather than assumed, which is exactly what 8a507dfc1 found the
 * first shape of this feature could not show.
 *
 * Read by tests/harness/sqlite-idle-release.test.ts. The program prints
 * only its own completion, so a failing assertion there is always about
 * the release and never about this file's output.
 */
import Database from "better-sqlite3";

const ROWS = Number(process.env["SQLIDLE_ROWS"] !== undefined ? process.env["SQLIDLE_ROWS"] : "4000");
const TAIL_MS = Number(process.env["SQLIDLE_TAIL_MS"] !== undefined ? process.env["SQLIDLE_TAIL_MS"] : "2500");
const TOUCH_MS = Number(process.env["SQLIDLE_TOUCH_MS"] !== undefined ? process.env["SQLIDLE_TOUCH_MS"] : "0");

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

async function main(): Promise<void> {
  const path = process.argv[2];
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec("create table if not exists pages(id integer primary key, payload text)");
  const ins = db.prepare("insert into pages(payload) values(?)");
  /* One row per page-ish: 1 KiB of text over a 4 KiB page still forces the
   * btree to allocate and balance, which is the path every observed
   * pcache1 buffer came through. */
  const blob = "y".repeat(1024);
  /* BEGIN/COMMIT by exec, not db.transaction: that method is REFUSED BY
   * NAME at the call site (scr_sqlite.c:40, the compiler's refusal in
   * lower-sqlite.ts), so the wrapper would not compile. The existing
   * differential fixture drives transactions the same way. */
  db.exec("BEGIN");
  for (let i = 0; i < ROWS; i++) ins.run(blob + String(i));
  db.exec("COMMIT");

  /* Read it all back so the pages are in the cache, not only on disk. */
  const got = db.prepare("select count(*) as n from pages").get() as { n: number };

  let touches = 0;
  if (TOUCH_MS > 0) {
    const stmt = db.prepare("select payload from pages where id = ?");
    let waited = 0;
    while (waited < TAIL_MS) {
      await sleep(TOUCH_MS);
      waited += TOUCH_MS;
      stmt.get((touches % ROWS) + 1);
      touches++;
    }
  } else {
    await sleep(TAIL_MS);
  }

  console.log("pagecache " + String(got.n) + " " + String(touches));
  db.close();
  console.log("done");
}

void main();
