/* The implementation twin. Written the way a static-module generator
 * writes one: ONE root object, every message attached to it at run time,
 * and the root handed to `module.exports` by NAME on the last line. No
 * `export`, no `module.exports = { wire }` table, no top-level `var wire`
 * — the three spellings that already have storage to bridge to.
 *
 * The values are BUILT rather than written as literals, so a missing
 * %init shows up as a wrong answer and never as a constant a reader could
 * have folded. */
'use strict'

const j = {}

j.wire = (function () {
  function Frame(p) {
    if (p) {
      this.n = p.n
      this.tag = p.tag
    }
  }
  Frame.encode = function encode(m) {
    return (m.tag || '?') + ':' + ((m.n || 0) * 2)
  }
  return { Frame: Frame }
})()

j.WIRE_TAG = 'wire-' + (1 + 1)

module.exports = j
