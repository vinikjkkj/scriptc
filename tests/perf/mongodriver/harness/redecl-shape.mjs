/* redecl-shape.mjs — what exactly is the relation between a redeclared field's
 * type and the inherited slot's type, across mongodb's whole `override` family?
 *
 *   node redecl-shape.mjs <mongodb-checkout-root>
 *
 * The compiler refuses these with
 *   "redeclaring inherited fields at a different type ('A' over the inherited
 *    'B') -- these layouts give the property ONE slot, and one slot cannot
 *    answer both spellings"
 * and lower-classes.ts names the obstacle: the record model's narrowing
 * conversion COPIES into the narrower shape, so one slot cannot serve two
 * spellings by coercion. What a fix would have to handle therefore depends on
 * WHICH relation the real sites have, so this measures it per site:
 *
 *   WIDTH-EXT  every member of the inherited type is present in the redeclared
 *              type at an identical type text, and every member the
 *              redeclaration adds is optional. One widened slot would serve
 *              both views for reads.
 *   OTHER      anything else, with the difference spelled out.
 *
 * HARDENING. The first version of this file built the program from a file list
 * with no module resolution, so `bson` and every cross-package type resolved to
 * nothing and several option interfaces reported ZERO properties -- a clean,
 * confident, wrong answer. It now uses the checkout's OWN tsconfig, and it
 * REFUSES to report if the program carries unresolved-module errors or if any
 * inspected type has zero properties. It compares only same-named members, and
 * it never compares a field to a differently-named base member.
 *
 * The checkout needs a resolvable node_modules (a junction to the consumer
 * app's is enough). Read-only apart from that.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require_ = createRequire('<blocks>/mongodriver/wt/packages/compiler/package.json')
const ts = require_('typescript5')

const root = resolve(process.argv[2] ?? '<blocks>/mongodriver/probe/P0/prov/387b6dd29e0aef37fb36607c4a0c652ef0878029').replace(/\\/g, '/')
if (!existsSync(`${root}/tsconfig.json`)) throw new Error(`BLIND: no tsconfig.json at ${root}`)
if (!existsSync(`${root}/node_modules`)) throw new Error(`BLIND: ${root}/node_modules is missing -- every cross-package type would resolve to nothing and the answer would be confidently wrong`)

const cfgRaw = ts.readConfigFile(`${root}/tsconfig.json`, (p) => readFileSync(p, 'utf8'))
if (cfgRaw.error) throw new Error('BLIND: tsconfig unreadable')
const cfg = ts.parseJsonConfigFileContent(cfgRaw.config, ts.sys, root)
const files = cfg.fileNames.filter((f) => f.replace(/\\/g, '/').includes('/src/'))
if (files.length < 50) throw new Error(`BLIND: tsconfig yielded only ${files.length} src files`)

/* typeRoots is resolved relative to the config dir, and with the checkout
 * reached through a junction the default walk did not find @types, so every
 * node builtin came back unresolved. Naming it explicitly is the fix; the
 * unresolved-module gate below still refuses if it is not enough. */
const prog = ts.createProgram(files, {
  ...cfg.options,
  noEmit: true,
  skipLibCheck: true,
  typeRoots: [root + '/node_modules/@types'],
  baseUrl: root,
})
const ck = prog.getTypeChecker()

/* Unresolved modules make every cross-package type an error type with no
 * properties. Refuse rather than report. */
const unresolved = ts
  .getPreEmitDiagnostics(prog)
  .filter((d) => d.code === 2307 || d.code === 2792)

/* mongodb's OPTIONAL peer dependencies are genuinely not installed in the
 * consumer app -- the compiler itself islands each of them and says so in the
 * build log. Those imports cannot resolve for anyone, so they are allowed by
 * NAME, not by count. Every other unresolved module still refuses. */
const OPTIONAL_PEERS = /'(mongodb-client-encryption|kerberos|gcp-metadata|@mongodb-js\/zstd|@aws-sdk\/credential-providers|snappy|socks|aws4)'/
const hard = unresolved.filter((d) => !OPTIONAL_PEERS.test(ts.flattenDiagnosticMessageText(d.messageText, ' ')))
if (hard.length > 0) {
  console.error(`BLIND: ${hard.length} unresolved-module errors that are NOT known-optional peers; types would be empty. First few:`)
  for (const d of hard.slice(0, 5)) console.error('  ' + ts.flattenDiagnosticMessageText(d.messageText, ' '))
  process.exit(2)
}
/* A file that carries ANY unresolved import has error types in it, so no row
 * from such a file is reportable. Collect them and drop their rows below. */
const poisonedFiles = new Set(unresolved.map((d) => (d.file ? d.file.fileName.replace(/\\/g, '/') : '')))
console.log(`program: ${files.length} source files; ${unresolved.length} unresolved imports, all known-optional peers, in ${poisonedFiles.size} files (rows from those files are dropped)`)

const propsOf = (t, at) => {
  const m = new Map()
  for (const p of ck.getPropertiesOfType(t)) {
    m.set(p.name, {
      typeText: ck.typeToString(ck.getTypeOfSymbolAtLocation(p, at)),
      optional: (p.flags & ts.SymbolFlags.Optional) !== 0,
    })
  }
  return m
}

/* Walk every class, find each `override`/redeclaring property, and compare it
 * to the SAME-NAMED property on the base class. */
