// Preloaded by build.sh (--import): prints each compile phase's name, wall time and the heap left after a forced collection at
// its end, so a heap trace can be read per phase instead of matched by time. The compiler calls globalThis.__scrPhaseTap(name, ms).
import { appendFileSync } from "node:fs";
const out = process.env.PHASE_TRACE;
const t0 = performance.now();
globalThis.__scrPhaseTap = (name, ms) => {
  if (typeof globalThis.gc === "function") globalThis.gc();
  const m = process.memoryUsage();
  if (out) appendFileSync(out, `${Math.round(performance.now() - t0)} phase=${name} ms=${Math.round(ms)} heapLiveMB=${Math.round(m.heapUsed / 1048576)} rssMB=${Math.round(m.rss / 1048576)}\n`);
};
