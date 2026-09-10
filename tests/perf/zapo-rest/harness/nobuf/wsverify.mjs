/* wsverify.mjs — did the WebSocket path actually deliver?
 *
 *   node wsverify.mjs <runRoot> <tag> [<tag> ...]
 *
 * A build that saves memory by dropping events nobody receives is not the
 * feature. This reads the two captures memrig writes and reports VALUES:
 *
 *   <tag>.ws.jsonl      a subscriber attached BEFORE any traffic
 *   <tag>.wslate.jsonl  a second one attached AFTER all of it, with ?since=0
 *
 * The early capture answers "does it deliver". The late one answers "and is
 * the retention actually gone" — on a build with a ring it replays, on a build
 * without one it gets a $gap and nothing else. Neither file alone can tell
 * those apart, which is the entire reason both exist.
 *
 * Exit 0 only if the early subscriber received events AND their sequence
 * numbers are contiguous. A capture that is merely non-empty is not a pass.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [runRoot, ...tags] = process.argv.slice(2)
if (!runRoot || tags.length === 0) {
    console.log('usage: node wsverify.mjs <runRoot> <tag> [<tag> ...]')
    process.exit(2)
}

function load(path) {
    if (!existsSync(path)) return null
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '')
    return lines.map((l) => { try { return JSON.parse(l) } catch { return { type: '$unparsed', raw: l.slice(0, 80) } } })
}

let bad = 0
for (const tag of tags) {
    console.log(`\n===== ${tag}`)
    const early = load(join(runRoot, `${tag}.ws.jsonl`))
    const late = load(join(runRoot, `${tag}.wslate.jsonl`))

    if (early === null) { console.log('  EARLY: no capture file — could not look'); bad++; continue }

    const hello = early.find((f) => f.type === '$hello')
    const gaps = early.filter((f) => f.type === '$gap')
    const lags = early.filter((f) => f.type === '$lag')
    /* A SERVICE FRAME IS NOT AN EVENT. $hello carries a `seq` field (the
     * session's current sequence number), so filtering on `typeof f.seq ===
     * "number"` counted it as a delivered event -- which made a late
     * subscriber that replayed NOTHING report "replayed 1 event, a ring is
     * present", the exact opposite of the truth. Every service frame's type
     * starts with "$" precisely so it can never collide with a zapo event
     * name; that is the discriminator to use. */
    const isEvent = (f) => typeof f.seq === 'number' && typeof f.type === 'string' && !f.type.startsWith('$')
    const events = early.filter(isEvent)

    console.log('  -- the subscriber attached BEFORE the traffic --')
    if (!hello) { console.log('    NO $hello FRAME — the socket never completed its handshake'); bad++ }
    else {
        console.log(`    $hello  sessionId=${hello.sessionId}  seq=${hello.seq}  since=${hello.since}  window=${hello.window}`)
        console.log(`            buffered=${hello.buffered ?? 'ABSENT'}   retention=${hello.retention ?? 'ABSENT'}`)
        console.log(`            ${hello.buffered !== undefined ? '(a ring is present and reports its depth)' : '(no ring: the field the buffered build sends is absent)'}`)
    }
    console.log(`    frames=${early.length}  events=${events.length}  $gap=${gaps.length}  $lag=${lags.length}`)

    if (events.length === 0) {
        console.log('    DELIVERED NOTHING — a subscriber was attached before the traffic and received no event.')
        console.log('    This is the failure mode the whole change has to be checked against.')
        bad++
    } else {
        const byType = new Map()
        for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
        console.log('    by type: ' + [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(' '))
        const seqs = events.map((e) => e.seq)
        const lo = Math.min(...seqs), hi = Math.max(...seqs)
        const missing = []
        const seen = new Set(seqs)
        for (let s = lo; s <= hi; s++) if (!seen.has(s)) missing.push(s)
        console.log(`    seq range ${lo}..${hi}, ${seqs.length} delivered, ${missing.length} missing inside the range`)
        if (missing.length) {
            console.log(`      missing: ${missing.slice(0, 20).join(',')}${missing.length > 20 ? ' …' : ''}`)
            console.log('      (a filtered subscriber legitimately skips seqs; an unfiltered one must not)')
        }

        /* VALUES, not counts. Print a real frame so the reader can see the
         * payload arrived intact and is not an empty envelope. */
        const msg = events.find((e) => e.type === 'message') ?? events[events.length - 1]
        console.log('    a delivered frame, in full-ish:')
        const s = JSON.stringify(msg)
        console.log('      ' + (s.length > 600 ? s.slice(0, 600) + ' …' : s))
        const chunk = events.find((e) => e.type === 'history_sync_chunk')
        if (chunk) console.log('      history_sync_chunk: ' + JSON.stringify(chunk))
    }

    console.log('  -- the subscriber attached AFTER all the traffic, ?since=0 --')
    if (late === null) console.log('    no late capture (WS_CAPTURE off, or the attach failed)')
    else {
        const lhello = late.find((f) => f.type === '$hello')
        const lgaps = late.filter((f) => f.type === '$gap')
        const levents = late.filter(isEvent)
        console.log(`    frames=${late.length}  replayed events=${levents.length}  $gap=${lgaps.length}`)
        if (lhello) console.log(`    $hello buffered=${lhello.buffered ?? 'ABSENT'} retention=${lhello.retention ?? 'ABSENT'}`)
        for (const g of lgaps.slice(0, 3)) console.log(`    $gap ${g.fromSeq}..${g.toSeq}${g.reason ? '  reason=' + g.reason : ''}`)
        if (levents.length > 0) {
            console.log(`    VERDICT: this build REPLAYED ${levents.length} event(s) to a late subscriber — a ring is present.`)
        } else if (lgaps.length > 0) {
            console.log('    VERDICT: this build replayed NOTHING and said so with a $gap — retention is gone,')
            console.log('             and the loss is legible to the consumer rather than silent.')
        } else {
            console.log('    VERDICT: nothing replayed AND no $gap — the loss is silent. That is a defect,')
            console.log('             not the designed behaviour.')
            bad++
        }
    }
}

console.log('')
if (bad) { console.log(`wsverify: ${bad} problem(s) above.`); process.exit(1) }
console.log('wsverify: every early subscriber received events; every late one was accounted for.')
