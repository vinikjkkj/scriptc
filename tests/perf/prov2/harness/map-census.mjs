// The mapping census: for every module, what does --provenance-sources
// resolve, and to WHICH FILE. No analyze() — this measures only the
// resolution step, which is where both defects live, and it runs in
// milliseconds where a full provenance analyze() runs in minutes.
//
// Every mapped specifier is recorded with the absolute file it resolved
// to and whether that file exists, so a later reader can check the
// mapping rather than trust that one happened.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [, , listFile, outJson] = process.argv
const compilerUrl = pathToFileURL(process.env.WT + '/packages/compiler/dist/index.js').href
const { resolveProvenanceSources } = await import(compilerUrl)

const entries = readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
const out = { compiler: process.env.WT, modules: {} }

for (const entry of entries) {
  const t0 = Date.now()
  let rec
  try {
    const prov = await resolveProvenanceSources(entry)
    rec = {
      ms: Date.now() - t0,
      packages: prov.packages.map((p) => ({
        name: p.name,
        version: p.version,
        dir: p.dir,
        entries: Object.fromEntries(
          Object.entries(p.entries).map(([spec, file]) => [
            spec,
            { file, exists: existsSync(file) },
          ]),
        ),
      })),
      notes: prov.notes,
    }
  } catch (e) {
    rec = { ms: Date.now() - t0, error: String(e && e.stack ? e.stack : e) }
  }
  out.modules[entry] = rec
  const n = rec.packages ? rec.packages.length : -1
  const m = rec.packages ? rec.packages.reduce((a, p) => a + Object.keys(p.entries).length, 0) : -1
  console.log(`${entry}  packages=${n} mappedSpecifiers=${m} notes=${rec.notes ? rec.notes.length : '-'} ${rec.ms}ms`)
}
writeFileSync(outJson, JSON.stringify(out, null, 1))
console.log('CENSUS_DONE', outJson)
