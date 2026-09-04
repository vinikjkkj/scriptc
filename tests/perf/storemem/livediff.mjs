// Side-by-side residency of TWO scr_prof.h profiles at each one's own
// live-heap high-water. Throws rather than printing an empty table.
import { readFileSync } from "node:fs"
const args = process.argv.slice(2)
if (args.length < 4 || args.length % 2 !== 0) throw new Error("usage: livediff.mjs <labelA> <fileA> <labelB> <fileB> [...] [--top N]")
let top = 25
const pairs = []
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === "--top") { top = Number(args[i + 1]); continue }
  pairs.push({ label: args[i], file: args[i + 1] })
}
const MiB = (b) => (b / 1048576).toFixed(2)
for (const p of pairs) {
  const txt = readFileSync(p.file, "utf8")
  p.live = new Map(); p.churn = new Map()
  for (const L of txt.split(/\r?\n/)) {
    if (L.startsWith("PROFLIVE ")) {
      const q = L.split(" ")
      p.live.set(q.slice(4).join(" "), { snap: Number(q[1]), exit: Number(q[2]) })
    } else if (L.startsWith("PROF ")) {
      const q = L.split(" ")
      p.churn.set(q.slice(7).join(" "), { count: Number(q[1]), bytes: Number(q[2]) })
    } else if (L.startsWith("PROF-LIVE-TOTAL")) {
      p.tot = Object.fromEntries(L.split(/\s+/).slice(1).map(s => s.split("=")))
    }
  }
  if (p.live.size === 0) throw new Error(`no PROFLIVE rows in ${p.file} — not a -DSCR_PROF_LIVE build, or the run wrote no profile`)
  if (!p.tot) throw new Error(`no PROF-LIVE-TOTAL line in ${p.file} — profile truncated`)
  p.snapSum = [...p.live.values()].reduce((a, r) => a + r.snap, 0)
}
console.log("=== TOTALS ===")
console.log("lane".padEnd(16) + "livePeak".padStart(11) + "snapAt".padStart(10) + "liveExit".padStart(10) + "peakRSS*".padStart(11) + "profTbl".padStart(9) + "ptrLost".padStart(9) + "freeUnk".padStart(9) + "sites".padStart(7))
for (const p of pairs)
  console.log(p.label.padEnd(16) + MiB(p.tot.livePeak).padStart(11) + MiB(p.tot.liveSnapAt).padStart(10) +
    MiB(p.tot.liveNow).padStart(10) + MiB(p.tot.peakRSSbytes).padStart(11) + MiB(p.tot.profTableBytes).padStart(9) +
    String(p.tot.ptrLost).padStart(9) + String(p.tot.freeUnknown).padStart(9) + String(p.live.size).padStart(7))
console.log("* peakRSS is the INSTRUMENTED process's and includes this profiler's own touched pages; quote the clean build's peak instead.")
for (const p of pairs) if (Number(p.tot.ptrLost) > 0) console.log(`!! ${p.label}: ptrLost=${p.tot.ptrLost} — pointer table overflowed, residency is an UNDERCOUNT`)
const keys = new Set()
for (const p of pairs) for (const k of p.live.keys()) keys.add(k)
const rows = [...keys].map(k => ({
  k, v: pairs.map(p => p.live.get(k)?.snap ?? 0)
}))
const order = rows.slice().sort((a, b) => Math.max(...b.v) - Math.max(...a.v))
console.log(`\n=== RESIDENCY AT EACH LANE'S OWN HIGH-WATER, MiB (top ${top} by max) ===`)
console.log(pairs.map(p => p.label.slice(0, 11).padStart(12)).join("") + "   delta   site")
for (const r of order.slice(0, top))
  console.log(r.v.map(v => MiB(v).padStart(12)).join("") + MiB(r.v[r.v.length - 1] - r.v[0]).padStart(8) + "   " + r.k)
const sums = pairs.map(p => p.snapSum)
console.log(sums.map(s => MiB(s).padStart(12)).join("") + MiB(sums[sums.length - 1] - sums[0]).padStart(8) + "   TOTAL (sum of per-site snap)")
console.log(`\n=== BIGGEST MOVERS between ${pairs[0].label} and ${pairs[pairs.length - 1].label} (by |delta|, MiB) ===`)
const movers = rows.slice().sort((a, b) => Math.abs(b.v[b.v.length - 1] - b.v[0]) - Math.abs(a.v[a.v.length - 1] - a.v[0]))
for (const r of movers.slice(0, top))
  console.log(MiB(r.v[r.v.length - 1] - r.v[0]).padStart(10) + "   " + r.v.map(v => MiB(v).padStart(10)).join("") + "   " + r.k)
