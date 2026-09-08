/* patch-argo-initpath.mjs — substitution test for BOTH module-init fences at
 * once. NOT a fix, NOT shipped, fully reversible.
 *
 *   node patch-argo-initpath.mjs <node_modules dir> [--restore]
 *
 * initpath.mjs read the emitted C and found that exactly 2 of the 11 fence
 * sites sit in a module-INIT function, i.e. fire unconditionally on first
 * import. Laddering found the same two one rebuild at a time, at ~15 minutes
 * each. Both are substituted here in one pass so the next build either
 * completes init -- answering "does a compiled zapo decode argo correctly?" --
 * or reveals a genuinely NEW fence rather than the third discovery of the same
 * shape.
 *
 * (1) decode.js  `new TextDecoder('utf-8', { fatal: false })` -> `new TextDecoder()`
 *     utf-8 and fatal:false ARE the defaults, so this is behaviour-identical.
 *
 * (2) index.js   the barrel re-exports `encode`, whose implementation is
 *     `encode(wire, value, opts = {})` -- a DEFAULTED parameter, and the only
 *     such export. Taking it as a value is SC1090. It is wrapped in a
 *     required-arity function. Passing `undefined` for `opts` still triggers
 *     the default, so this is behaviour-identical too.
 *
 * Both keep a .orig backup; --restore puts them back.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const nm = process.argv[2]
if (!nm) { console.error('usage: patch-argo-initpath.mjs <node_modules dir> [--restore]'); process.exit(2) }
const root = join(nm, 'argo-codec')

const EDITS = [
  { file: 'dist/cjs/decode.js', from: "new TextDecoder('utf-8', { fatal: false })", to: 'new TextDecoder()' },
  { file: 'dist/esm/decode.js', from: "new TextDecoder('utf-8', { fatal: false })", to: 'new TextDecoder()' },
  // (2) encode.js  the barrel re-exports `encode`, and the implementation is
  //     `encode(wire, value, opts = {})` -- a DEFAULTED parameter, and the only
  //     such export. Taking it as a value is SC1090. The default is moved into
  //     the body, which removes the defaulted PARAMETER while keeping the
  //     behaviour identical (an omitted or undefined `opts` still becomes {}).
  //
  //     An earlier attempt wrapped the export in the BARREL instead. That was
  //     wrong and the measurement said so: it changed the getter into a
  //     function expression, npm-static-rewrite.ts no longer recognised the
  //     defineProperty export, the statement was left live, and the build then
  //     refused `Object.defineProperty` itself at index.js:5. The substitution
  //     must not disturb the shape the rewriter keys on.
  {
    file: 'dist/cjs/encode.js',
    from: 'function encode(wire, value, opts = {}) {',
    to: 'function encode(wire, value, opts) { if (opts === undefined) opts = {};',
  },
  {
    file: 'dist/esm/encode.js',
    from: 'function encode(wire, value, opts = {}) {',
    to: 'function encode(wire, value, opts) { if (opts === undefined) opts = {};',
  },
]

const targets = EDITS.filter((e) => existsSync(join(root, e.file)))
if (targets.length === 0) { console.error('no argo-codec files found'); process.exit(3) }

if (process.argv.includes('--restore')) {
  let n = 0
  for (const e of targets) {
    const p = join(root, e.file)
    if (existsSync(p + '.orig')) { copyFileSync(p + '.orig', p); n++ }
  }
  console.log(`restored ${n} file(s)`)
  process.exit(0)
}

let applied = 0
for (const e of targets) {
  const p = join(root, e.file)
  const s = readFileSync(p, 'utf8')
  if (!s.includes(e.from)) {
    if (s.includes(e.to)) { console.log(`already patched: ${e.file}`); continue }
    console.error(`needle not found in ${e.file} -- refusing to guess`); process.exit(4)
  }
  if (!existsSync(p + '.orig')) copyFileSync(p, p + '.orig')
  writeFileSync(p, s.split(e.from).join(e.to))
  applied++
  console.log(`patched ${e.file}`)
}

/* Self-test: every needle gone, every replacement present, and the ESM barrel
 * must NOT have been silently missed -- if dist/esm/index.js also re-exports
 * encode as a value, patching only the CJS one would leave a wall standing and
 * look like a failed experiment. */
for (const e of targets) {
  const s = readFileSync(join(root, e.file), 'utf8')
  if (s.includes(e.from)) { console.error(`self-test: needle survives in ${e.file}`); process.exit(5) }
  if (!s.includes(e.to)) { console.error(`self-test: replacement missing in ${e.file}`); process.exit(5) }
}
const esmBarrel = join(root, 'dist/esm/index.js')
if (existsSync(esmBarrel) && /\bencode\b/.test(readFileSync(esmBarrel, 'utf8'))) {
  console.log('note: dist/esm/index.js also names `encode`; the compiler took the CJS barrel')
  console.log('      (the fence cited dist/cjs/index.js), so it is left alone deliberately.')
}
console.log(`applied ${applied} substitution(s)`)
