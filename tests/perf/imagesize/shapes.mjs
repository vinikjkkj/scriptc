/**
 * shapes.mjs - which EMITTED STATEMENT SHAPE holds the bytes.
 *
 * `attrib.mjs` says which subsystem and which procedure hold the image.
 * `tucount.mjs` counts a FIXED list of twelve shapes somebody already
 * suspected. Neither answers the question an optimisation actually starts
 * from: of everything the emitter writes, which repeated statement form is
 * the most expensive, ranked, with nothing on the list because a human
 * guessed it?
 *
 * This does that. It streams the emitted `.c`, normalises every line into a
 * SHAPE by erasing the parts that vary (identifiers the emitter numbers,
 * integer and string literals), and ranks the shapes by the bytes they
 * occupy. On a 130 MB TU that is one pass and a Map of a few thousand keys.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT. It measures SOURCE BYTES in the
 * emitted C. Source bytes are NOT `.text` bytes: clang tail-merges
 * epilogues, folds identical blocks and deletes dead stores, so a shape
 * with 5% of the source can be 0% of the image and vice versa. The standing
 * warning is `estado-imagesize.md` §11.3. Use this to RANK CANDIDATES;
 * price the candidate you pick with `attrib.mjs`/`probe.mjs` on a real
 * build, and quote the `.exe` byte delta, never this file's percentage.
 *
 * Usage:
 *   node shapes.mjs <program>.c [--top 40] [--min 1000] [--json out.json]
 *   node shapes.mjs --self-test
 *
 * THE SELF-TEST is not decoration. A shape counter that cannot report
 * "these two files are the same" is worthless the moment it reports that
 * they differ. `--self-test` builds a small file whose shape census is
 * known by construction, asserts it exactly, then re-censuses the same
 * bytes fed through a deliberately awkward chunk size to prove the
 * streaming boundary does not create or lose a line. It exits non-zero on
 * any mismatch and prints what it expected.
 */
import { createReadStream, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'

/* ---------------------------------------------------------------- *
 * Normalisation. Order matters: strings before numbers, or a digit
 * inside a string literal becomes a number token.
 * ---------------------------------------------------------------- */
export function shapeOf(line) {
  let s = line.trim()
  if (s === '') return null
  // string and char literals -> S / C
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '"S"')
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "'C'")
  // the emitter's numbered identifiers, most specific first
  s = s.replace(/\bsc_lit_\d+\b/g, 'sc_lit_#')
  s = s.replace(/\bsc_t\d+\b/g, 'sc_t#')
  s = s.replace(/\bsc_g_m\d+_[A-Za-z0-9_$]+\b/g, 'sc_g_m#_ID')
  s = s.replace(/\bsc_f_m\d+_[A-Za-z0-9_$]+\b/g, 'sc_f_m#_ID')
  s = s.replace(/\bsc_[a-z]+_\d+\b/g, 'sc_x#')
  s = s.replace(/\bL\d+\b/g, 'L#')
  // remaining integer / float literals
  s = s.replace(/\b0[xX][0-9a-fA-F]+\b/g, 'N')
  s = s.replace(/\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?[uUlLfF]*\b/g, 'N')
  return s
}

export async function census(stream, { onLine } = {}) {
  const shapes = new Map()
  let bytes = 0
  let lines = 0
  let tail = ''
  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('latin1')
    bytes += text.length
    const buf = tail + text
    const parts = buf.split('\n')
    tail = parts.pop()
    for (const raw of parts) {
      lines++
      const k = shapeOf(raw)
      if (k === null) continue
      if (onLine) onLine(k, raw)
      const rec = shapes.get(k)
      // +1 for the newline the split removed: the shapes' byte totals must
      // add up to the file, not to the file minus one byte per line.
      const n = raw.length + 1
      if (rec) { rec.n++; rec.bytes += n } else shapes.set(k, { n: 1, bytes: n })
    }
  }
  if (tail !== '') {
    lines++
    const k = shapeOf(tail)
    if (k !== null) {
      const rec = shapes.get(k)
      if (rec) { rec.n++; rec.bytes += tail.length } else shapes.set(k, { n: 1, bytes: tail.length })
    }
  }
  return { shapes, bytes, lines }
}

function report(res, { top, min }) {
  const rows = [...res.shapes.entries()]
    .map(([shape, r]) => ({ shape, n: r.n, bytes: r.bytes }))
    .filter((r) => r.n >= min)
    .sort((a, b) => b.bytes - a.bytes)
  const covered = rows.reduce((a, r) => a + r.bytes, 0)
  return { rows, covered }
}

/* ---------------------------------------------------------------- *
 * self-test
 * ---------------------------------------------------------------- */
const SELF_SRC = [
  'ScrStr *sc_t1 = scr_str_retain((ScrStr *)&sc_lit_7);',
  'ScrStr *sc_t22 = scr_str_retain((ScrStr *)&sc_lit_1234);',
  'ScrStr *sc_t3 = scr_str_retain((ScrStr *)&sc_lit_0);',
  '  scr_str_release(sc_t1);',
  '  scr_str_release(sc_t22);',
  '',
  'if (scr_exc_pending()) goto L12;',
  'if (scr_exc_pending()) goto L4;',
  'printf("hello %d", 3);',
  'printf("world %d", 44444);'
].join('\n') + '\n'

