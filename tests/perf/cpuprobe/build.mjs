/**
 * build.mjs - compile cpuprobe.c with the SAME C driver the compiler uses.
 *
 * There is no clang on this host, so this refuses rather than defaulting:
 * toolchain.mjs already encodes that rule and is reused here so the probe
 * and the binaries it measures cannot be built by different compilers
 * without it being visible in the output.
 *
 * The output lands OUTSIDE the repo by default (a .exe in a worktree is a
 * dirty tree waiting to happen, and three agents share this checkout's
 * parent). Nothing is hardcoded: paths resolve from import.meta.url, and
 * the out directory can be overridden with --out.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireToolchain, toolchainLine } from '../toolchain.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i < 0 ? d : (argv[i + 1] ?? d)
}

export function cpuprobePath(outDir) {
  return path.join(outDir ?? path.join(tmpdir(), 'scr-cpuprobe'), 'cpuprobe.exe')
}

export function buildCpuprobe(outDir, { quiet = false } = {}) {
  const tc = requireToolchain()
  const out = cpuprobePath(outDir)
  mkdirSync(path.dirname(out), { recursive: true })
  try { rmSync(out, { force: true }) } catch { /* nothing to remove */ }

  const cc = (process.env.SCRIPTC_CC ?? '').trim()
  const argvCC = cc === 'zigcc' ? ['zig', 'cc'] : (cc === '' ? ['clang'] : cc.split(/[ \t]+/))
  const target = process.env.SCRIPTC_TARGET ?? 'x86_64-windows-gnu'
  const args = [
    ...argvCC.slice(1),
    '-O2', '-target', target,
    path.join(HERE, 'cpuprobe.c'),
    '-o', out,
    '-lpsapi', '-lwinmm'
  ]
  const res = spawnSync(argvCC[0], args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? '')
    process.stderr.write(res.stderr ?? '')
    throw new Error('cpuprobe build failed (exit ' + res.status + ')')
  }
  // The target was deleted above, so its EXISTENCE is the proof this build
  // produced it. A zero-byte or missing exe that is used anyway is the one
  // failure mode that turns "the instrument said nothing" into "there was
  // no difference".
  if (!existsSync(out)) throw new Error('cpuprobe build reported success but wrote no ' + out)
  if (statSync(out).size === 0) throw new Error('cpuprobe build wrote a ZERO-BYTE ' + out)
  if (!quiet) console.log('built cpuprobe -> ' + out + '   ' + toolchainLine(tc))
  return out
}

if (import.meta.url === 'file:///' + process.argv[1].replace(/\\/g, '/')) {
  buildCpuprobe(flag('out', null))
}
