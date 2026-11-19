/* abpropscount.cjs -- LAB ONLY. NODE_OPTIONS=--require this file. In a process whose argv names zapo-rest-mysql, replaces each export of zapo's spec/abprops
 * module with a Proxy that records which keys are read (get / has / getOwnPropertyDescriptor), how often the key set is enumerated (ownKeys), and the depth-1 shape
 * of what a read returns. Writes $COUNT_OUT.<pid>.json every 2 s and at exit. Proxies return the original values, so frozen-object invariants hold. */
const Module = require('module'), fs = require('fs')
const orig = Module._load
let done = false
Module._load = function (request, parent, isMain) {
  const ex = orig.apply(this, arguments)
  if (done || !/zapo-rest-mysql/.test(process.argv.join(' '))) return ex
  const rf = (() => { try { return Module._resolveFilename(request, parent) } catch { return '' } })()
  if (!/spec[\\/]abprops[\\/]index\.js$/.test(rf)) return ex
  done = true
  const t0 = Date.now(), stats = Object.create(null)
  const names = Object.keys(ex)
  const out = process.env.COUNT_OUT || 'abpropscount'
  for (const nm of names) {
    const target = ex[nm]
    if (target === null || typeof target !== 'object') continue
    const st = stats[nm] = { total: Array.isArray(target) ? target.length : Object.keys(target).length, isArray: Array.isArray(target), frozen: Object.isFrozen(target), keys: Object.create(null), enumerations: 0, has: 0, gopd: 0, firstEnumAtMs: null, firstReadAtMs: null }
    ex[nm] = new Proxy(target, {
      get(t, k, r) { if (typeof k === 'string') { const e = st.keys[k] || (st.keys[k] = { n: 0, t: Date.now() - t0 }); e.n++; if (st.firstReadAtMs === null) st.firstReadAtMs = Date.now() - t0 } return Reflect.get(t, k, r) },
      has(t, k) { st.has++; return Reflect.has(t, k) },
      getOwnPropertyDescriptor(t, k) { st.gopd++; return Reflect.getOwnPropertyDescriptor(t, k) },
      ownKeys(t) { st.enumerations++; if (st.firstEnumAtMs === null) st.firstEnumAtMs = Date.now() - t0; return Reflect.ownKeys(t) },
    })
  }
  const dump = () => { try {
    const o = {}
    for (const [nm, st] of Object.entries(stats)) o[nm] = { total: st.total, isArray: st.isArray, frozen: st.frozen, distinctKeysRead: Object.keys(st.keys).length, reads: Object.values(st.keys).reduce((a, e) => a + e.n, 0), enumerations: st.enumerations, has: st.has, gopd: st.gopd, firstEnumAtMs: st.firstEnumAtMs, firstReadAtMs: st.firstReadAtMs, keysRead: Object.entries(st.keys).slice(0, 400) }
    fs.writeFileSync(out + '.' + process.pid + '.json', JSON.stringify({ argv: process.argv.slice(0, 4), exports: names, stats: o }))
  } catch {} }
  setInterval(dump, 2000).unref(); process.on('exit', dump)
  return ex
}
