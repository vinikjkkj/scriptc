/**
 * flagsweep.mjs - price build-line flags on ONE small program, byte-exact.
 *
 * Every arm builds the SAME source with a fresh build (SCRIPTC_NO_CACHE=1)
 * and is weighed on the PE section table, not on the file size alone, so a
 * change that only moves 512-byte file padding cannot read as a win. The
 * PDB is weighed too, because on this toolchain it is the only symbolisation
 * route there is and every strip spelling destroys it - a size win that
 * costs the PDB has to be quoted with that cost attached.
 *
 * Usage: node flagsweep.mjs --ts <entry.ts> --out <scratch dir>
 */
import { mkdirSync, statSync, rmSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { peSections } from './attrib.mjs'

const argv = process.argv.slice(2)
const flag = (k, d = null) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const ts = flag('ts')
const outDir = flag('out')
if (!outDir) { console.error('--out <dir> is required (a scratch directory; never C:)'); process.exit(2) }
const cli = flag('cli', new URL('../../../packages/cli/dist/main.js', import.meta.url).pathname.replace(/^\//, ''))
if (!ts) { console.error('usage: --ts entry.ts [--out dir]'); process.exit(2) }
mkdirSync(outDir, { recursive: true })
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

const ARMS = [
  ['base', {}, ''],
  ['A/A control (inert -D)', {}, '-DSCR_IMAGESIZE_AA_CONTROL=1'],
  ['-Os', { SCRIPTC_OPT_LEVEL: '-Os' }, ''],
  ['-Oz', { SCRIPTC_OPT_LEVEL: '-Oz' }, ''],
  ['-O1', { SCRIPTC_OPT_LEVEL: '-O1' }, ''],
  ['-O3', { SCRIPTC_OPT_LEVEL: '-O3' }, ''],
  ['gc-sections only', {}, '-ffunction-sections -fdata-sections -Wl,--gc-sections'],
  ['--strip-all only', {}, '-Wl,--strip-all'],
  ['gc-sections + strip', {}, '-ffunction-sections -fdata-sections -Wl,--gc-sections -Wl,--strip-all'],
  ['-Oz + gc + strip', { SCRIPTC_OPT_LEVEL: '-Oz' }, '-ffunction-sections -fdata-sections -Wl,--gc-sections -Wl,--strip-all'],
  ['lld --icf=all', {}, '-ffunction-sections -Wl,--icf=all'],
]

console.log('entry ' + ts)
console.log('')
console.log('  arm                        file        .text      .rdata       .data      .pdata          PDB')
const rows = []
for (let i = 0; i < ARMS.length; i++) {
  const [name, env, cflags] = ARMS[i]
  const exe = outDir + '/arm' + i + '.exe'
  const pdb = outDir + '/arm' + i + '.pdb'
  for (const f of [exe, pdb]) if (existsSync(f)) rmSync(f)
  try {
    execFileSync(process.execPath, [cli, 'build', ts, '--backend', 'c', '-o', exe],
      { cwd: outDir, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, SCRIPTC_NO_CACHE: '1', SCRIPTC_PROF_CFLAGS: cflags, ...env } })
  } catch (e) {
    console.log('  ' + name.padEnd(24) + '  BUILD FAILED: ' + String(e.stderr ?? e.message).slice(0, 160).replace(/\s+/g, ' '))
    continue
  }
  const pe = peSections(exe)
  const sec = (n) => { const s = pe.sections.find((x) => x.name === n); return s ? s.vsize : 0 }
  const pdbSize = existsSync(pdb) ? statSync(pdb).size : 0
  rows.push({ name, file: pe.fileSize, text: sec('.text'), rdata: sec('.rdata'), data: sec('.data'), pdata: sec('.pdata'), pdb: pdbSize })
  console.log('  ' + name.padEnd(24) + fmt(pe.fileSize).padStart(11) + fmt(sec('.text')).padStart(13) +
    fmt(sec('.rdata')).padStart(12) + fmt(sec('.data')).padStart(12) + fmt(sec('.pdata')).padStart(12) +
    (pdbSize ? fmt(pdbSize).padStart(13) : '         NONE'))
}
const base = rows[0]
console.log('')
console.log('  arm                       file vs base   .text vs base   PDB')
for (const r of rows) {
  console.log('  ' + r.name.padEnd(24) + ((r.file / base.file - 1) * 100).toFixed(2).padStart(11) + '%' +
    ((r.text / base.text - 1) * 100).toFixed(2).padStart(15) + '%   ' + (r.pdb ? 'kept' : 'DESTROYED'))
}
