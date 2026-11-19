/* protocount.cjs -- LAB ONLY. NODE_OPTIONS=--require this file. In a process whose argv names zapo-rest-mysql, wraps every object/function property reachable from
 * zapo's spec/proto `waproto` namespace in an accessor that records the first read of each dotted path (the moment a lazy slot would have to materialize) and
 * the read count, plus encode/decode call counts. Writes $COUNT_OUT.<pid>.json every 2 s and at exit. */
const Module = require('module'), fs = require('fs')
const orig = Module._load
let done = false
Module._load = function (request, parent, isMain) {
  const ex = orig.apply(this, arguments)
  if (done || !/zapo-rest-mysql/.test(process.argv.join(' '))) return ex
  const fn = parent && parent.filename, rf = (() => { try { return Module._resolveFilename(request, parent) } catch { return '' } })()
  if (!/spec[\\/]proto[\\/]index\.js$/.test(rf)) return ex
  done = true
  const reads = Object.create(null), calls = Object.create(null), t0 = Date.now(), seen = new WeakSet()
  let nobj = 0, nctor = 0
  const wrap = (o, path) => {
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) return
    seen.add(o)
    for (const k of Object.keys(o)) {
      if (k === 'prototype' || k === 'encode' || k === 'decode' || k === 'create' || k === 'name' || k === 'length') continue
      const d = Object.getOwnPropertyDescriptor(o, k)
      if (!d || !('value' in d) || (typeof d.value !== 'object' && typeof d.value !== 'function') || d.value === null) continue
      const v = d.value, p = path ? path + '.' + k : k
      nobj++
      if (typeof v === 'function' && typeof v.decode === 'function') nctor++
      Object.defineProperty(o, k, { enumerable: d.enumerable, configurable: true,
        get() { const r = reads[p] || (reads[p] = { n: 0, t: Date.now() - t0 }); r.n++; return v } })
      wrap(v, p)
    }
    if (typeof o === 'function') for (const m of ['encode', 'decode']) if (typeof o[m] === 'function') {
      const f = o[m], key = path + '#' + m
      o[m] = function () { calls[key] = (calls[key] || 0) + 1; return f.apply(this, arguments) }
      Object.defineProperty(o[m], 'length', { value: f.length })
    }
  }
  wrap(ex.waproto, '')
  const out = process.env.COUNT_OUT || 'protocount'
  const dump = () => { try { fs.writeFileSync(out + '.' + process.pid + '.json', JSON.stringify({ argv: process.argv.slice(0, 4), nobj, nctor, reads, calls })) } catch {} }
  setInterval(dump, 2000).unref(); process.on('exit', dump)
  return ex
}
