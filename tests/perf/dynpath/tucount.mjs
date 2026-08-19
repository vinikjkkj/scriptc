// tucount.mjs <file.c> — count the emitted-C shapes this block prices,
// streaming so a 130 MB TU costs one pass and constant memory.
import { createReadStream } from "node:fs";

const PATTERNS = [
  ["retain(literal)   scr_str_retain((ScrStr *)&sc_lit_", /scr_str_retain\(\(ScrStr \*\)&sc_lit_/g],
  ["retain(str, any)  scr_str_retain(", /scr_str_retain\(/g],
  ["release(str)      scr_str_release(", /scr_str_release\(/g],
  ["retain(dyn)       scr_dyn_retain(", /scr_dyn_retain\(/g],
  ["release(dyn)      scr_dyn_release(", /scr_dyn_release\(/g],
  ["key_get           sc_dyn_key_get(", /sc_dyn_key_get\(/g],
  ["key_set           sc_dyn_key_set(", /sc_dyn_key_set\(/g],
  ["invoke            scr_dyn_invoke(", /scr_dyn_invoke\(/g],
  ["typeof            scr_dyn_typeof(", /scr_dyn_typeof\(/g],
  ["exc_pending       scr_exc_pending(", /scr_exc_pending\(/g],
  ["dyn_check_fail    scr_dyn_check_fail", /scr_dyn_check_fail/g],
  ["m18 global        sc_g_m18_", /sc_g_m18_/g],
];

const counts = new Array(PATTERNS.length).fill(0);
/* a literal-retain temp declaration: `ScrStr *sc_tN = scr_str_retain((ScrStr *)&sc_lit_M);`
 * — the name lets the matching releases be counted. */
let litTempDecls = 0;
let bytes = 0, lines = 0;

const file = process.argv[2];
const stream = createReadStream(file, { encoding: "latin1", highWaterMark: 1 << 22 });
let tail = "";
const DECL = /ScrStr \*(sc_t\d+) = scr_str_retain\(\(ScrStr \*\)&sc_lit_\d+\);/g;
for await (const chunk of stream) {
  bytes += chunk.length;
  const buf = tail + chunk;
  // keep the last 200 chars so a pattern is never split across chunks
  const cut = Math.max(0, buf.length - 200);
  const scan = buf;
  tail = buf.slice(cut);
  const usable = scan.slice(0, cut === 0 ? scan.length : cut);
  for (let i = 0; i < PATTERNS.length; i++) {
    PATTERNS[i][1].lastIndex = 0;
    const mm = usable.match(PATTERNS[i][1]);
    if (mm) counts[i] += mm.length;
  }
  DECL.lastIndex = 0;
  const dm = usable.match(DECL);
  if (dm) litTempDecls += dm.length;
  for (let i = 0; i < usable.length; i++) if (usable.charCodeAt(i) === 10) lines++;
}
// the retained tail
for (let i = 0; i < PATTERNS.length; i++) {
  PATTERNS[i][1].lastIndex = 0;
  const mm = tail.match(PATTERNS[i][1]);
  if (mm) counts[i] += mm.length;
}
DECL.lastIndex = 0;
const dm2 = tail.match(DECL);
if (dm2) litTempDecls += dm2.length;
for (let i = 0; i < tail.length; i++) if (tail.charCodeAt(i) === 10) lines++;

console.log("file   " + file);
console.log("bytes  " + bytes.toLocaleString("en-US") + "   lines " + lines.toLocaleString("en-US"));
console.log("");
for (let i = 0; i < PATTERNS.length; i++) {
  console.log("  " + PATTERNS[i][0].padEnd(50) + counts[i].toLocaleString("en-US").padStart(12));
}
console.log("");
console.log("  literal-retain TEMP declarations".padEnd(52) + litTempDecls.toLocaleString("en-US").padStart(12));
const litShare = counts[0] / counts[1];
console.log("  share of scr_str_retain that is an interned literal   " + (litShare * 100).toFixed(2) + "%");
