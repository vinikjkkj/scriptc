/**
 * lines.mjs - classify EVERY byte of an emitted scriptc .c by what the
 * emitter wrote it for.
 *
 * The unit is the LINE, because the emitter writes one construct per line.
 * Every line lands in exactly one bucket and the bucket totals must sum to
 * the file length; the scanner prints that identity so a bucket that quietly
 * drops bytes cannot pass.
 *
 * The buckets that matter are structural, not cosmetic:
 *
 *   exc-epilogue   a line INSIDE an `if (scr_exc_pending()) { ... }` block.
 *                  The emitter re-materialises the whole live set's release
 *                  list at EVERY fallible call site, so this bucket grows as
 *                  O(call sites x live values) within one function.
 *   exc-guard      the `if (scr_exc_pending()) {` line itself and its `}`.
 *   retain/release refcount traffic on the straight-line path.
 *   provenance     a line that is ONLY a `/* path:line *\/` comment.
 *
 * Usage: node lines.mjs --c file.c [--json out]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const B = {
  EXC_GUARD: 'exc-guard',
  EXC_EPILOGUE: 'exc-epilogue',
  RETAIN: 'retain',
  RELEASE: 'release',
  DECL: 'decl',
  CALL: 'call/other-stmt',
  BRACE: 'brace',
  BLANK: 'blank',
  COMMENT: 'comment-only',
  LITERAL: 'string-literal-data',
  OTHER: 'other',
}

export function classifyLines(path) {
  const text = readFileSync(path, 'latin1')
  const total = text.length
  const buckets = new Map()
  const counts = new Map()
  const bump = (k, n) => {
    buckets.set(k, (buckets.get(k) ?? 0) + n)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let i = 0
  // depth of nesting inside an exc-pending block; -1 = not inside one
  let excDepth = -1
  let braceDepthAtExc = 0
  let depth = 0
  let inLiteralDecl = false
  while (i < total) {
    let eol = text.indexOf('\n', i)
    if (eol < 0) eol = total
    const len = eol - i + (eol < total ? 1 : 0)
    const line = text.slice(i, eol)
    const t = line.trim()

    // running brace depth BEFORE deciding, so the closing } of an exc block
    // is attributed to the guard, not to the enclosing code.
    let opens = 0, closes = 0
    for (let k = 0; k < t.length; k++) {
      const c = t.charCodeAt(k)
      if (c === 123) opens++
      else if (c === 125) closes++
    }

    let bucket
    if (t.length === 0) bucket = B.BLANK
    else if (/^if \(scr_exc_pending\(\)\)/.test(t) && excDepth < 0) {
      bucket = B.EXC_GUARD
      excDepth = depth
      braceDepthAtExc = depth
    } else if (excDepth >= 0) {
      const after = depth + opens - closes
      if (after <= braceDepthAtExc && closes > 0) { bucket = B.EXC_GUARD; excDepth = -1 }
      else bucket = B.EXC_EPILOGUE
    } else if (/^static struct \{|^\s*\{ SIZE_MAX/.test(t)) { bucket = B.LITERAL; inLiteralDecl = /^static struct/.test(t) }
    else if (inLiteralDecl) { bucket = B.LITERAL; inLiteralDecl = false }
    else if (/^\/\*.*\*\/$/.test(t)) bucket = B.COMMENT
    else if (/^[{}();]+$/.test(t)) bucket = B.BRACE
    else if (/scr_[a-z0-9_]*retain/.test(t)) bucket = B.RETAIN
    else if (/scr_[a-z0-9_]*release/.test(t)) bucket = B.RELEASE
    else if (/^(static\s+)?[A-Za-z_][A-Za-z0-9_ ]*\**\s*sc_[lptg][0-9_]/.test(t)) bucket = B.DECL
    else bucket = B.CALL

    bump(bucket, len)
    depth += opens - closes
    i = eol + 1
  }
  return { total, buckets, counts }
}

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
  const c = flag('c')
  if (!c) { console.error('usage: --c file.c [--json out]'); process.exit(2) }
  const r = classifyLines(c)
  console.log('file    ' + c)
  console.log('bytes   ' + fmt(r.total) + '  (' + (r.total / 1048576).toFixed(2) + ' MiB)')
  console.log('')
  console.log('  bucket                     lines        bytes       MiB       %')
  let sum = 0
  for (const [k, v] of [...r.buckets].sort((a, b) => b[1] - a[1])) {
    sum += v
    console.log('  ' + k.padEnd(22) + fmt(r.counts.get(k)).padStart(11) + fmt(v).padStart(13) +
      (v / 1048576).toFixed(2).padStart(10) + (100 * v / r.total).toFixed(2).padStart(8))
  }
  console.log('  ' + 'SUM'.padEnd(22) + ''.padStart(11) + fmt(sum).padStart(13) +
    (sum === r.total ? '   EXACT' : '   MISMATCH ' + fmt(r.total - sum)))
  const jsonOut = flag('json')
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ file: c, total: r.total, buckets: [...r.buckets], counts: [...r.counts] }, null, 1), 'utf8'); console.log('-> ' + jsonOut) }
}
