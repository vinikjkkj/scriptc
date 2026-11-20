// callers.mjs RESULT_DIR ARTIFACT_DIR TARGET_REGEX: from every <label>.callgrind.out write callers-<label>.txt, the caller graph of the functions whose name matches TARGET_REGEX
//   per target: exclusive Ir, calls, then callers (calls, inclusive Ir of the call edge) up to 4 levels (top 8 per level, edges under 1% of the target's inclusive Ir folded)
//   positive control line: sum of exclusive Ir over all functions must equal the printed total Ir
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
const [dir, art, rx] = process.argv.slice(2)
const re = new RegExp(rx)
function parse(text) {
  const names = new Map(), self = new Map(), edges = new Map() // edges: callee -> Map(caller -> {calls, incl})
  let cur = null, callee = null, pend = null, total = null
  const nameOf = (rest) => { const m = /^\((\d+)\)(?: (.*))?$/.exec(rest); if (!m) return rest; if (m[2] !== undefined) names.set(m[1], m[2]); return names.get(m[1]) ?? `?${m[1]}` }
  for (const line of text.split('\n')) {
    if (line === '') continue
    const c = line.charCodeAt(0)
    if (c >= 48 && c <= 57 || c === 43 || c === 45 || c === 42) {
      const sp = line.indexOf(' '); if (sp < 0) continue
      const v = Number(line.slice(sp + 1).split(' ')[0])
      if (pend) { pend.incl += v; pend = null; continue }
      if (cur !== null && Number.isFinite(v)) self.set(cur, (self.get(cur) ?? 0) + v)
      continue
    }
    if (line.startsWith('fn=')) cur = nameOf(line.slice(3))
    else if (line.startsWith('cfn=')) callee = nameOf(line.slice(4))
    else if (line.startsWith('calls=')) {
      const n = Number(line.slice(6).split(' ')[0])
      let m = edges.get(callee); if (!m) edges.set(callee, m = new Map())
      let e = m.get(cur); if (!e) m.set(cur, e = { calls: 0, incl: 0 })
      e.calls += n; pend = e
    } else if (line.startsWith('totals:')) total = Number(line.slice(7).trim().split(' ')[0])
  }
  return { self, edges, total }
}
const sym = (k) => k.replace(/ \[.*$/, '').replace(/^.*:/, '').slice(0, 110)
for (const f of readdirSync(dir).filter((x) => x.endsWith('.callgrind.out'))) {
  const label = f.replace('.callgrind.out', '')
  const p = parse(readFileSync(`${dir}/${f}`, 'utf8'))
  let sum = 0; for (const v of p.self.values()) sum += v
  const out = [`# ${label}: total Ir ${p.total}; sum of exclusive Ir ${sum}; control ${sum === p.total ? 'EQUAL' : 'DIFFERS'}`]
  const targets = [...new Set([...p.self.keys(), ...p.edges.keys()])].filter((k) => re.test(sym(k)))
  const ex = (k) => p.self.get(k) ?? 0
  targets.sort((a, b) => ex(b) - ex(a))
  const up = (k, depth, pre, floor, seen) => {
    if (depth > 4) return
    const m = p.edges.get(k); if (!m) return
    const rows = [...m].sort((a, b) => b[1].incl - a[1].incl)
    let folded = 0, nf = 0, shown = 0
    for (const [c, e] of rows) {
      if (shown >= 8 || e.incl < floor) { folded += e.incl; nf++; continue }
      shown++
      out.push(`${pre}<- ${sym(c)}  calls=${e.calls} incl_Ir=${e.incl}`)
      if (!seen.has(c)) up(c, depth + 1, pre + '    ', floor, new Set([...seen, c]))
    }
    if (nf) out.push(`${pre}<- (${nf} more edges) incl_Ir=${folded}`)
  }
  const head = out.splice(0)
  for (const k of targets.slice(0, 16)) {
    const m = p.edges.get(k); let incl = 0, calls = 0; if (m) for (const e of m.values()) { incl += e.incl; calls += e.calls }
    out.push(`== ${sym(k)}  exclusive_Ir=${ex(k)} calls=${calls} incl_Ir(edges)=${incl}`)
    up(k, 1, '  ', Math.max(1, incl * 0.02), new Set([k]))
    let s = head.join('\n') + '\n' + out.splice(0).join('\n') + '\n'
    if (s.length > 29500) s = s.slice(0, 29500) + '\n# truncated\n'
    writeFileSync(`${art}/callers-${label}-${sym(k).replace(/[^A-Za-z0-9_]/g, '_')}.txt`, s)
  }
}
