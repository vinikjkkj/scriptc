/**
 * name-modules.mjs - give every `%m<i>` tag in an emitted TU a SOURCE FILE.
 *
 * The compiler's own module order is the authoritative map, but it is only
 * reachable by re-running the frontend with the same npm-static and
 * provenance options the build used - a second expensive load that can
 * silently differ from the build's. This recovers the map from artefacts
 * both sides already agree on:
 *
 *   the emitted C names every module-scoped declaration `..._x25_m<i>_<id>`
 *   (and class shapes `sc_o__x25_m<i>_<Class>`), and exactly one file in
 *   the source tree declares `<id>`.
 *
 * A tag is only NAMED when its identifiers agree on one file; a tag whose
 * identifiers point at several files is reported AMBIGUOUS with the
 * candidates, and a tag with no hit is reported UNRESOLVED. The point is
 * that the failure modes are visible instead of averaged away.
 *
 * Usage:
 *   node name-modules.mjs --c out.c --src G:/.../src [--src more] [--json o]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p, out) }
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p)
  }
  return out
}

/** identifiers a file DECLARES at top level (cheap, deliberately loose:
 *  over-matching only makes a tag ambiguous, which is reported). */
function declaredIn(text) {
  const ids = new Set()
  const re = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|enum|interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm
  let m
  while ((m = re.exec(text)) !== null) ids.add(m[1])
  return ids
}

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flags = (k) => argv.map((a, i) => (a === '--' + k ? argv[i + 1] : null)).filter((x) => x !== null)
  const cFile = flags('c')[0]
  const roots = flags('src')
  if (!cFile || roots.length === 0) { console.error('usage: --c out.c --src <dir> [--src <dir>] [--json out]'); process.exit(2) }

  const text = readFileSync(cFile, 'latin1')
  // tag -> identifier -> count
  const tags = new Map()
  const re = /_x25_m(\d+)_([A-Za-z_][A-Za-z0-9_]*)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const t = Number(m[1])
    // methods are `<Class>_<method>`; the first segment is the declared id
    const id = m[2]
    let e = tags.get(t); if (!e) { e = new Map(); tags.set(t, e) }
    e.set(id, (e.get(id) ?? 0) + 1)
  }
  console.log('distinct %m tags in the emitted C: ' + tags.size)

  const files = []
  for (const r of roots) for (const f of walk(r)) files.push(f)
  console.log('source files scanned:            ' + files.length)
  const declMap = new Map() // id -> Set(file)
  for (const f of files) {
    let t
    try { t = readFileSync(f, 'utf8') } catch { continue }
    for (const id of declaredIn(t)) {
      let s = declMap.get(id); if (!s) { s = new Set(); declMap.set(id, s) }
      s.add(f)
    }
  }
  console.log('distinct declared identifiers:   ' + declMap.size)
  console.log('')

  const named = []
  let unresolved = 0, ambiguous = 0
  for (const [t, ids] of [...tags].sort((a, b) => a[0] - b[0])) {
    const votes = new Map()
    for (const [id] of ids) {
      const files2 = declMap.get(id)
      if (!files2 || files2.size !== 1) continue      // only UNIQUE declarations vote
      const f = [...files2][0]
      votes.set(f, (votes.get(f) ?? 0) + 1)
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1])
    if (ranked.length === 0) { named.push({ tag: t, file: null, why: 'no uniquely-declared identifier' }); unresolved++; continue }
    const [f0, v0] = ranked[0]
    const v1 = ranked[1] ? ranked[1][1] : 0
    if (v1 > 0 && v1 >= v0) { named.push({ tag: t, file: f0, why: 'AMBIGUOUS', alts: ranked.slice(0, 3) }); ambiguous++; continue }
    named.push({ tag: t, file: f0, votes: v0, runnerUp: v1, ids: ids.size })
  }
  console.log('resolved ' + (named.length - unresolved - ambiguous) + '   ambiguous ' + ambiguous + '   unresolved ' + unresolved)
  const jsonOut = flags('json')[0]
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(named, null, 1), 'utf8'); console.log('-> ' + jsonOut) }
  else for (const n of named) console.log('m' + String(n.tag).padEnd(5) + (n.file ?? '?') + (n.why ? '   [' + n.why + ']' : '   (' + n.votes + '/' + n.ids + ')'))
}
