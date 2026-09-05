/* Row counts for a memrig run's store, plus the history-sync integrity checks
 * that a streaming or serialising change has to leave untouched.
 *
 *   node memrig-rows.mjs <runRoot> <tag> [<tag> ...]
 *
 * <runRoot> is memrig's OUT directory; the store is <runRoot>/<tag>/state.sqlite.
 * The path is an ARGUMENT and never a constant: a hardcoded run root that has
 * moved reports a clean table of zeroes and is believed. A tag whose database
 * is absent is reported as "could not look" and sets a non-zero exit — it is
 * never counted as zero rows.
 *
 * The history rows are the ones the rig generates: message ids start `3A` and
 * thread jids start `55119`. Everything else in the tables is the client's own
 * traffic (its prekeys, its app-state key-share message) and is excluded, so
 * the counts compare across arms even when the client's own traffic does not. */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const [runRoot, ...tags] = process.argv.slice(2)
if (!runRoot || !tags.length) {
    console.log('usage: node memrig-rows.mjs <runRoot> <tag> [<tag> ...]')
    process.exit(2)
}
if (!existsSync(runRoot)) {
    console.log(`run root ${runRoot} does not exist — could not look`)
    process.exit(2)
}

const rows = []
for (const tag of tags) {
    const p = join(runRoot, tag, 'state.sqlite')
    if (!existsSync(p)) {
        console.log(`${tag}: NO DB AT ${p} — could not look`)
        process.exitCode = 2
        continue
    }
    const db = new DatabaseSync(p, { readOnly: true })
    const one = (sql) => db.prepare(sql).get()
    rows.push({
        tag,
        msgs: one('SELECT COUNT(*) c FROM mailbox_messages').c,
        histMsgs: one("SELECT COUNT(*) c FROM mailbox_messages WHERE message_id LIKE '3A%'").c,
        threads: one('SELECT COUNT(*) c FROM mailbox_threads').c,
        histThreads: one("SELECT COUNT(*) c FROM mailbox_threads WHERE jid LIKE '55119%'").c,
        contacts: one('SELECT COUNT(*) c FROM mailbox_contacts').c,
        /* every message must land on a thread row that exists */
        threadsSeen: one("SELECT COUNT(DISTINCT thread_jid) c FROM mailbox_messages WHERE message_id LIKE '3A%'").c,
        orphanMsgs: one(`SELECT COUNT(*) c FROM mailbox_messages m
            WHERE m.message_id LIKE '3A%'
              AND NOT EXISTS (SELECT 1 FROM mailbox_threads t WHERE t.jid = m.thread_jid)`).c,
        /* a row written without its body is the shape a torn write would take */
        nullBytes: one(`SELECT COUNT(*) c FROM mailbox_messages
            WHERE message_id LIKE '3A%' AND (message_bytes IS NULL OR length(message_bytes) = 0)`).c,
        bytesSum: one("SELECT COALESCE(SUM(length(message_bytes)), 0) s FROM mailbox_messages WHERE message_id LIKE '3A%'").s,
        dupIds: one('SELECT COUNT(*) c FROM (SELECT message_id FROM mailbox_messages GROUP BY message_id HAVING COUNT(*) > 1)').c,
        /* the rig writes one message per (thread, timestamp); a thread whose row
         * count and distinct-timestamp count disagree lost or duplicated one */
        tsCollisions: one(`SELECT COUNT(*) c FROM (
            SELECT thread_jid FROM mailbox_messages WHERE message_id LIKE '3A%'
            GROUP BY thread_jid HAVING COUNT(*) <> COUNT(DISTINCT timestamp_ms))`).c,
        integrity: one('PRAGMA integrity_check').integrity_check
    })
    db.close()
}
if (!rows.length) {
    console.log('no database was read — this is not a pass')
    process.exit(2)
}
const cols = Object.keys(rows[0])
console.log(cols.join('\t'))
for (const r of rows) console.log(cols.map((c) => r[c]).join('\t'))