// (shape, occurrences) known by construction. The two printf lines differ
// only in a string and a number, so they MUST fold to one shape - that is
// the whole point of the normaliser and the thing most likely to break.
const SELF_EXPECT = [
  ['ScrStr *sc_t# = scr_str_retain((ScrStr *)&sc_lit_#);', 3],
  ['scr_str_release(sc_t#);', 2],
  ['if (scr_exc_pending()) goto L#;', 2],
  ['printf("S", N);', 2]
]

async function selfTest() {
  let bad = 0
  const check = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    console.log((ok ? 'ok   ' : 'FAIL ') + label + '  got ' + JSON.stringify(got) + (ok ? '' : '  want ' + JSON.stringify(want)))
    if (!ok) bad++
  }

  // 1. exact census over the whole buffer at once
  const one = await census(Readable.from([SELF_SRC]))
  check('lines', one.lines, 10)
  check('bytes', one.bytes, SELF_SRC.length)
  check('distinct shapes', one.shapes.size, SELF_EXPECT.length)
  for (const [shape, n] of SELF_EXPECT) {
    check('shape ' + JSON.stringify(shape), one.shapes.get(shape)?.n ?? 0, n)
  }
  // every byte of every non-blank line, plus its newline, is accounted for
  const sum = [...one.shapes.values()].reduce((a, r) => a + r.bytes, 0)
  check('bytes attributed + blank lines == file', sum + 1, SELF_SRC.length)

  // 2. THE CONTROL: the same bytes, delivered in 7-byte chunks, must
  //    produce a byte-for-byte identical census. If the streaming boundary
  //    invents or drops a line this is where it shows, and a shape counter
  //    that only works on one chunk size is not an instrument.
  const chunks = []
  for (let i = 0; i < SELF_SRC.length; i += 7) chunks.push(SELF_SRC.slice(i, i + 7))
  const many = await census(Readable.from(chunks))
  const canon = (r) => JSON.stringify([...r.shapes.entries()].sort())
  check('chunked census identical to whole-buffer', canon(many) === canon(one) && many.lines === one.lines && many.bytes === one.bytes, true)

  // 3. THE NEGATIVE CONTROL: a file that differs by one line must NOT
  //    census identical. A harness that cannot tell "changed" from
  //    "unchanged" reports both as whatever it always reports.
  const diff = await census(Readable.from([SELF_SRC + 'scr_dyn_release(sc_t9);\n']))
  check('one added line is detected', canon(diff) !== canon(one), true)

  console.log(bad === 0 ? '\nSELF-TEST PASS' : '\nSELF-TEST FAILED (' + bad + ')')
  return bad
}

/* ---------------------------------------------------------------- */
async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit(await selfTest() === 0 ? 0 : 1)

  const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] }
  const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--top' &&
    argv[argv.indexOf(a) - 1] !== '--min' && argv[argv.indexOf(a) - 1] !== '--json')
  if (!file) {
    console.error('usage: node shapes.mjs <program>.c [--top 40] [--min 1000] [--json out.json]')
    console.error('       node shapes.mjs --self-test')
    process.exit(2)
  }
  const TOP = Number.parseInt(flag('top', '40'), 10)
  const MIN = Number.parseInt(flag('min', '1000'), 10)
  const JSONOUT = flag('json', null)

  const res = await census(createReadStream(file, { encoding: 'latin1', highWaterMark: 1 << 22 }))
  const { rows, covered } = report(res, { top: TOP, min: MIN })

  console.log('file    ' + file)
  console.log('bytes   ' + res.bytes.toLocaleString('en-US') + '   lines ' + res.lines.toLocaleString('en-US'))
  console.log('shapes  ' + res.shapes.size.toLocaleString('en-US') + ' distinct; ' + rows.length.toLocaleString('en-US') + ' with n >= ' + MIN)
  console.log('covered ' + covered.toLocaleString('en-US') + ' bytes = ' + ((covered / res.bytes) * 100).toFixed(2) + '% of the file')
  console.log('')
  console.log('    rank        count          bytes   %file  shape')
  let r = 0
  for (const row of rows.slice(0, TOP)) {
    r++
    console.log(
      String(r).padStart(8) +
      row.n.toLocaleString('en-US').padStart(13) +
      row.bytes.toLocaleString('en-US').padStart(15) +
      ((row.bytes / res.bytes) * 100).toFixed(2).padStart(8) + '  ' +
      (row.shape.length > 110 ? row.shape.slice(0, 107) + '...' : row.shape)
    )
  }
  console.log('')
  console.log('SOURCE bytes, not .text bytes. Rank candidates here; price them on a real build.')

  if (JSONOUT) {
    writeFileSync(JSONOUT, JSON.stringify({
      schema: 'scriptc-emitted-shapes/1', file, bytes: res.bytes, lines: res.lines,
      distinctShapes: res.shapes.size, minCount: MIN, rows
    }, null, 2))
    console.log('wrote ' + JSONOUT)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
