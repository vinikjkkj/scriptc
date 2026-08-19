/**
 * pdb-symbols.mjs - name -> rva for a scriptc-built Windows .exe.
 *
 * THE SYMBOLISATION WALL, AND WHY IT IS NOT ONE.
 *
 * estado-perf recorded that function NAMES were unobtainable on this
 * toolchain and listed eight failed routes (--wrap, -Map, --cref,
 * --print-map, --export-all-symbols, -g, the PE's own COFF table, and
 * "WSL llvm-symbolizer: not installed"). Seven of those eight are still
 * true and were re-confirmed here; the eighth was a wrong premise. Two
 * facts turn it around:
 *
 *   1. `zig cc` for x86_64-windows-gnu ALREADY writes a PDB next to every
 *      binary this repo builds - `<out>.pdb`, 2.8 MB for a 653 KB bench.
 *      No flag was needed; it has been there the whole time. `nsyms=0` in
 *      the PE is correct AND irrelevant: the symbols are in the PDB.
 *   2. The PDB carries `Has Publics: true` AND per-module S_LPROC32
 *      records, so even `static` functions in the EMITTED PROGRAM TU are
 *      named, with code sizes. On the runtime bench: 5,171 publics and
 *      1,868 procedure records, `sc_f__x25_fn2` among them.
 *
 * The reader is WSL's `llvm-pdbutil`. See the WSL note in the report for
 * the exact bootstrap and what it costs to reproduce; nothing is installed
 * on Windows and nothing is written to C:.
 *
 * Usage:
 *   node tests/perf/pdb-symbols.mjs --pdb G:/hs/exe/runtime.pdb --json out.json
 *   node tests/perf/pdb-symbols.mjs --pdb ... --resolve 504d0,4e1f0
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const NL = /\r?\n/

/** G:\a\b -> /mnt/g/a/b (WSL sees the same disk; nothing is copied). */
export function toWslPath(p) {
  const BS = String.fromCharCode(92)
  const m = /^([A-Za-z]):[/\\](.*)$/.exec(p)
  if (!m) return p.split(BS).join("/")
  return "/mnt/" + m[1].toLowerCase() + "/" + m[2].split(BS).join("/")
}

/**
 * The Arch image on this host is a MINIMAL one whose glibc predates the
 * llvm package's. `pacman -S llvm` installs, then fails to start against
 * the system loader. Rather than `-Syu` the user's distro (a system change
 * on a shared machine), the newer glibc/libxml2/icu are unpacked into
 * /opt/hslib and llvm-pdbutil is launched through THAT loader. Additive,
 * reversible, and it leaves /usr alone.
 */
const LOADER = '/opt/hslib/usr/lib/ld-linux-x86-64.so.2'
const LIBPATH = '/opt/hslib/usr/lib:/usr/lib'

export function pdbutil(pdbWinPath, args) {
  const res = spawnSync(
    'wsl.exe',
    ['-e', LOADER, '--library-path', LIBPATH, '/usr/bin/llvm-pdbutil',
     'dump', ...args, toWslPath(pdbWinPath)],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  )
  if (res.status !== 0) {
    throw new Error('llvm-pdbutil failed (' + res.status + '): ' +
      String(res.stderr ?? '').slice(0, 500))
  }
  // WSL interop hands back UTF-16-ish NULs on some paths; strip them.
  return String(res.stdout ?? '').replace(/\0/g, '')
}

/** section index (1-based) -> rva of the section start. */
function sectionRvas(text) {
  const rvas = []
  let pending = null
  for (const line of text.split(NL)) {
    let m = /^\s*SECTION HEADER #(\d+)\s*$/.exec(line)
    if (m) { pending = Number(m[1]); continue }
    if (pending !== null) {
      m = /^\s*([0-9A-Fa-f]+) virtual address\s*$/.exec(line)
      if (m) { rvas[pending] = Number.parseInt(m[1], 16); pending = null }
    }
  }
  return rvas
}

/**
 * Both record shapes carry `addr = SSSS:OOOOOO`:
 *   S_PUB32   `name` / flags = function, addr = 0001:29632
 *   S_LPROC32 `name` / parent = .., end = .., addr = 0001:318384, code size = 434
 * The name is on the record line, the address on the NEXT line, so the
 * parser keeps one line of state.
 */
function parseSymbols(text, secRvas) {
  const out = []
  let name = null
  for (const line of text.split(NL)) {
    let m = /\|\s*(S_PUB32|S_LPROC32|S_GPROC32)\s*\[size = \d+\]\s*`(.*)`\s*$/.exec(line)
    if (m) { name = m[2]; continue }
    if (name === null) continue
    m = /addr = ([0-9A-Fa-f]{4}):(\d+)/.exec(line)
    if (m) {
      const sec = Number.parseInt(m[1], 10)
      const base = secRvas[sec]
      if (base !== undefined) {
        const size = /code size = (\d+)/.exec(line)
        out.push({ rva: base + Number(m[2]), name, size: size ? Number(size[1]) : 0 })
      }
    }
    name = null
  }
  return out
}

export function loadSymbols(pdbWinPath) {
  const secRvas = sectionRvas(pdbutil(pdbWinPath, ['--section-headers']))
  const syms = parseSymbols(pdbutil(pdbWinPath, ['-publics', '-symbols']), secRvas)
  // Dedup on rva: a public and a proc record for the same function agree on
  // the address; prefer the one that carries a code size (the proc record),
  // because that is what makes containment checkable.
  const byRva = new Map()
  for (const s of syms) {
    const prev = byRva.get(s.rva)
    if (!prev || (s.size > 0 && prev.size === 0)) byRva.set(s.rva, s)
  }
  const sorted = [...byRva.values()].sort((a, b) => a.rva - b.rva)
  return sorted
}

/**
 * Nearest preceding symbol. `exact` says whether the rva fell inside a
 * record whose code size covers it - reported rather than assumed, so a
 * hit in a gap between symbols cannot masquerade as a name.
 */
export function makeResolver(sorted) {
  return (rva) => {
    let lo = 0, hi = sorted.length - 1, best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid].rva <= rva) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    if (best < 0) return { name: null, rva, offset: 0, exact: false }
    const s = sorted[best]
    const offset = rva - s.rva
    return {
      name: s.name,
      symRva: s.rva,
      offset,
      exact: s.size > 0 ? offset < s.size : offset === 0
    }
  }
}

// -- CLI ---------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (n, d = null) => {
    const i = argv.indexOf('--' + n)
    return i < 0 ? d : argv[i + 1]
  }
  const pdb = flag('pdb')
  if (!pdb) { console.error('usage: --pdb <file.pdb> [--json out] [--resolve hex,hex]'); process.exit(2) }
  const syms = loadSymbols(pdb)
  console.log('symbols: ' + syms.length)
  const jsonOut = flag('json')
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(syms), 'utf8'); console.log('-> ' + jsonOut) }
  const resolve = flag('resolve')
  if (resolve) {
    const r = makeResolver(syms)
    for (const h of resolve.split(',')) {
      const rva = Number.parseInt(h.trim(), 16)
      const hit = r(rva)
      console.log(h.trim() + '  ' + (hit.name ?? '?') + '+' + hit.offset + (hit.exact ? '' : ' (INEXACT)'))
    }
  }
}
