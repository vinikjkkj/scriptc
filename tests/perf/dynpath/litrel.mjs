// litrel.mjs <file.c> — the immortal-literal ownership ceiling, counted
// per function so the temp names cannot collide.
//
// The emitter binds every interned string literal into an OWNED temp:
//     ScrStr *sc_tN = scr_str_retain((ScrStr *)&sc_lit_M);
// and then releases sc_tN on the normal path and again inside every
// unwind epilogue that is live at that point. The literal is IMMORTAL
// (rc == SIZE_MAX), so both the retain and every one of those releases is
// a no-op the emitter keeps "for ownership uniformity" (emit-types.ts:213).
//
// This counts, exactly:
//   - how many temps are bound that way,
//   - how many scr_str_release LINES name one of them (normal path and
//     epilogue alike), and
//   - the same for every OTHER ScrStr temp, as the denominator.
//
// It is a SOURCE-LINE count. estado-imagesize.md §11.3 is the standing
// warning that source lines do NOT transfer to .text -- clang tail-merges
// the epilogues. The .text ceiling is this number times the SHIPPED share,
// which only the PDB can give.
import { createReadStream } from "node:fs";

const file = process.argv[2];
const FN_OPEN = /^(?:static\s+)?[A-Za-z_][\w *]*\bsc_[a-z]+_[\w]+\s*\([^;]*\)\s*\{\s*$/;
const LIT_DECL = /^\s*ScrStr \*(sc_t\d+) = scr_str_retain\(\(ScrStr \*\)&sc_lit_\d+\);\s*$/;
const STR_DECL = /^\s*ScrStr \*(sc_t\d+) = /;
const STR_REL = /^\s*scr_str_release\((sc_t\d+)\);\s*$/;
const DYN_REL = /^\s*scr_dyn_release\((sc_[a-z]\w*)\);\s*$/;

let fns = 0, litTemps = 0, otherStrTemps = 0;
let litReleases = 0, otherStrReleases = 0, unknownStrReleases = 0;
let dynReleases = 0, totalLines = 0;
let lit = new Set(), other = new Set();

const flush = () => { lit = new Set(); other = new Set(); };

const stream = createReadStream(file, { encoding: "latin1", highWaterMark: 1 << 22 });
let carry = "";
const handle = (line) => {
  totalLines++;
  if (line === "}") { flush(); return; }
  if (FN_OPEN.test(line)) { fns++; flush(); return; }
  let m = LIT_DECL.exec(line);
  if (m) { lit.add(m[1]); litTemps++; return; }
  m = STR_DECL.exec(line);
  if (m) { other.add(m[1]); otherStrTemps++; return; }
  m = STR_REL.exec(line);
  if (m) {
    if (lit.has(m[1])) litReleases++;
    else if (other.has(m[1])) otherStrReleases++;
    else unknownStrReleases++;
    return;
  }
  if (DYN_REL.test(line)) { dynReleases++; }
};
for await (const chunk of stream) {
  const buf = carry + chunk;
  const parts = buf.split("\n");
  carry = parts.pop() ?? "";
  for (const p of parts) handle(p);
}
if (carry !== "") handle(carry);

const n = (x) => x.toLocaleString("en-US").padStart(12);
console.log("file  " + file);
console.log("lines " + n(totalLines) + "   functions " + n(fns));
console.log("");
console.log("  ScrStr temps bound to an INTERNED LITERAL   " + n(litTemps));
console.log("  ScrStr temps bound to anything else        " + n(otherStrTemps));
console.log("");
console.log("  scr_str_release LINES naming a literal temp " + n(litReleases));
console.log("  scr_str_release LINES naming another temp   " + n(otherStrReleases));
console.log("  scr_str_release LINES naming neither        " + n(unknownStrReleases));
const tot = litReleases + otherStrReleases + unknownStrReleases;
console.log("  total scr_str_release LINES                 " + n(tot));
console.log("  literal share of scr_str_release LINES      " +
  ((litReleases / tot) * 100).toFixed(2) + "%");
console.log("");
console.log("  scr_dyn_release LINES                       " + n(dynReleases));
console.log("  epilogue multiplier (releases per lit temp) " +
  (litReleases / litTemps).toFixed(2));
