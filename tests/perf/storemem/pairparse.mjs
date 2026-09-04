// Parse pair.sh output into per-rep, per-arm rows and PAIRED ratios.
// Throws on an empty parse: an instrument that cannot tell "found none"
// from "there are none" will report zero and be believed.
import { readFileSync } from "node:fs"
const files = process.argv.slice(2)
if (files.length === 0) throw new Error("usage: pairparse.mjs <log> [log...]")
const PH = ["buildContacts", "buildGroups", "send_1to1", "recv_1to1", "send_group", "recv_group"]
const reps = []               // {arm, rep, phases:{}, peak, first, final, faults, db}
let cur = null
for (const f of files) {
  for (const L of readFileSync(f, "utf8").split(/\r?\n/)) {
    let m
    if ((m = L.match(/^===ARM (\S+) rep (\d+)/))) {
      cur = { arm: m[1], rep: Number(m[2]), phases: {}, file: f }
      reps.push(cur)
    } else if (cur && (m = L.match(/^\[phase\] (\w+): wall (\d+)ms/))) {
      cur.phases[m[1]] = Number(m[2])
    } else if (cur && (m = L.match(/peakRSS=([\d.]+) MiB\s+finalRSS=([\d.]+) MiB/))) {
      cur.peak = Number(m[1]); cur.final = Number(m[2])
    } else if (cur && (m = L.match(/^dbsize=(\d*) wal=(\d*) shm=(\d*)/))) {
      cur.db = { db: Number(m[1] || 0), wal: Number(m[2] || 0), shm: Number(m[3] || 0) }
    }
  }
}
if (reps.length === 0) throw new Error(`no ===ARM records in ${files.join(", ")}`)
const bad = reps.filter(r => r.peak === undefined || PH.some(p => r.phases[p] === undefined))
if (bad.length) {
  for (const b of bad) console.log(`!! INCOMPLETE ${b.arm} rep ${b.rep}: peak=${b.peak} phases=${Object.keys(b.phases).join(",")}`)
}
const ok = reps.filter(r => r.peak !== undefined && PH.every(p => r.phases[p] !== undefined))
if (ok.length === 0) throw new Error("every record was incomplete — nothing to report")
for (const r of ok) r.sum = PH.reduce((a, p) => a + r.phases[p], 0)
const arms = [...new Set(ok.map(r => r.arm))]
const med = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }
console.log(`records: ${ok.length} complete, ${bad.length} incomplete; arms: ${arms.join(" ")}`)
console.log("\n=== PER-ARM (median over reps) ===")
console.log("arm".padEnd(22) + "n".padStart(3) + PH.map(p => p.slice(0, 9).padStart(11)).join("") + "sum_s".padStart(10) + "peakMiB".padStart(10) + "dbMiB".padStart(9))
for (const a of arms) {
  const rs = ok.filter(r => r.arm === a)
  const dbs = rs.filter(r => r.db).map(r => r.db.db / 1048576)
  console.log(a.padEnd(22) + String(rs.length).padStart(3) +
    PH.map(p => (med(rs.map(r => r.phases[p])) / 1000).toFixed(2).padStart(11)).join("") +
    (med(rs.map(r => r.sum)) / 1000).toFixed(2).padStart(10) +
    med(rs.map(r => r.peak)).toFixed(2).padStart(10) +
    (dbs.length ? med(dbs).toFixed(2).padStart(9) : "n/a".padStart(9)))
}
// PAIRED ratios: formed INSIDE each rep, then the median of the ratios.
const base = arms[0]
console.log(`\n=== PAIRED RATIOS vs ${base} (formed inside each rep; median [min-max]) ===`)
console.log("arm/base".padEnd(22) + PH.map(p => p.slice(0, 9).padStart(11)).join("") + "sum".padStart(10) + "peakRSS".padStart(10))
for (const a of arms) {
  const line = [a.padEnd(22)]
  const cells = []
  for (const key of [...PH, "sum", "peak"]) {
    const rats = []
    for (const rep of [...new Set(ok.map(r => r.rep))]) {
      const x = ok.find(r => r.arm === a && r.rep === rep)
      const b = ok.find(r => r.arm === base && r.rep === rep)
      if (!x || !b) continue
      const xv = key === "sum" ? x.sum : key === "peak" ? x.peak : x.phases[key]
      const bv = key === "sum" ? b.sum : key === "peak" ? b.peak : b.phases[key]
      rats.push(xv / bv)
    }
    if (rats.length === 0) { cells.push("n/a".padStart(key === "peak" || key === "sum" ? 10 : 11)); continue }
    const s = `${med(rats).toFixed(3)}`
    cells.push(s.padStart(key === "peak" || key === "sum" ? 10 : 11))
  }
  console.log(line.join("") + cells.join(""))
}
console.log("\n=== SPREAD of each paired ratio (min .. max over reps) ===")
for (const a of arms.slice(1)) {
  for (const key of ["sum", "peak"]) {
    const rats = []
    for (const rep of [...new Set(ok.map(r => r.rep))]) {
      const x = ok.find(r => r.arm === a && r.rep === rep)
      const b = ok.find(r => r.arm === base && r.rep === rep)
      if (!x || !b) continue
      const xv = key === "sum" ? x.sum : x.peak
      const bv = key === "sum" ? b.sum : b.peak
      rats.push(xv / bv)
    }
    if (rats.length) console.log(`${a}/${base} ${key.padEnd(5)} ${med(rats).toFixed(4)} [${Math.min(...rats).toFixed(4)} .. ${Math.max(...rats).toFixed(4)}]  n=${rats.length}`)
  }
}
