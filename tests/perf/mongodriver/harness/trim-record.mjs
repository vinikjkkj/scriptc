/* trim-record.mjs <in.json> <out.json>
 *
 * Drops the `unreached` SITES from a sites.mjs record and keeps everything
 * else, including `unreachedStats`. The unreached section is 1,245 entries
 * against 238 blockers and is ~80% of the file; nothing in this block's report
 * is computed from it, and cluster.mjs / classify.mjs / sitediff.mjs all read
 * `section === "blocker"` only.
 *
 * The trimmed record is marked `trimmed: "unreached sites dropped"` so a later
 * reader cannot mistake it for a full one, and the blocker/fence/advisory
 * counts are asserted unchanged before writing.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [inp, outp] = process.argv.slice(2)
if (!inp || !outp) { console.error('usage: node trim-record.mjs <in.json> <out.json>'); process.exit(1) }
const r = JSON.parse(readFileSync(inp, 'utf8'))
if (!Array.isArray(r.sites)) throw new Error('BLIND: no sites array')

const count = (rec, sec) => rec.sites.filter((s) => s.section === sec).length
const before = { blocker: count(r, 'blocker'), runtimeFence: count(r, 'runtimeFence'), advisory: count(r, 'advisory'), unreached: count(r, 'unreached') }

r.sites = r.sites.filter((s) => s.section !== 'unreached')
r.trimmed = `unreached sites dropped (${before.unreached} entries); unreachedStats kept`

const after = { blocker: count(r, 'blocker'), runtimeFence: count(r, 'runtimeFence'), advisory: count(r, 'advisory') }
for (const k of ['blocker', 'runtimeFence', 'advisory']) {
  if (before[k] !== after[k]) throw new Error(`TRIM CHANGED ${k}: ${before[k]} -> ${after[k]}`)
}
writeFileSync(outp, JSON.stringify(r, null, 1))
console.log(`${inp}: blocker ${after.blocker}, fence ${after.runtimeFence}, advisory ${after.advisory}; dropped ${before.unreached} unreached`)
