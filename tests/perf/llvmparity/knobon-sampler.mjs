/* Accumulate the UNION of converted function names while the run is in flight.
 *
 * WHY A UNION OF SAMPLES AND NOT A TOTAL: the scratch tree is reclaimed as
 * tests finish, so any single reading is a photograph. Three readings of the
 * same command gave 124, 9 and 27 distinct functions. The union of samples is
 * a FLOOR of the cumulative set -- a function born and reclaimed between two
 * samples is absent from it -- and it must never be reported as "the set".
 *
 * It also measures what it cannot see: directories appearing and vanishing
 * between consecutive samples. That is the error bar; without it the floor has
 * no bound on what it missed.
 */
import { readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TMP = "G:/blocks/knobon-measure/tmp";
const RUNLOG = "G:/blocks/knobon-run-20261006-154412.log";
const UNION = "G:/blocks/knobon-union.txt";
const LOG = "G:/blocks/knobon-sample.log";
const INTERVAL_MS = 30000;
const RE = /void sc_cr_([A-Za-z0-9_]+)\(ScrCoroBase/g;

/* LOCAL clock, because the gate logs local time and two series that cannot
 * be correlated by timestamp are two series. The first samples of this log
 * were written in UTC; the OFFSET note on SAMPLER-START makes them readable. */
function localHMS() {
  const d = new Date();
  const q = (x) => String(x).padStart(2, "0");
  return q(d.getHours()) + ":" + q(d.getMinutes()) + ":" + q(d.getSeconds());
}

/* Reload the floor on restart: the union lives in a file precisely so that
 * fixing the sampler does not discard what it already accumulated. */
const union = new Set();
try {
  for (const l of readFileSync(UNION, "utf8").split(String.fromCharCode(10))) {
    const t = l.trim();
    if (t) union.add(t);
  }
} catch {}
let prevDirs = new Set();
let n = 0;
const t0 = Date.now();

function walk(dir, out, depth = 0) {
  if (depth > 6) return;
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.name.endsWith(".c")) out.push(p);
  }
}

function sample() {
  n++;
  let dirs = new Set();
  try { for (const d of readdirSync(TMP)) if (d.startsWith("scr")) dirs.add(d); } catch {}
  const files = [];
  walk(TMP, files);
  let conv = 0;
  const now = new Set();
  for (const f of files) {
    let t;
    try { t = readFileSync(f, "latin1"); } catch { continue; }
    if (!t.includes("sc_cr_")) continue;
    conv++;
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(t)) !== null) { now.add(m[1]); union.add(m[1]); }
  }
  const appeared = [...dirs].filter((d) => !prevDirs.has(d)).length;
  const vanished = [...prevDirs].filter((d) => !dirs.has(d)).length;
  prevDirs = dirs;
  const line = [
    localHMS(),
    "n=" + n,
    "dirs=" + dirs.size,
    "appeared=" + appeared,
    "vanished=" + vanished,
    "c=" + files.length,
    "converted=" + conv,
    "distinctNow=" + now.size,
    "UNION=" + union.size,
  ].join(" ");
  appendFileSync(LOG, line + "\n");
  writeFileSync(UNION, [...union].sort().join("\n") + "\n");
}

function done() {
  try { return readFileSync(RUNLOG, "utf8").includes("GATE-EXIT"); } catch { return false; }
}

{
  const off = -new Date().getTimezoneOffset();
  appendFileSync(LOG,
    "SAMPLER-START interval=" + INTERVAL_MS + "ms tmp=" + TMP +
    " clock=LOCAL utcOffsetMin=" + off +
    " NOTE=local-equals-UTC-plus-utcOffsetMin" +
    " reloadedUnion=" + union.size + "\n");
}
sample();
const iv = setInterval(() => {
  sample();
  if (done() || Date.now() - t0 > 90 * 60 * 1000) {
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    appendFileSync(LOG,
      "SAMPLER-END samples=" + n + " minutes=" + mins +
      " FLOOR_union=" + union.size + "\n");
    clearInterval(iv);
    process.exit(0);
  }
}, INTERVAL_MS);
