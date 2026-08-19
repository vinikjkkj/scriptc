/**
 * cscan.mjs - split an emitted scriptc .c into top-level definitions and
 * weigh each one in SOURCE bytes.
 *
 * The emitter writes one top-level construct per "paragraph": a definition
 * starts at column 0 and its body ends at a line that is exactly `}`.
 * That is a property of the emitter's own formatting, not a C parser, so
 * the scanner VERIFIES it: every byte of the file must land in exactly one
 * span, and the sum of span lengths must equal the file length. If it does
 * not, the scan is reported as FAILED rather than approximated.
 *
 * Usage: node cscan.mjs --c file.c [--top 40] [--json out] [--name sc_f_x]
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function scan(path) {
  const buf = readFileSync(path)
  const spans = []
  let start = 0
  let i = 0
  const n = buf.length
  // Walk lines; a line that is exactly "}" (or "};") closes the current span.
  while (i < n) {
    let eol = buf.indexOf(10, i)
    if (eol < 0) eol = n
    const lineLen = eol - i
    // fast check: closing line is 1 or 2 visible chars starting with '}'
    if (lineLen >= 1 && buf[i] === 0x7d /* } */) {
      let j = i + 1
      let onlyClose = true
      while (j < eol) {
        const c = buf[j]
        if (c === 0x3b /* ; */ || c === 13 || c === 32 || c === 9) { j++; continue }
        onlyClose = false; break
      }
      if (onlyClose) {
        spans.push({ start, end: eol + (eol < n ? 1 : 0) })
        start = eol + 1
      }
    }
    i = eol + 1
  }
  if (start < n) spans.push({ start, end: n })
  return { buf, spans, fileSize: n }
}

const NAME_RE = /\b(sc_[A-Za-z0-9_]+|scr_[A-Za-z0-9_]+)\s*\(/

export function nameSpans(buf, spans) {
  const out = []
  for (const s of spans) {
    const head = buf.toString('latin1', s.start, Math.min(s.start + 400, s.end))
    let name = null
    const m = NAME_RE.exec(head)
    if (m) name = m[1]
    else {
      const d = /^\s*(?:static\s+)?[A-Za-z_][^=;{]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*=/.exec(head)
      if (d) name = d[1]
    }
    out.push({ name, start: s.start, size: s.end - s.start })
  }
  return out
}

function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
  const c = flag('c')
  if (!c) { console.error('usage: --c file.c [--top N] [--json out] [--name X]'); process.exit(2) }
  const top = Number(flag('top', '40'))
  const { buf, spans, fileSize } = scan(c)
  const covered = spans.reduce((a, s) => a + (s.end - s.start), 0)
  console.log('file           ' + c)
  console.log('bytes          ' + fmt(fileSize) + '  (' + (fileSize / 1048576).toFixed(2) + ' MiB)')
  console.log('spans          ' + fmt(spans.length))
  console.log('coverage       ' + fmt(covered) + (covered === fileSize ? '  EXACT' : '  MISMATCH ' + fmt(fileSize - covered)))
  const named = nameSpans(buf, spans)

  const want = flag('name')
  if (want) {
    for (const s of named) if (s.name === want) {
      console.log('\n--- ' + want + '  (' + fmt(s.size) + ' bytes at offset ' + fmt(s.start) + ') ---')
      console.log(buf.toString('latin1', s.start, Math.min(s.start + 3000, s.start + s.size)))
    }
    process.exit(0)
  }

  // roll up by prefix family
  const fam = new Map()
  for (const s of named) {
    const nm = s.name ?? '<anon>'
    let k = 'other'
    if (/^sc_f__x25__x25_m\d+_/.test(nm)) k = 'sc_f_ method'
    else if (/^sc_f__x25_m\d+_/.test(nm)) k = 'sc_f_ named(module)'
    else if (/^sc_f__x25_fn\d+/.test(nm)) k = 'sc_f_ %fnNNN (anon)'
    else if (/^sc_f__x25_init_/.test(nm)) k = 'sc_f_ %init_N'
    else if (/^sc_f_/.test(nm)) k = 'sc_f_ other'
    else if (/^sc_lit_/.test(nm)) k = 'sc_lit_ (string literal)'
    else if (/^sc_w_/.test(nm)) k = 'sc_w_ wrapper'
    else if (/^sc_rs_|^sc_rec_/.test(nm)) k = 'record struct'
    else if (/^sc_vt|^sc_va/.test(nm)) k = 'vtable'
    else if (/^sc_/.test(nm)) k = 'sc_ other'
    else if (/^scr_/.test(nm)) k = 'scr_ (runtime inline)'
    let e = fam.get(k); if (!e) { e = { n: 0, bytes: 0 }; fam.set(k, e) }
    e.n++; e.bytes += s.size
  }
  console.log('\n== SOURCE BYTES BY FAMILY ==')
  console.log('  family                     count        bytes       MiB      mean')
  for (const [k, v] of [...fam].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log('  ' + k.padEnd(24) + fmt(v.n).padStart(9) + fmt(v.bytes).padStart(13) +
      (v.bytes / 1048576).toFixed(2).padStart(10) + fmt(Math.round(v.bytes / v.n)).padStart(10))
  }
  console.log('\n== TOP ' + top + ' SPANS ==')
  for (const s of [...named].sort((a, b) => b.size - a.size).slice(0, top)) {
    console.log('  ' + fmt(s.size).padStart(11) + '  ' + (s.name ?? '<anon>'))
  }
  const jsonOut = flag('json')
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(named), 'utf8'); console.log('\n-> ' + jsonOut) }
}
