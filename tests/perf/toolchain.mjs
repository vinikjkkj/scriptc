/**
 * toolchain.mjs - WHICH C compiler produced the binary a perf number is
 * about, recorded rather than assumed.
 *
 * There is no `clang` on this host and the compiler DEFAULTS to one:
 * packages/compiler/src/backend/cc.ts takes the clang branch when
 * SCRIPTC_CC is empty, and packages/runtime/test/cc.ts reads
 * `SCRIPTC_TEST_CC ?? "clang"`. A run that forgets the override does not
 * produce a slower binary - it produces `spawn clang ENOENT`, which is
 * loud. The quiet failure is worse: a number carried across sessions from
 * a differently-configured shell, or one arm of an A/B built by a
 * different driver, is a comparison between two TOOLCHAINS wearing the
 * clothes of a comparison between two builds.
 *
 * So every driver that builds something records this beside its results,
 * and refuses to start if the compiler it would invoke is not there.
 */
import { spawnSync } from 'node:child_process'

export function toolchain() {
  const cc = (process.env.SCRIPTC_CC ?? '').trim()
  const argv = cc === '' || cc === 'clang'
    ? ['clang']
    : cc === 'zigcc'
      ? ['zig', 'cc']
      : cc.split(/[ \t]+/)
  const exe = argv[0]
  const probe = spawnSync(exe, exe === 'zig' ? ['version'] : ['--version'], { encoding: 'utf8' })
  const raw = probe.error ? '' : String(probe.stdout ?? probe.stderr ?? '').trim()
  return {
    SCRIPTC_CC: cc === '' ? '(unset -> clang)' : cc,
    SCRIPTC_TARGET: process.env.SCRIPTC_TARGET ?? '(unset)',
    SCRIPTC_OPT_LEVEL: process.env.SCRIPTC_OPT_LEVEL || '(unset)',
    SCRIPTC_PROF_CFLAGS: process.env.SCRIPTC_PROF_CFLAGS || '(unset)',
    driver: argv.join(' '),
    version: raw === '' ? null : raw.split(String.fromCharCode(10))[0],
    present: !probe.error
  }
}

/** One line, for the top of a report. */
export function toolchainLine(tc) {
  return 'toolchain: SCRIPTC_CC=' + tc.SCRIPTC_CC + '  driver="' + tc.driver + '"  ' +
    (tc.version ?? '(absent)') + '  target=' + tc.SCRIPTC_TARGET + '  opt=' + tc.SCRIPTC_OPT_LEVEL
}

/** Print the line and exit non-zero if the compiler is missing. */
export function requireToolchain() {
  const tc = toolchain()
  if (!tc.present) {
    console.error('the C compiler this build would use (' + tc.driver + ') is not on PATH.')
    console.error('There is no clang on this host; set SCRIPTC_CC=zigcc and SCRIPTC_TEST_CC="zig cc".')
    process.exit(4)
  }
  return tc
}
