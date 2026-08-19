// elide-lit.mjs <in.c> <out.c> — the PERFECT immortal-literal elision,
// performed on the emitted C rather than in the compiler, so the ceiling
// can be priced before anyone writes the emitter change.
//
// WHY IT IS SOUND, in one paragraph. An interned string literal is a
// static ScrStr with rc == SIZE_MAX. scr_str_retain is
// `if (o && o->rc != SIZE_MAX) o->rc++` and scr_str_release is
// `if (!o || o->rc == SIZE_MAX) return; ...` — on an immortal BOTH are
// exactly no-ops. So for a temp whose ONLY assignment is
// `scr_str_retain((ScrStr *)&sc_lit_N)`, deleting the retain (keeping the
// address) and deleting every `scr_str_release(<that temp>);` statement
// removes only no-ops. The one thing that could break it is the temp being
// REBOUND to a non-literal later in the function, so a temp with any second
// assignment is left completely alone and counted as skipped.
//
// The transform is line-based and per-FUNCTION: sc_tN numbering restarts in
// every function, so a function boundary resets the name table.
import { readFileSync, writeFileSync } from "node:fs";

const inPath = process.argv[2];
const outPath = process.argv[3];
const src = readFileSync(inPath, "latin1");
const lines = src.split("\n");

const FN_OPEN = /^(?:static\s+)?[A-Za-z_][\w *]*\bsc_[a-z]+_[\w]+\s*\([^;]*\)\s*\{\s*$/;
const LIT_DECL = /^(\s*)ScrStr \*(sc_t\d+) = scr_str_retain\(\(ScrStr \*\)(&sc_lit_\d+)\);\s*$/;
const REL = /^\s*scr_str_release\((sc_t\d+)\);\s*$/;
const REBIND = /^\s*(sc_t\d+) = /;

/* pass 1, per function: which literal temps are single-assignment */
/* A top-level `}` on its own at column 0 CLOSES a definition; that is the
 * only boundary the emitter guarantees, and it is what resets sc_tN
 * numbering. Segmenting on the OPENING line is not safe -- the emitter puts
 * a provenance comment after the brace, so no regex over the opener catches
 * them all, and a missed boundary would let one function's temp table delete
 * another function's releases. */
const fnStart = [0];
for (let i = 0; i < lines.length; i++) if (lines[i] === "}") fnStart.push(i + 1);
if (fnStart[fnStart.length - 1] !== lines.length) fnStart.push(lines.length);

const out = lines.slice();
let elidedRetains = 0, elidedReleases = 0, skippedRebound = 0, fnCount = 0;

for (let f = 0; f + 1 < fnStart.length; f++) {
  const a = fnStart[f], b = fnStart[f + 1];
  fnCount++;
  const declAt = new Map();   // temp -> [lineIndex, addrExpr]
  const rebound = new Set();
  for (let i = a; i < b; i++) {
    const m = LIT_DECL.exec(lines[i]);
    if (m) { declAt.set(m[2], [i, m[3], m[1]]); continue; }
    const r = REBIND.exec(lines[i]);
    if (r && declAt.has(r[1])) rebound.add(r[1]);
  }
  for (const t of rebound) { declAt.delete(t); skippedRebound++; }
  if (declAt.size === 0) continue;
  for (const [t, [i, addr, ind]] of declAt) {
    out[i] = ind + "ScrStr *" + t + " = (ScrStr *)" + addr + ";";
    elidedRetains++;
  }
  for (let i = a; i < b; i++) {
    const m = REL.exec(lines[i]);
    if (m && declAt.has(m[1])) { out[i] = null; elidedReleases++; }
  }
}

writeFileSync(outPath, Buffer.from(out.filter((l) => l !== null).join("\n"), "latin1"));
const n = (x) => x.toLocaleString("en-US").padStart(12);
console.log("in    " + inPath + "  " + n(src.length));
console.log("out   " + outPath + "  " + n(readFileSync(outPath).length));
console.log("functions scanned          " + n(fnCount));
console.log("literal temps de-owned     " + n(elidedRetains));
console.log("release STATEMENTS deleted " + n(elidedReleases));
console.log("temps skipped (rebound)    " + n(skippedRebound));
