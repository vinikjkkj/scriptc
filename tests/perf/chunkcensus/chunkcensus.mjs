/* chunkcensus.mjs - reader for tests/perf/chunkcensus.
 *
 *   node chunkcensus.mjs --report <file> [--snap N|last]
 *   node chunkcensus.mjs --self-test --dense <f> --sparse <f> [--null <f>]
 *
 * IT REFUSES RATHER THAN RENDERS when the report cannot be trusted, and
 * the refusals are the point. Four ways a chunk census can be wrong while
 * still producing a well-formed table, each with a named check:
 *
 *   no CHUNKCEN-ARMED line     the build never carried the instrument.
 *                              This is tests/perf/u16census's failure: a
 *                              census driven by the wrong worktree's CLI
 *                              wrote a perfectly well-formed table of
 *                              nothing and the image even grew.
 *   cycWalk/strWalk=ABSENT     the header was force-included but the
 *                              runtime .c that owns the walk was compiled
 *                              without the hook, so that arena reads zero
 *                              for a reason that has nothing to do with
 *                              the workload.
 *   regcheck=MISMATCH          the registry disagrees with the arena's own
 *                              scr_cyc_ar_held. Every total is wrong.
 *   CHUNKCEN-CYCBAD rows       a chunk failed used == carved - freeN, or
 *                              its free list did not close. Those chunks
 *                              are excluded from the totals, so the totals
 *                              are a floor and must not be read as totals.
 *
 * THE SELF-TEST IS A DISCRIMINATION TEST, not a liveness test. An
 * instrument that can only say "yes, there are chunks" answers nothing:
 * the question is how full they are, and the whole decision turns on
 * telling 90% from 5%. So it takes TWO reports from the SAME binary --
 * occupancy-control.ts at KC_KEEP=1 and KC_KEEP=10 -- and requires the
 * census to separate them in both directions: occupancy high and ceiling
 * near zero on the dense arm, occupancy low and ceiling large on the
 * sparse one. A census that passed the dense arm alone would be passing
 * the case it is least likely to get wrong.
 */
import { readFileSync } from 'node:fs'

const MiB = 1024 * 1024

