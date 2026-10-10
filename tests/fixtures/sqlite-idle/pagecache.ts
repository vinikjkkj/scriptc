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
 * THE SILENT TAIL MUST BE CHUNKED, AND THIS IS NOT A STYLE CHOICE. The
 * release seam is reached from ONE place (scr_async.c:4129) and only on a
 * turn where the loop has no runnable work and is ABOUT TO BLOCK, and the
 * FIRST such turn merely arms the deadline and returns (scr_async.c:2601).
 * Unlike the heap trim, this seam deliberately never shortens the loop's
 * sleep -- scr_async.c:2524 says so outright, "there is deliberately no
 * scr_sqlite_idle_due()" -- so a window CAN be slept straight through. One
 * long `await sleep(2500)` is a single timer with no poll predicates, so the
 * loop takes a plain nanosleep for the whole tail (scr_async.c:4337), the
 * timer then resumes main, main closes the database, and the loop breaks on
 * liveness (scr_async.c:4092) WITHOUT ever reaching the seam a second time.
 * Net: exactly one blocking turn, consumed by the arming, and ZERO
 * decisions.
 *
 * MEASURED, both directions, on this fixture's own binary rather than
 * argued: with the single long sleep the default arm printed 0 decision
 * lines, and SO DID A ONE-MILLISECOND WINDOW -- which is what rules out
 * "the window was too long for the tail" and names the missing turn as the
 * cause. The same binary with a touching tail printed 4 lines, so the stat
 * path and the wiring were never in doubt. Chunking the tail is what makes
 * the arm depend on a COUNT of turns instead of on a latency, and a count
 * is the quantity that survives load here.
 *
 * Read by tests/harness/sqlite-idle-release.test.ts. The program prints
 * only its own completion, so a failing assertion there is always about
 * the release and never about this file's output.
 */
import Database from "better-sqlite3";

const ROWS = Number(process.env["SQLIDLE_ROWS"] !== undefined ? process.env["SQLIDLE_ROWS"] : "4000");
const TAIL_MS = Number(process.env["SQLIDLE_TAIL_MS"] !== undefined ? process.env["SQLIDLE_TAIL_MS"] : "2500");
const TOUCH_MS = Number(process.env["SQLIDLE_TOUCH_MS"] !== undefined ? process.env["SQLIDLE_TOUCH_MS"] : "0");
const STEP_MS = Number(process.env["SQLIDLE_STEP_MS"] !== undefined ? process.env["SQLIDLE_STEP_MS"] : "100");

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
    /* CHUNKED, AND NOT ONE `await sleep(TAIL_MS)` -- see THE SILENT TAIL
     * MUST BE CHUNKED at the top of this file. The step counts NOMINALLY,
     * so the iteration count is fixed (TAIL_MS/STEP_MS) no matter how long
     * each sleep really takes: under load the turns arrive later, never
     * fewer. The tail stays silent -- sleep() touches no connection, so
     * the idle time still grows monotonically across the whole tail. */
    let waited = 0;
    while (waited < TAIL_MS) {
      const step = Math.min(STEP_MS, TAIL_MS - waited);
      await sleep(step);
      waited += step;
    }
  }

  console.log("pagecache " + String(got.n) + " " + String(touches));
  db.close();
  console.log("done");
}

void main();
