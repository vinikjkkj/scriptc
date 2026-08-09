/* The implementation twin, written the way a BUNDLER writes one.
 *
 * spec/wire is the same shape hand-spelled: a `const` root, and
 * `module.exports = <root>` on a statement of its own. A minifier emits
 * neither. It merges every top-level binding into one `var` declarator
 * list — so the root is a plain `var` that nothing outside the module body
 * ever reads, and the file keeps it as an init LOCAL with no module-level
 * storage at all — and it collapses the tail of the file into ONE
 * expression statement whose LAST COMMA OPERAND is the export.
 *
 * That is zapo's `spec/proto/index.js` in miniature: 1.87 MB on one line,
 * `var e,t,n,o=…,j=…` at the front and `j.waproto = (…265 factories…),
 * module.exports = j` at the back. The declared export `codec` is the
 * PROPERTY `j.codec`; there is no binding of that name anywhere, and the
 * root itself has no binding a bridge could root at either.
 *
 * The values are BUILT rather than written as literals, so a missing
 * %init shows up as a wrong answer and never as a constant a reader could
 * have folded. */
'use strict'

var e, t, j = {}

;(j.codec =
  ((e = {}),
  (e.Tag = function Tag(p) {
    if (p) {
      this.id = p.id
      this.name = p.name
    }
  }),
  (e.Tag.encode = function encode(m) {
    return (m.name || '?') + '#' + ((m.id || 0) + 100)
  }),
  e)),
  (t = 'bundle-' + (3 + 4)),
  (j.BUNDLE_TAG = t),
  (module.exports = j)
