// Dump EVERY coverage site with code, message, file and line, as JSON.
// One analyze() per entry — the CLI's text render has no file/line.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const [, , entry, outJson, ...flags] = process.argv
const compilerUrl = pathToFileURL(process.env.WT + '/packages/compiler/dist/index.js').href
const { analyze, setProvenanceSources, resolveProvenanceSources } = await import(compilerUrl)

const npmStatic = []
let useProv = false
for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--provenance-sources') useProv = true
    else if (flags[i] === '--npm-static') npmStatic.push(...flags[++i].split(','))
}
if (useProv) {
    const prov = await resolveProvenanceSources(entry)
    setProvenanceSources(prov)
}
const opts = {}
if (npmStatic.length > 0) opts.npmStatic = npmStatic
const t0 = Date.now()
const { coverage } = analyze(entry, opts)
const lineOf = new Map()
function loc(d) {
    const f = d?.loc?.file
    if (!f) return { file: null, line: null }
    let txt = lineOf.get(f)
    if (txt === undefined) { try { txt = readFileSync(f, 'utf8') } catch { txt = null }; lineOf.set(f, txt) }
    if (txt === null) return { file: f, line: null }
    const line = txt.slice(0, d.loc.start).split('\n').length
    return { file: f, line }
}
function pack(list, section) {
    return (list ?? []).map((d) => ({ section, code: d.code, message: d.message, ...loc(d) }))
}
const out = {
    entry,
    flags,
    elapsedMs: Date.now() - t0,
    preflightFailed: coverage.preflightFailed === true,
    stats: coverage.stats ? { ...coverage.stats } : null,
    npmStatic: coverage.npmStatic ?? null,
    provenanceNotes: coverage.provenance?.notes ?? null,
    sites: [
        ...pack(coverage.diagnostics, 'blocker'),
        ...pack(coverage.runtimeFences, 'deferred'),
        ...pack(coverage.advisories, 'advice'),
        ...pack(coverage.unreached?.diagnostics, 'unreached'),
        ...pack(coverage.ice, 'ice'),
    ],
}
writeFileSync(outJson, JSON.stringify(out, null, 1))
console.log(entry, 'sites=' + out.sites.length, 'preflightFailed=' + out.preflightFailed, out.elapsedMs + 'ms')
