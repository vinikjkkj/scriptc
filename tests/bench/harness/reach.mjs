// reach.mjs RESULT_DIR ARTIFACT_DIR: from every <label>.callgrind.out of a REST run write the runtime functions the app reached, as text files labecho prints into the job log:
//   reach-<label>-summary.txt   distinct functions, scr_* vs emitted vs vendored counts, total Ir
//   reach-<label>-scr-bycalls.txt  every scr_* function: calls, exclusive Ir (sorted by calls desc), capped at 28000 bytes
//   reach-<label>-scr-byir.txt     the same list sorted by exclusive Ir
//   reach-<label>-other-byir.txt   everything that is not scr_* (emitted program functions, libc, vendored engines), top 250 by exclusive Ir
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
const [dir, art] = process.argv.slice(2)
function parse(text) {
  const names = new Map(), self = new Map(), calls = new Map()
  let cur = null, callee = null, skip = false, total = null
  const nameOf = (rest) => { const m = /^\((\d+)\)(?: (.*))?$/.exec(rest); if (!m) return rest; if (m[2] !== undefined) names.set(m[1], m[2]); return names.get(m[1]) ?? `?${m[1]}` }
  for (const line of text.split('\n')) {
    if (line === '') continue
    const c = line.charCodeAt(0)
    if (c >= 48 && c <= 57 || c === 43 || c === 45 || c === 42) {
      const sp = line.indexOf(' '); if (sp < 0) continue
      if (skip) { skip = false; continue }
      const v = Number(line.slice(sp + 1).split(' ')[0])
      if (cur !== null && Number.isFinite(v)) self.set(cur, (self.get(cur) ?? 0) + v)
      continue
    }
    if (line.startsWith('fn=')) cur = nameOf(line.slice(3))
    else if (line.startsWith('cfn=')) callee = nameOf(line.slice(4))
    else if (line.startsWith('calls=')) { const n = Number(line.slice(6).split(' ')[0]); calls.set(callee, (calls.get(callee) ?? 0) + n); skip = true }
    else if (line.startsWith('totals:')) total = Number(line.slice(7).trim().split(' ')[0])
  }
  return { self, calls, total }
}
const cap = (rows, n) => { let s = '', k = 0; for (const r of rows) { if (s.length + r.length + 1 > n) break; s += r + '\n'; k++ } return s + `# ${k} of ${rows.length} rows shown\n` }
for (const f of readdirSync(dir).filter((x) => x.endsWith('.callgrind.out'))) {
  const label = f.replace('.callgrind.out', '')
  const p = parse(readFileSync(`${dir}/${f}`, 'utf8'))
  const keys = new Set([...p.self.keys(), ...p.calls.keys()])
  const sym = (k) => k.replace(/ \[.*$/, '').replace(/^.*:/, '')
  const rows = [...keys].map((k) => ({ k, n: sym(k), calls: p.calls.get(k) ?? 0, ir: p.self.get(k) ?? 0 }))
  const scr = rows.filter((r) => /^scr_/.test(r.n)), other = rows.filter((r) => !/^scr_/.test(r.n))
  const line = (r) => `${r.calls} | ${r.ir} | ${r.n.slice(0, 120)}`
  writeFileSync(`${art}/reach-${label}-summary.txt`, `${label}: total Ir ${p.total}; distinct functions ${rows.length}; scr_* ${scr.length} (Ir ${scr.reduce((t, r) => t + r.ir, 0)}); other ${other.length} (Ir ${other.reduce((t, r) => t + r.ir, 0)})\n`)
  writeFileSync(`${art}/reach-${label}-scr-bycalls.txt`, '# calls | exclusive_Ir | function (scr_* runtime functions, by calls)\n' + cap([...scr].sort((a, b) => b.calls - a.calls).map(line), 28000))
  writeFileSync(`${art}/reach-${label}-scr-byir.txt`, '# calls | exclusive_Ir | function (scr_* runtime functions, by exclusive Ir)\n' + cap([...scr].sort((a, b) => b.ir - a.ir).map(line), 28000))
  writeFileSync(`${art}/reach-${label}-other-byir.txt`, '# calls | exclusive_Ir | function (not scr_*)\n' + cap([...other].sort((a, b) => b.ir - a.ir).slice(0, 250).map(line), 28000))
}