function arg(name, dflt = null) {
    const i = process.argv.indexOf('--' + name)
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const has = (name) => process.argv.includes('--' + name)

/** kv parser for `a=1 b=2` tails; values stay strings, callers coerce. */
function kv(line) {
    const out = {}
    for (const tok of line.trim().split(/\s+/)) {
        const i = tok.indexOf('=')
        if (i > 0) out[tok.slice(0, i)] = tok.slice(i + 1)
    }
    return out
}
const num = (v) => (v === undefined ? 0 : Number(v))

/** Splits a report into snapshots. A file may hold many (the seam samples
 *  periodically); the LAST one is the settled reading unless asked. */
export function parse(text) {
    const lines = text.split(/\r?\n/)
    const armed = lines.find((l) => l.startsWith('CHUNKCEN-ARMED '))
    const head = armed ? kv(armed.slice('CHUNKCEN-ARMED '.length)) : null
    const snaps = []
    let cur = null
    for (const l of lines) {
        if (l.startsWith('CHUNKCEN-SNAP ')) {
            const rest = l.slice('CHUNKCEN-SNAP '.length)
            const seq = Number(rest.split(/\s+/)[0])
            cur = { seq, ...kv(rest), cyc: null, cycBytes: null, cycPage: null,
                    str: null, strPage: null, cycOcc: [], strOcc: [], cls: [],
                    bad: [], cycChunks: [], strChunks: [], noCyc: false, noStr: false }
            snaps.push(cur)
            continue
        }
        if (!cur) continue
        if (l.startsWith('CHUNKCEN-CYCBAD ')) cur.bad.push(l)
        else if (l.startsWith('CHUNKCEN-CYC NO-CHUNKS')) cur.noCyc = true
        else if (l.startsWith('CHUNKCEN-CYC WALK-ABSENT')) cur.cycAbsent = true
        else if (l.startsWith('CHUNKCEN-STR WALK-ABSENT')) cur.strAbsent = true
        else if (l.startsWith('CHUNKCEN-CYC ')) cur.cyc = kv(l.slice(13))
        else if (l.startsWith('CHUNKCEN-CYCBYTES ')) cur.cycBytes = kv(l.slice(18))
        else if (l.startsWith('CHUNKCEN-CYCPAGE ')) cur.cycPage = kv(l.slice(17))
        else if (l.startsWith('CHUNKCEN-CYCOCC ')) cur.cycOcc.push(l.slice(16).trim().split(/\s+/))
        else if (l.startsWith('CHUNKCEN-CYCCLASS ')) cur.cls.push(kv(l.slice(18)))
        else if (l.startsWith('CHUNKCEN-CYCCHUNK ')) cur.cycChunks.push(kv(l.slice(18)))
        else if (l.startsWith('CHUNKCEN-STRCHUNK ')) cur.strChunks.push(kv(l.slice(18)))
        else if (l.startsWith('CHUNKCEN-STRPAGE ')) cur.strPage = kv(l.slice(17))
        else if (l.startsWith('CHUNKCEN-STROCC ')) cur.strOcc.push(l.slice(16).trim().split(/\s+/))
        else if (l.startsWith('CHUNKCEN-STR ')) cur.str = kv(l.slice(13))
    }
    return { head, snaps }
}

/** Every reason this report may not be read as a measurement. */
export function refusals({ head, snaps }, snap) {
    const out = []
    if (!head) out.push('no CHUNKCEN-ARMED line: this build never carried the instrument')
    if (head && head.cycWalk !== 'compiled') out.push('cycWalk=' + head?.cycWalk + ': scr_cycle.c was built without the hook')
    if (head && head.strWalk !== 'compiled') out.push('strWalk=' + head?.strWalk + ': scr_string.c was built without the hook')
    if (!snaps.length) out.push('no CHUNKCEN-SNAP: the seam never fired (SCR_CHUNKCEN_MS unset, or the loop never slept)')
    if (snap) {
        if (snap.cycAbsent) out.push('snapshot ' + snap.seq + ': cycle walk ABSENT')
        if (snap.cyc && snap.cyc.regcheck !== 'OK')
            out.push('snapshot ' + snap.seq + ': regcheck=' + snap.cyc.regcheck +
                ' (registry ' + snap.cyc.heldBytes + ' vs arena ' + snap.cyc.arenaHeld + ')')
        if (snap.bad.length)
            out.push('snapshot ' + snap.seq + ': ' + snap.bad.length +
                ' chunk(s) failed their identity check; totals are a FLOOR:\n    ' + snap.bad.join('\n    '))
    }
    return out
}

function pct(a, b) { return b > 0 ? (100 * a / b) : 0 }

function report(file, which) {
    const p = parse(readFileSync(file, 'utf8'))
    const snap = which === 'last' || which === null
        ? p.snaps[p.snaps.length - 1]
        : p.snaps.find((s) => s.seq === Number(which))
    const refs = refusals(p, snap)
    console.log('# ' + file)
    if (p.head) console.log('  armed: chunk=' + p.head.chunkBytes + 'B page=' + p.head.page +
        'B cycWalk=' + p.head.cycWalk + ' strWalk=' + p.head.strWalk)
    console.log('  snapshots: ' + p.snaps.length)
    if (refs.length) {
        console.log('\nREFUSED — this report cannot be read as a measurement:')
        for (const r of refs) console.log('  * ' + r)
        if (!snap) return 1
    }
    if (!snap) return 1
    console.log('\n## snapshot ' + snap.seq + ' (ms=' + snap.ms + ' why=' + snap.why + ')')

    if (snap.noCyc) console.log('\ncycle arena: NO CHUNKS (explicit; not a row of zeros)')
    else if (snap.cyc) {
        const c = snap.cyc, b = snap.cycBytes ?? {}, g = snap.cycPage ?? {}
        const held = num(c.heldBytes)
        console.log('\ncycle arena')
        console.log('  chunks         ' + c.chunks + '  (cur=' + c.cur + ' part=' + c.part +
            ' full=' + c.full + ', held empty=' + c.emptyHeld + ')')
        console.log('  held           ' + (held / MiB).toFixed(2) + ' MiB   regcheck=' + c.regcheck)
        console.log('  live           ' + (num(b.liveBytes) / MiB).toFixed(2) + ' MiB in ' +
            b.liveBlocks + ' blocks   (' + pct(num(b.liveBytes), held).toFixed(1) + '% of held)')
        console.log('  on free lists  ' + (num(b.freelistBytes) / MiB).toFixed(2) + ' MiB in ' +
            b.freelistBlocks + ' blocks')
        console.log('  never carved   ' + (num(b.uncarvedBytes) / MiB).toFixed(2) + ' MiB')
        console.log('  PAGE CEILING   ideal ' + g.idealFreePg + '/' + g.idealCandPg + ' pages = ' +
            (num(g.idealFreeBytes) / MiB).toFixed(2) + ' MiB (' +
            pct(num(g.idealFreePg), num(g.idealCandPg)).toFixed(1) + '% of chunk pages)')
        console.log('                 real  ' + g.realFreePg + '/' + g.realCandPg + ' pages = ' +
            (num(g.realFreeBytes) / MiB).toFixed(2) + ' MiB')
        if (snap.cycOcc.length) {
            console.log('  occupancy (chunks by % live of capacity)')
            for (const [k, n] of snap.cycOcc) console.log('    ' + k.padStart(6) + '%  ' + n)
        }
        if (snap.cls.length) {
            console.log('  by size class')
            for (const r of snap.cls)
                console.log('    stride ' + String(r.stride).padStart(4) + '  chunks ' +
                    String(r.chunks).padStart(5) + '  live ' + String(r.live).padStart(8) +
                    '/' + String(r.cap).padStart(8) + '  (' +
                    pct(num(r.live), num(r.cap)).toFixed(1) + '%)  idealFreePg ' + r.idealFreePg)
        }
    }

    if (snap.str) {
        const s = snap.str, g = snap.strPage ?? {}
        const held = num(s.heldBytes)
        console.log('\nstring arena   (releasable=' + s.releasable + ')')
        console.log('  chunks         ' + s.chunks + (num(s.over) ? '  OVERFLOW=' + s.over + ' (registry full; totals are a FLOOR)' : ''))
        console.log('  held           ' + (held / MiB).toFixed(2) + ' MiB  — none of it can ever be freed; see scr_str_chunk_walk.h')
        console.log('  live           ' + (num(s.liveBytes) / MiB).toFixed(2) + ' MiB  (' +
            pct(num(s.liveBytes), held).toFixed(1) + '% of held)')
        console.log('  on free lists  ' + (num(s.freelistBytes) / MiB).toFixed(2) + ' MiB in ' +
            s.freelistBlocks + ' blocks')
        console.log('  abandoned tail ' + (num(s.abandonedTailBytes) / MiB).toFixed(2) +
            ' MiB  (carved past, unreachable by any later allocation)')
        console.log('  free but not in any chunk: ' + s.freeForeign + ' blocks / ' +
            s.freeForeignBytes + ' B (malloc-fallback blocks on the shared lists)')
        console.log('  held fully empty: ' + s.emptyHeld + ' chunks')
        console.log('  PAGE CEILING   ideal ' + g.idealFreePg + '/' + g.idealCandPg + ' pages = ' +
            (num(g.idealFreeBytes) / MiB).toFixed(2) + ' MiB')
        console.log('  chunks not 4 KiB aligned: ' + s.misalignedChunks + '/' + s.chunks +
            ' (malloc gives 16-byte alignment, so page decommit would need VirtualAlloc)')
        if (snap.strOcc.length) {
            console.log('  occupancy (chunks by % live of 64 KiB)')
            for (const [k, n] of snap.strOcc) console.log('    ' + k.padStart(6) + '%  ' + n)
        }
    }
    return refs.length ? 1 : 0
}

/* ---- the self-test ---------------------------------------------------- */

function load(file, label) {
    const p = parse(readFileSync(file, 'utf8'))
    const snap = p.snaps[p.snaps.length - 1]
    const refs = refusals(p, snap)
    return { label, file, p, snap, refs }
}

function selfTest() {
    const denseF = arg('dense'), sparseF = arg('sparse'), nullF = arg('null')
    if (!denseF || !sparseF) {
        console.error('--self-test needs --dense <f> --sparse <f> (same binary, KC_KEEP=1 and KC_KEEP=10)')
        return 2
    }
    const fails = []
    const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) fails.push(msg) }

    const dense = load(denseF, 'dense'), sparse = load(sparseF, 'sparse')
    console.log('chunkcensus self-test')
    console.log('\n[1] both reports are readable at all')
    for (const a of [dense, sparse]) {
        ok(a.refs.length === 0, a.label + ': no refusals' + (a.refs.length ? ' — ' + a.refs.join('; ') : ''))
        ok(!!a.snap && !!a.snap.cyc, a.label + ': has a cycle-arena snapshot')
    }
    if (fails.length) { console.log('\nSELF-TEST FAILED (' + fails.length + ')'); return 1 }

    const dOcc = pct(num(dense.snap.cycBytes.liveBlocks), num(dense.snap.cycBytes.capBlocks))
    const sOcc = pct(num(sparse.snap.cycBytes.liveBlocks), num(sparse.snap.cycBytes.capBlocks))
    const dCeil = pct(num(dense.snap.cycPage.idealFreePg), num(dense.snap.cycPage.idealCandPg))
    const sCeil = pct(num(sparse.snap.cycPage.idealFreePg), num(sparse.snap.cycPage.idealCandPg))

    console.log('\n[2] the instrument SEES chunks in both arms (a null here means nothing below is meaningful)')
    ok(num(dense.snap.cyc.chunks) > 0, 'dense: chunks > 0 (got ' + dense.snap.cyc.chunks + ')')
    ok(num(sparse.snap.cyc.chunks) > 0, 'sparse: chunks > 0 (got ' + sparse.snap.cyc.chunks + ')')

    console.log('\n[3] DISCRIMINATION — the reason this instrument exists.')
    console.log('    dense  occupancy ' + dOcc.toFixed(1) + '%  ceiling ' + dCeil.toFixed(1) + '%')
    console.log('    sparse occupancy ' + sOcc.toFixed(1) + '%  ceiling ' + sCeil.toFixed(1) + '%')
    ok(dOcc >= 80, 'dense arm reads FULL (occupancy >= 80%)')
    ok(sOcc <= 30, 'sparse arm reads EMPTY-ISH (occupancy <= 30%)')
    ok(dOcc - sOcc >= 40, 'the two arms are separated by >= 40 occupancy points')
    ok(dCeil <= 10, 'dense arm reports a NEAR-ZERO page ceiling (<= 10%)')

    /* THE CEILING NEEDS ITS OWN POSITIVE CONTROL, and it is a different
     * arm from the occupancy one. The sparse arm is 90% free and yields
     * almost no whole free pages, because its survivors are spread over
     * every page -- which is a true and important result, and also means a
     * ceiling that always reads ~0 would look exactly the same as a
     * ceiling that is not being computed. The clustered arm retains the
     * SAME NUMBER of nodes in contiguous carve order; if the arithmetic
     * works it must report a large ceiling there. */
    const clusteredF = arg('clustered')
    if (clusteredF) {
        const clus = load(clusteredF, 'clustered')
        const cOcc = pct(num(clus.snap.cycBytes.liveBlocks), num(clus.snap.cycBytes.capBlocks))
        const cCeil = pct(num(clus.snap.cycPage.idealFreePg), num(clus.snap.cycPage.idealCandPg))
        console.log('    clustered occupancy ' + cOcc.toFixed(1) + '%  ceiling ' + cCeil.toFixed(1) + '%')
        ok(clus.refs.length === 0, 'clustered: no refusals')
        /* The two arms retain the SAME NODES, only placed differently, so
         * their live block counts must agree exactly. This is a far
         * stronger statement than "a comparable fraction" -- it pins the
         * two arms to one controlled variable, and it is checkable. */
        const sLive = num(sparse.snap.cycBytes.liveBlocks)
        const cLive = num(clus.snap.cycBytes.liveBlocks)
        ok(sLive === cLive,
            'sparse and clustered retain an IDENTICAL live population (' + sLive +
            ' vs ' + cLive + ' blocks) — survivor placement is the only variable')
        /* Chunk release already handles contiguous garbage: the clustered
         * arm empties whole chunks and the arena hands them back, so it
         * holds far fewer. That the SAME live data costs 6x more when
         * scattered is the retention mechanism, stated as a control. */
        const sCh = num(sparse.snap.cyc.chunks), cCh = num(clus.snap.cyc.chunks)
        ok(sCh >= cCh * 2,
            'scattered survivors pin >= 2x the chunks of clustered ones for the same live data (' +
            sCh + ' vs ' + cCh + ')')
        ok(cCeil >= 25, 'clustered arm reports a LARGE page ceiling (>= 25%, got ' + cCeil.toFixed(1) + '%)')
        ok(cCeil - sCeil >= 20,
            'placement alone moves the ceiling by >= 20 points (' + sCeil.toFixed(1) +
            '% scattered vs ' + cCeil.toFixed(1) + '% clustered) — the arithmetic is live, ' +
            'so a scattered ~0 is a RESULT and not a dead calculation')
    } else {
        console.log('  SKIP  no --clustered arm: the page ceiling has NO positive control in this run')
        fails.push('page ceiling ran without its positive control')
    }

    console.log('\n[4] the identity held on every chunk of both arms')
    ok(dense.snap.bad.length === 0, 'dense: 0 chunks failed used == carved - freeN')
    ok(sparse.snap.bad.length === 0, 'sparse: 0 chunks failed used == carved - freeN')
    ok(dense.snap.cyc.regcheck === 'OK', 'dense: registry reconciles with scr_cyc_ar_held')
    ok(sparse.snap.cyc.regcheck === 'OK', 'sparse: registry reconciles with scr_cyc_ar_held')

    if (nullF) {
        console.log('\n[5] the NEGATIVE control names its zero')
        const nul = load(nullF, 'null')
        ok(nul.p.head !== null, 'null: still ARMED (an unarmed build must not look like an empty one)')
        /* Not "zero chunks": the arena keeps ONE chunk per active class as
         * that class's cache and never releases it while it is current
         * (scr_cyc_ar_cur, a documented 32 x 64 KiB = 2 MiB ceiling). The
         * null control's real assertion is that nothing is LIVE in them. */
        const nLive = num(nul.snap?.cycBytes?.liveBlocks)
        ok(nul.snap ? (nul.snap.noCyc || nLive < 100) : false,
            'null: NO-CHUNKS, or fewer than 100 live blocks (got ' + nLive + ')')
        ok(num(nul.snap?.cyc?.chunks) <= 33,
            'null: chunks <= 33, i.e. nothing beyond the per-class cache (got ' +
            num(nul.snap?.cyc?.chunks) + ')')
    }

    console.log(fails.length ? '\nSELF-TEST FAILED (' + fails.length + ' checks)' : '\nSELF-TEST PASSED')
    return fails.length ? 1 : 0
}

let rc = 0
if (has('self-test')) rc = selfTest()
else if (arg('report')) rc = report(arg('report'), arg('snap', 'last'))
else {
    console.error('usage: chunkcensus.mjs --report <file> [--snap N|last]')
    console.error('       chunkcensus.mjs --self-test --dense <f> --sparse <f> [--null <f>]')
    rc = 2
}
process.exit(rc)