const rows = []
const dropped = []
for (const f of files) {
  const sf = prog.getSourceFile(f)
  if (!sf) continue
  if (poisonedFiles.has(f.replace(/\\/g, '/'))) { dropped.push(f); continue }
  const visit = (n) => {
    if (ts.isClassDeclaration(n) && n.heritageClauses) {
      const ext = n.heritageClauses.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
      if (ext && ext.types.length === 1) {
        const baseT = ck.getTypeAtLocation(ext.types[0])
        for (const m of n.members) {
          if (!ts.isPropertyDeclaration(m)) continue
          const name = m.name.getText()
          const baseProp = ck.getPropertyOfType(baseT, name)
          if (!baseProp) continue // not a redeclaration
          const line = sf.getLineAndCharacterOfPosition(m.getStart()).line + 1
          const dT = ck.getTypeAtLocation(m.name)
          const bT = ck.getTypeOfSymbolAtLocation(baseProp, m.name)
          const dP = propsOf(dT, m.name)
          const bP = propsOf(bT, m.name)
          /* Either side having no properties is legitimate, not broken
           * resolution: `declare cause: Error` over `Error.cause?: unknown`
           * has an `unknown` base, which has none. The resolution check is a
           * NAMED positive control below, not a per-row guess. */
          if (dP.size === 0 || bP.size === 0) {
            rows.push({ file: f.replace(root + '/', ''), line, name, kind: 'NON-RECORD', detail: `${ck.typeToString(bT)} -> ${ck.typeToString(dT)}` })
            continue
          }
          const missing = [], retyped = [], addedRequired = [], added = [], missingRequired = []
          for (const [k, v] of bP) {
            const d = dP.get(k)
            if (!d) { missing.push(k); if (!v.optional) missingRequired.push(k); continue }
            if (d.typeText !== v.typeText) retyped.push(`${k}: ${v.typeText} != ${d.typeText}`)
          }
          for (const [k, v] of dP) if (!bP.has(k)) { added.push(k); if (!v.optional) addedRequired.push(k) }
          const width = missing.length === 0 && retyped.length === 0 && addedRequired.length === 0
          /* UNION-OK: every member the two shapes disagree about is OPTIONAL on
           * the side that declares it, and every shared member has an identical
           * type. Then ONE slot holding the UNION of the members serves both
           * views for reads: a member the base cannot see is absent-or-undefined
           * either way, which is what `?:` already means. This -- not width
           * extension -- is the relation the real sites have, because mongodb
           * spells several of them `Omit<CommandOperationOptions, 'rawData'>`,
           * which REMOVES an optional member rather than adding one. */
          const unionOk = retyped.length === 0 && addedRequired.length === 0 && missingRequired.length === 0
          rows.push({
            file: f.replace(root + '/', ''), line, name,
            kind: width ? 'WIDTH-EXT' : unionOk ? 'UNION-OK' : 'OTHER',
            baseN: bP.size, derivedN: dP.size, missing, retyped, addedRequired, missingRequired, added,
            hasInit: m.initializer !== undefined,
          })
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(sf, visit)
}

if (rows.length === 0) throw new Error('BLIND: found no redeclared fields at all')

/* POSITIVE CONTROL for module resolution, by NAME. The row the compiler's own
 * diagnostic quotes -- CommandOperation.options at operations/command.ts:93 --
 * must resolve to a base record with the members OperationOptions & Abortable
 * really has. If cross-package types were resolving to nothing, this row would
 * come back empty, which is exactly how the first version of this file
 * reported a clean and wrong answer. */
const ctl = rows.find((r) => r.file.endsWith('operations/command.ts') && r.name === 'options')
if (!ctl) throw new Error('BLIND: the control row (operations/command.ts options) was not found')
if (ctl.kind === 'NON-RECORD' || ctl.baseN < 9 || ctl.derivedN < 15) {
  throw new Error(`BLIND: control row resolved to base=${ctl.baseN} derived=${ctl.derivedN}; resolution is not working`)
}
console.log(`resolution control ok: ${ctl.file}:${ctl.line} options base=${ctl.baseN} derived=${ctl.derivedN}`)

const width = rows.filter((r) => r.kind === 'WIDTH-EXT')
const uni = rows.filter((r) => r.kind === 'UNION-OK')
const other = rows.filter((r) => r.kind === 'OTHER')
const nonrec = rows.filter((r) => r.kind === 'NON-RECORD')
console.log(`\nredeclared fields (same name as an inherited property): ${rows.length}`)
console.log(`  WIDTH-EXT  (base members all present at an identical type, extras optional): ${width.length}`)
console.log(`  UNION-OK   (differing members all optional, shared members identical)         : ${uni.length}`)
console.log(`  OTHER      (a shared member is RETYPED, or a differing member is required)      : ${other.length}`)
console.log(`  NON-RECORD (neither side is a record shape)                                : ${nonrec.length}`)
console.log(`  with an initializer: ${rows.filter((r) => r.hasInit).length}`)

console.log('\n# every site')
for (const r of rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  if (r.kind === 'NON-RECORD') { console.log(`NON-RECORD ${r.file}:${r.line} ${r.name}  ${r.detail.slice(0, 120)}`); continue }
  console.log(
    `${r.kind.padEnd(10)} ${r.file}:${r.line} ${r.name}  base=${r.baseN} derived=${r.derivedN} added=${r.added.length}` +
      (r.missing.length ? `  MISSING=${r.missing.join(',')}` : '') +
      (r.retyped.length ? `  RETYPED=${r.retyped.slice(0, 3).join(' | ')}${r.retyped.length > 3 ? ` (+${r.retyped.length - 3})` : ''}` : '') +
      (r.addedRequired.length ? `  ADDED-REQUIRED=${r.addedRequired.join(',')}` : ''),
  )
}
