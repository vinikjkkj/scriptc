/* own.mjs — owner attribution and message-family normalisation.
 *
 * A PURE MODULE: no CLI, no argv reads, no side effects. It was split out of
 * cluster.mjs after cluster.mjs, imported by sitediff.mjs, consumed
 * sitediff's own `--selftest` flag and called process.exit(0) -- so
 * sitediff's self-test never ran and the pass line printed on screen was
 * cluster's. A helper that reads argv cannot be safely imported.
 */

/* Owner attribution. The provenance lane checks each attested tree out under
 * <SCRIPTC_PROVENANCE_CACHE>/<commit>/, so the commit digest IS the package
 * identity. Unknown commits are reported as `?<sha12>` and are never silently
 * folded into a known bucket. */
const COMMITS = {
  '387b6dd29e0aef37fb36607c4a0c652ef0878029': 'mongodb',
  '302f96e9591c6d4571480d69bb319266c281f67c': 'bson',
  aff0d3bdf6e3d8332568d431e4448d895635e8d3: 'saslprep',
  '9a49e1fffdec8bbfae14cd64c98ffa88c36ef13e': 'zapo-js@v1.8.0',
  '757a8071b8194b1a3b0a2e2c8d0e5d0e5d0e5d0e': 'zapo-js@v1.8.2',
  '26e2c12671f39743abc8a6ba884b8d89b41ca0c5': 'mongodb-connection-string-url',
}
const SHORT = new Map()
for (const k of Object.keys(COMMITS)) SHORT.set(k.slice(0, 12), COMMITS[k])

export function ownerOf(file) {
  const m = file.match(/\/([0-9a-f]{12,40})\//)
  if (m) {
    const name = SHORT.get(m[1].slice(0, 12))
    if (name) {
      /* mongodb's attested tree also has a top-level src/; the zapo checkout's
       * packages/store-mongo is its own subject and must not be folded in. */
      if (name === 'zapo-js@v1.8.0' && /\/packages\/store-mongo\//.test(file)) return '@zapo-js/store-mongo'
      return name
    }
    return '?' + m[1].slice(0, 12)
  }
  if (/\/node_modules\//.test(file)) {
    const n = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
    return 'node_modules:' + (n ? n[1] : '?')
  }
  if (/\/drivers\//.test(file)) return 'the driver'
  return 'other'
}

/* Message family: strip every quoted identifier, every numeric literal and
 * every path, so that N quotations of ONE rule collapse to one family. This is
 * the whole point of the instrument, so it is self-tested by cluster.mjs. */
export function family(msg) {
  return msg
    /* The instantiation context. `genericClassInstanceType` appends
     *   "(instantiating class 'C' with <T1, T2>)"
     * to every diagnostic raised while collecting one instantiation. The type
     * arguments are NOT quoted, so the quoted-identifier stripper below cannot
     * see them, and eight refusals of ONE line at operation.ts:92 read as eight
     * separate causes. That is the same roots-vs-cascade inflation this whole
     * instrument exists to remove, reproduced inside the instrument. */
    .replace(/\s*\(instantiating class '[^']*' with <.*$/s, ' (instantiating _)')
    .replace(/'[^']*'/g, "'_'")
    .replace(/"[^"]*"/g, '"_"')
    .replace(/`[^`]*`/g, '`_`')
    .replace(/\b\d+\b/g, 'N')
    .replace(/[A-Za-z]:[\\/][^\s,)]+/g, 'PATH')
    .replace(/\s+/g, ' ')
    .trim()
}

/* Canonicalise a site path to <commit12>/<path-inside-the-checkout>, so two
 * runs whose provenance CACHE ROOTS differ can be compared at all. */
export function canonPath(f) {
  const m = f.match(/\/([0-9a-f]{40})\/(.*)$/)
  if (m) return m[1].slice(0, 12) + '/' + m[2]
  const n = f.match(/\/(napp\/.*)$/)
  return n ? n[1] : f
}
