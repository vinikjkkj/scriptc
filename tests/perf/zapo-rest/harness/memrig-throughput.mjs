/* What a history sync COST in time, and whether the progress a consumer sees
 * was monotonic.
 *
 *   node memrig-throughput.mjs <runRoot> <tag> [<tag> ...]
 *
 * <runRoot>/<tag>.events.json is the service's own event ring, read over
 * `GET /events?type=history_sync_chunk` while the child was still alive. The
 * `history_sync_chunk` event fires after the chunk's writes are flushed, so its
 * `at` is the chunk's real COMPLETION -- not the "decoded history sync chunk"
 * log line, which is the decode START and says nothing about the write.
 *
 * Wall time is measured from the rig's `all-chunks-sent` marker, so it is the
 * service's time and not the rig's send time.
 *
 * `monotonic` is the check that matters for a consumer: the chunks complete
 * concurrently in the shipped client, so the progress values can arrive out of
 * order and the LAST value a poller sees need not be 100. An empty event list
 * is reported as a failure to look, never as a pass. */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [runRoot, ...tags] = process.argv.slice(2)
if (!runRoot || !tags.length) {
    console.log('usage: node memrig-throughput.mjs <runRoot> <tag> [<tag> ...]')
    process.exit(2)
}
console.log('tag        sent->firstDone  sent->lastDone    n  finalProgress  monotonic  order')
for (const tag of tags) {
    const ef = join(runRoot, `${tag}.events.json`)
    const pf = join(runRoot, `${tag}.phases.csv`)
    if (!existsSync(ef) || !existsSync(pf)) {
        console.log(`${tag}: MISSING ${existsSync(ef) ? pf : ef} — could not look`)
        process.exitCode = 2
        continue
    }
    let payload
    try { payload = JSON.parse(readFileSync(ef, 'utf8')) } catch {
        console.log(`${tag}: events file is not JSON — could not look`)
        process.exitCode = 2
        continue
    }
    const events = Array.isArray(payload) ? payload : (payload.result ?? payload.events ?? null)
    if (!Array.isArray(events) || events.length === 0) {
        console.log(`${tag}: NO history_sync_chunk EVENTS — the ring was empty or the fetch failed; not a pass`)
        process.exitCode = 2
        continue
    }
    const phases = readFileSync(pf, 'utf8').trim().split(/\r?\n/).slice(1)
        .map((l) => { const i = l.indexOf(','); return { ms: Number(l.slice(0, i)), p: l.slice(i + 1) } })
    const sent = phases.find((p) => /^all-chunks-sent/.test(p.p))
    if (!sent) { console.log(`${tag}: no all-chunks-sent marker — could not look`); process.exitCode = 2; continue }
    const progress = events.map((e) => e.data?.progress)
    const monotonic = progress.every((p, i) => i === 0 || p >= progress[i - 1])
    const first = ((events[0].at - sent.ms) / 1000).toFixed(2)
    const lastAt = ((events[events.length - 1].at - sent.ms) / 1000).toFixed(2)
    console.log(`${tag.padEnd(10)} ${first.padStart(14)}s ${lastAt.padStart(14)}s ` +
        `${String(events.length).padStart(4)}  ${String(progress[progress.length - 1]).padStart(13)}  ` +
        `${String(monotonic).padEnd(9)}  [${progress.join(',')}]`)
}
