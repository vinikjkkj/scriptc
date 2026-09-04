// Per-phase rssBegin/rssMax/rssEnd per arm, median over reps, from pair.sh logs.
// Throws on an empty parse.
import { readFileSync } from "node:fs"
const files = process.argv.slice(2)
if (!files.length) throw new Error("usage: phasers.mjs <log> [log...]")
const PH = ["buildContacts", "buildGroups", "send_1to1", "recv_1to1", "send_group", "recv_group"]
const recs = []
let cur = null
for (const f of files) for (const L of readFileSync(f, "utf8").split(/\r?\n/)) {
  let m
  if ((m = L.match(/^===ARM (\S+) rep (\d+)/))) { cur = { arm: m[1], rep: +m[2], ph: {} }; recs.push(cur) }
  else if (cur && (m = L.match(/^\[cpumem\] (\w+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)/)) && PH.includes(m[1]))
    cur.ph[m[1]] = { b: +m[2], mx: +m[3], e: +m[4], f: +m[5] }
}
const ok = recs.filter(r => PH.every(p => r.ph[p]))
if (!ok.length) throw new Error(`no complete [cpumem] phase tables in ${files.join(", ")} — the runner's filter must keep lines starting "[cpumem] "`)
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
console.log(`complete records: ${ok.length} of ${recs.length}`)
for (const key of ["b", "mx"]) {
  console.log(`\n=== ${key === "b" ? "rssBegin" : "rssMAX"} per phase, MiB (median over reps) ===`)
  console.log("arm".padEnd(12) + "n".padStart(3) + PH.map(p => p.slice(0, 9).padStart(12)).join(""))
  for (const a of [...new Set(ok.map(r => r.arm))]) {
    const rs = ok.filter(r => r.arm === a)
    console.log(a.padEnd(12) + String(rs.length).padStart(3) + PH.map(p => med(rs.map(r => r.ph[p][key])).toFixed(2).padStart(12)).join(""))
  }
}
