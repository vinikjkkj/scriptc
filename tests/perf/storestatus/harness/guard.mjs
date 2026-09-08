/* guard.mjs — refuses to let any build run unless every cache/temp variable
 * is set AND points at G:.
 *
 * Why this exists: packages/compiler/src/frontend/provenance.ts silently
 * falls back to homedir()/.cache/scriptc when SCRIPTC_PROVENANCE_CACHE is
 * unset. One unguarded invocation writes gigabytes to the user's C: drive
 * with no warning. The user has forbidden writes to C: twice.
 *
 * Import it for effect (`import './guard.mjs'`) or run it standalone;
 * either way it throws/exits non-zero rather than letting a build proceed.
 */
import { existsSync } from 'node:fs'

const REQUIRED = [
  'TMP',
  'TEMP',
  'TMPDIR',
  'SCRIPTC_CACHE_DIR',
  'SCRIPTC_PROVENANCE_CACHE',
  'ZIG_LOCAL_CACHE_DIR',
  'ZIG_GLOBAL_CACHE_DIR',
  'npm_config_cache',
]

/* Accept G:\..., G:/..., and the msys form /g/... — reject everything else,
 * most importantly an unset value and anything under C:. */
function onG(v) {
  return /^[Gg]:[\\/]/.test(v) || /^\/[Gg]\//.test(v)
}

const problems = []
for (const name of REQUIRED) {
  const v = process.env[name]
  if (v === undefined || v === '') problems.push(`${name} is UNSET`)
  else if (!onG(v)) problems.push(`${name}=${v} does not point at G:`)
}

/* A positive control for the check itself: the guard must be able to fail.
 * STORESTATUS_GUARD_SELFTEST=1 injects a known-bad value and expects a hit. */
if (process.env.STORESTATUS_GUARD_SELFTEST === '1') {
  const bad = '<home>\\.cache\\scriptc'
  if (onG(bad)) {
    console.error('guard self-test FAILED: onG() accepted a C: path')
    process.exit(3)
  }
  if (onG('')) {
    console.error('guard self-test FAILED: onG() accepted an empty value')
    process.exit(3)
  }
  console.error('guard self-test ok: onG() rejects a C: path and an empty value')
}

if (problems.length > 0) {
  console.error('REFUSING TO RUN — cache environment is not pinned to G:')
  for (const p of problems) console.error('  - ' + p)
  console.error('  source tests/perf/storestatus/harness/env.sh (sh) first')
  process.exit(2)
}

/* Second belt: if the C: fallback directory already exists, something ran
 * unguarded. Say so loudly; do not delete it (it is the user's drive). */
const CFALLBACK = '<home>\\.cache\\scriptc'
if (existsSync(CFALLBACK)) {
  console.error(`WARNING: ${CFALLBACK} EXISTS — something resolved provenance without a pin.`)
  console.error('         Not deleting it. Report it.')
  if (process.env.STORESTATUS_GUARD_STRICT !== '0') process.exit(4)
}
