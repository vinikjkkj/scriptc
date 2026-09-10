/* make-nobuf.mjs — derive the NO-BUFFER arm from the buffered one.
 *
 *   node make-nobuf.mjs <app182-dir>
 *
 * Writes <app182-dir>/zapo-rest-nobuf.ts from <app182-dir>/zapo-rest.ts.
 *
 * WHY A GENERATOR AND NOT A HAND-EDITED COPY. The two arms are 2,483 lines of
 * which ~40 differ. A hand-edited 100 KB duplicate drifts silently from its
 * control the first time the control is touched, and a comparison between two
 * arms that differ in more than the treatment is not a measurement. This script
 * IS the treatment: the diff between the arms is exactly the list of edits
 * below, it is re-derivable at any commit, and every edit ASSERTS its anchor
 * matched exactly once — so a control that moves under it fails loudly instead
 * of producing a wrong arm.
 *
 * WHY A SIBLING FILE AND NOT A SIBLING DIRECTORY. The entry path selects the
 * dependency tree: the build resolves a program's packages from the
 * node_modules beside its ENTRY FILE. A sibling file in app182/ therefore gets
 * app182's zapo-js 1.8.2 install for free; a sibling directory would need a
 * second install of the same tree, and a symlink or a re-exporting entry would
 * silently resolve to some other directory's node_modules.
 *
 * The compiler names its intermediate from the entry BASENAME, so
 * `zapo-rest-nobuf.ll` and `zapo-rest.ll` do not collide even in one output
 * directory. build.sh still gives them separate -o directories.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const SRC = join(dir, 'zapo-rest.ts')
const DST = join(dir, 'zapo-rest-nobuf.ts')

let text = readFileSync(SRC, 'utf8')
if (text.includes('\r')) {
    console.error('make-nobuf: the control has CR bytes; this generator assumes LF and would rewrite every line')
    process.exit(2)
}

const applied = []

/** Replace `from` with `to`, asserting it appeared EXACTLY once. */
function sub(name, from, to) {
    const n = text.split(from).length - 1
    if (n !== 1) {
        console.error(`make-nobuf: anchor '${name}' matched ${n} times, expected exactly 1`)
        console.error(`  the control has moved under this generator; re-read it before trusting either arm`)
        process.exit(3)
    }
    text = text.replace(from, to)
    applied.push(name)
}

/* ── 1. the cap ─────────────────────────────────────────────────────────
 * EVENT_BUFFER is gone. MSG_KEEP is NOT a rename of it: it is the separate
 * cap on the typed incoming-message array the media-download routes read
 * back from, which is a different buffer for a different feature and was not
 * in scope. Naming it separately is what stops the report claiming this arm
 * retains nothing when it still retains that. */
sub('cap',
    `const EVENT_BUFFER = envNum("ZAPO_EVENT_BUFFER", 1000);`,
    `/* NO EVENT RING IN THIS ARM. There is no ZAPO_EVENT_BUFFER because there is
 * no array for it to bound: an event is fanned out to whatever WebSocket
 * subscribers exist at the moment it happens and is then dropped. A consumer
 * that connects later has missed it, and GET /events says so with a 410
 * rather than an empty list, because an empty list and "this build keeps
 * nothing" are different facts and a caller must be able to tell them apart.
 *
 * WHAT THIS ARM STILL RETAINS, stated here so no reader has to discover it:
 * the typed incoming-message array below (MSG_KEEP). It is a SECOND bounded
 * buffer, it holds the same WaIncomingMessageEvent objects the ring used to
 * point at, and removing the ring does NOT free them. It exists because
 * message.download* takes a union an open JSON record cannot be re-tagged
 * into, so the only downloadable message is one this process received. */
const MSG_KEEP = envNum("ZAPO_MSG_KEEP", 1000);`)

/* ── 2. the WS window's rationale referred to the ring ─────────────────── */
sub('ws-window-doc',
    ` * grow this process's memory. It only stops being sent to. What it missed
 * stays where it already was -- in the per-session ring, which is bounded
 * (EVENT_BUFFER entries) and which the polling /events route reads from
 * too, so a subscriber and a poller cost the same memory.`,
    ` * grow this process's memory. It only stops being sent to.
 *
 * IN THIS ARM WHAT IT MISSED IS GONE. The buffered build could say "what it
 * missed stays where it already was, in the per-session ring"; there is no
 * ring here, so a subscriber past the window loses those events for good and
 * is told exactly which ones with a $gap frame. That is the trade the arm
 * exists to measure: no retention, and the loss made legible.`)

sub('ws-lag-doc',
    ` * it and closes with 1013 (try again later). The consumer reconnects with
 * ?since=<its last seq> and refills from the ring. */`,
    ` * it and closes with 1013 (try again later). The consumer reconnects and is
 * sent a $gap naming everything it missed while away -- there is no ring to
 * refill from, so ?since= buys a precise accounting of the loss, not a
 * replay. */`)

/* ── 3. the session record ──────────────────────────────────────────────
 * `events: Ev[]` is the buffer. It is the only field removed. */
sub('session-field',
    `  readonly createdMs: number;
  readonly events: Ev[];
  /* The incoming messages, kept a SECOND time at their real type.
   *
   * The ring above stores every event's payload as \`unknown\`, which is right
   * for /events and /messages (they serialize it) and useless for`,
    `  readonly createdMs: number;
  /* NO \`events: Ev[]\` FIELD. That array was the event buffer and this arm is
   * the build without it. Nothing here holds an Ev past the fan-out. */
  /* The incoming messages, kept at their real type.
   *
   * This is NOT the event ring returning under another name. It stores only
   * incoming messages, at the type zapo handed them over with, because
   * \`message.download*\` takes a
   * \`WaIncomingMessageEvent | Proto.IMessage\` union and`)

/* ── 4. push(): fan out, retain nothing ─────────────────────────────── */
sub('push',
    `function push(sess: Session, type: string, data: unknown): void {
  sess.seq += 1;
  const ev: Ev = { seq: sess.seq, at: Date.now(), type: type, data: data };
  sess.events.push(ev);
  if (sess.events.length > EVENT_BUFFER) sess.events.shift();
  /* The same event, pushed to whoever is listening on a socket instead of
   * polling. The ring above is unchanged and is still the only buffer. */
  wsFanout(sess.id, ev);
}`,
    `function push(sess: Session, type: string, data: unknown): void {
  /* The sequence number advances whether or not anybody is listening. It is
   * the service's event clock, not an index into a buffer: /health reports
   * it, a subscriber's $gap is expressed in it, and the download routes take
   * it as a parameter. Skipping the increment when nobody is subscribed
   * would make those numbers depend on who happened to be connected. */
  sess.seq += 1;
  /* NOBODY LISTENING, NOTHING TO DO. Not an optimisation dressed up as a
   * feature: with no ring, an Ev built here with no subscriber attached is
   * garbage before the function returns, and building one per event on an
   * idle service is the retention this arm exists to remove, just deferred
   * to the allocator. */
  if (wsSubs.length === 0) return;
  const ev: Ev = { seq: sess.seq, at: Date.now(), type: type, data: data };
  wsFanout(sess.id, ev);
  /* \`ev\` is unreachable from here. */
}`)

/* ── 5. the typed message array keeps its own cap ─────────────────────── */
sub('remember',
    `  if (sess.msgSeqs.length > EVENT_BUFFER) {`,
    `  if (sess.msgSeqs.length > MSG_KEEP) {`)

/* ── 6. since() had exactly one source, and it is gone ─────────────────── */
sub('since-fn',
    `function since(sess: Session, kindPrefix: string, from: number, limit: number): Ev[] {
  const out: Ev[] = [];
  for (const e of sess.events) {
    if (e.seq <= from) continue;
    if (kindPrefix !== "" && e.type !== kindPrefix) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}`,
    `/* There is no since(): it read the ring, and the ring is gone. The routes
 * that called it now refuse with 410 rather than returning an empty array
 * that a caller would read as "no events happened". */`)

/* ── 7. catch-up cannot replay; it can only account for the loss ──────── */
sub('catchup',
    `/** After an ack: send what the ring still holds past lastSentSeq, up to the
 * window. Events the ring has already evicted are reported as a gap rather
 * than silently skipped -- a consumer that cannot tell it lost events is
 * worse than one that reconnects. */
function wsCatchUp(sub: WsSub): void {
  const sess = findSession(sub.sessionId);
  if (sess === undefined) return;
  const ring = sess.events;
  if (ring.length === 0) return;
  const oldest = ring[0];
  if (oldest !== undefined && oldest.seq > sub.lastSentSeq + 1 && sub.lastSentSeq > 0) {
    wsSendText(sub, safeJson({ type: "$gap", fromSeq: sub.lastSentSeq + 1, toSeq: oldest.seq - 1 }));
    sub.lastSentSeq = oldest.seq - 1;
  }
  for (const ev of ring) {
    if (ev.seq <= sub.lastSentSeq) continue;
    if (!wsOffer(sub, ev)) return;
  }
}`,
    `/** There is nothing to catch up WITH. In the buffered build this replayed the
 * ring past the subscriber's last seq; with no ring the honest thing it can
 * still do is tell the subscriber exactly which sequence numbers it will
 * never see, and then start it live at the current seq.
 *
 * Called on attach with ?since=, and after an ack. A consumer that cannot
 * tell it lost events is worse than one that reconnects -- that rule
 * survives the ring; only the replay does not. */
function wsCatchUp(sub: WsSub): void {
  const sess = findSession(sub.sessionId);
  if (sess === undefined) return;
  if (sess.seq > sub.lastSentSeq) {
    wsSendText(sub, safeJson({
      type: "$gap",
      fromSeq: sub.lastSentSeq + 1,
      toSeq: sess.seq,
      reason: "this build retains no events; anything that happened before you subscribed is gone",
    }));
    sub.lastSentSeq = sess.seq;
    sub.ackedSeq = sess.seq;
  }
}`)

/* ── 8. the $hello frame must not claim a buffer ───────────────────────── */
sub('hello',
    `      buffered: sess.events.length,
      note: "acknowledge with {\\"ack\\":<seq>}; the server sends at most \`window\` events past your last ack",`,
    `      /* Not \`buffered\`: there is no buffer, and a 0 in a field named
       * "buffered" reads as an empty one rather than an absent one. */
      retention: "none",
      note: "acknowledge with {\\"ack\\":<seq>}; the server sends at most \`window\` events past your last ack. This build keeps NO event ring: subscribe BEFORE the traffic you want, because an event with no subscriber attached is dropped.",`)

/* ── 9. counts: report what is actually retained ───────────────────────── */
sub('counts-summarize',
    `    lastConnection: sess.lastConnectionEvent,
    counts: { sent: sess.sent, received: sess.recv, events: sess.events.length, seq: sess.seq },`,
    `    lastConnection: sess.lastConnectionEvent,
    counts: { sent: sess.sent, received: sess.recv, eventsRetained: 0, messagesRetained: sess.msgSeqs.length, seq: sess.seq },`)

sub('counts-health',
    `      state: sess.client.getState(),
      counts: { sent: sess.sent, received: sess.recv, events: sess.events.length, seq: sess.seq },`,
    `      state: sess.client.getState(),
      counts: { sent: sess.sent, received: sess.recv, eventsRetained: 0, messagesRetained: sess.msgSeqs.length, seq: sess.seq },`)

/* ── 10. the registry's description of the push endpoint ───────────────── */
sub('registry-push',
    `        params: "?since=<seq> replays from the ring (absent = live only), ?type=<name> filters, ?token= when ZAPO_REST_TOKEN is set",`,
    `        params: "?since=<seq> asks for an accounting of what you missed as a $gap frame (there is no ring to replay), ?type=<name> filters, ?token= when ZAPO_REST_TOKEN is set",`)

sub('registry-note',
    `        note: "the service keeps NO per-subscriber buffer; a consumer that stops acking stops being sent to and is closed with 1013, then reconnects with ?since=",`,
    `        retention: "none",
        note: "this build keeps NO event ring and no per-subscriber buffer. Subscribe BEFORE the traffic you want: an event that happens with no subscriber attached is dropped and GET /events is 410 Gone. A consumer that stops acking stops being sent to, is closed with 1013, and on reconnect is told what it missed as a $gap.",`)

/* ── 11. the polling routes ────────────────────────────────────────────── */
sub('events-route',
    `  if (path === "/events") {
    return since(sess, str(p, "type") !== undefined ? reqStr(p, "type") : "", num(p, "since") !== undefined ? reqNum(p, "since") : 0, num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }
  if (path === "/messages") {
    return since(sess, "message", num(p, "since") !== undefined ? reqNum(p, "since") : 0, num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }`,
    `  /* THE POLLING ROUTES ARE GONE, AND SAY SO.
   *
   * Leaving them returning [] was the other defensible option and it was
   * rejected: an empty array is the same answer this service gives when
   * nothing has happened yet, so a caller polling a no-retention build could
   * not distinguish "quiet" from "this build will never tell you". 410 Gone
   * is the status for a resource that existed and is permanently not coming
   * back, and the body names the route that does work.
   *
   * The routes are kept rather than deleted so the 404 handler's "no such
   * route" cannot be mistaken for a typo in the caller's URL. */
  if (path === "/events" || path === "/messages") {
    throw new Error(
      \`no event retention: this build keeps no event ring, so GET \${path} has nothing to read. \` +
        \`Subscribe to ws://\${HOST}:\${PORT}/s/\${sess.id}\${WS_ROUTE} BEFORE the traffic you want; an event \` +
        \`that happens with no subscriber attached is dropped. The session is at seq \${sess.seq}.\`,
    );
  }`)

/* ── 12. 410 is a classification, not a 500 ────────────────────────────── */
sub('fail-410',
    `  if (text.indexOf("missing required") === 0) {
    send(res, 400, { error: "bad_request", detail: text });
    return;
  }`,
    `  if (text.indexOf("missing required") === 0) {
    send(res, 400, { error: "bad_request", detail: text });
    return;
  }
  /* A route that existed in the buffered build and cannot exist in this one.
   * Not a 404 (the route is routable and the session is real), not a 501
   * (nothing is unimplemented), and not a 500 (nothing went wrong). */
  if (text.indexOf("no event retention") === 0) {
    send(res, 410, {
      error: "gone",
      reason: "this build retains no events; listen on the websocket before the traffic you want",
      websocket: \`/s/<sessionId>\${WS_ROUTE}\`,
      detail: text,
    });
    return;
  }`)

/* ── 13. the session is constructed without the array ──────────────────── */
sub('makesession',
    `    createdMs: Date.now(),
    events: [],
    msgSeqs: [],`,
    `    createdMs: Date.now(),
    msgSeqs: [],`)

/* ── 14. the download routes' error text named the wrong buffer ────────── */
{
    const from = `      throw new Error(\`no buffered message with seq \${seq} (take 'seq' from GET /messages; the buffer holds the last \${EVENT_BUFFER} events)\`);`
    const to = `      throw new Error(\`no retained message with seq \${seq} (take 'seq' from the websocket stream — GET /messages is 410 in this build; the typed message array holds the last \${MSG_KEEP} INCOMING messages)\`);`
    const n = text.split(from).length - 1
    if (n !== 2) {
        console.error(`make-nobuf: anchor 'download-msg' matched ${n} times, expected exactly 2`)
        process.exit(3)
    }
    text = text.split(from).join(to)
    applied.push('download-msg x2')
}

/* ── 15. the banner ────────────────────────────────────────────────────── */
sub('banner',
    `  console.log(\`  push     : ws://\${HOST}:\${PORT}/s/<sessionId>\${WS_ROUTE} — the /events stream, pushed\`);
  console.log(\`             window \${WS_WINDOW} unacked events, closed with 1013 after \${WS_LAG_MS}ms at the window\`);`,
    `  console.log(\`  push     : ws://\${HOST}:\${PORT}/s/<sessionId>\${WS_ROUTE} — the ONLY way to receive an event\`);
  console.log(\`             window \${WS_WINDOW} unacked events, closed with 1013 after \${WS_LAG_MS}ms at the window\`);
  console.log(\`  retention: NONE. No event ring; GET /events and GET /messages are 410 Gone.\`);
  console.log(\`             Subscribe before the traffic you want — an event with no subscriber is dropped.\`);
  console.log(\`             The last \${MSG_KEEP} INCOMING messages are still kept typed, for message.download*.\`);`)

/* ── the file's own header, so the arm is legible from its first line ──── */
const header = `/* zapo-rest — THE NO-BUFFER ARM.
 *
 * GENERATED. Do not hand-edit: run
 *   node ../../harness/nobuf/make-nobuf.mjs .
 * from this directory. The generator is the specification of the difference;
 * this file is its output. Every edit it makes asserts its anchor, so a
 * control that moves under it fails loudly rather than producing a wrong arm.
 *
 * The control is ./zapo-rest.ts, byte-identical to ../app/zapo-rest.ts. The
 * ONLY difference in this file is the removal of the per-session event ring:
 * an event is fanned out to whatever WebSocket subscribers exist at that
 * moment and then dropped. Whoever wants events has to be listening
 * beforehand. GET /events and GET /messages answer 410 Gone.
 *
 * It still retains the typed incoming-message array (MSG_KEEP, default 1000)
 * that message.download* reads back from. That is a different buffer for a
 * different feature; it was not in scope, and it holds the same objects the
 * ring used to point at, so removing the ring does not free them.
 */
`
text = header + text

writeFileSync(DST, text, 'utf8')
console.log(`make-nobuf: wrote ${DST}`)
console.log(`  edits applied: ${applied.length}`)
for (const a of applied) console.log(`    - ${a}`)

/* A generator that cannot fail has not been shown to work. These are the
 * post-conditions, checked against the OUTPUT.
 *
 * They are checked against the output with COMMENTS AND STRINGS BLANKED, and
 * that is not a detail: the first run of this generator failed all three
 * absence checks on its own explanatory prose, which names every construct it
 * removed. A check that cannot tell code from a comment about code reports a
 * ring that is not there. */
function codeOnly(s) {
    let out = ''
    let i = 0
    const n = s.length
    while (i < n) {
        const c = s[i], d = s[i + 1]
        if (c === '/' && d === '*') { const e = s.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; out += ' '; continue }
        if (c === '/' && d === '/') { const e = s.indexOf('\n', i); i = e === -1 ? n : e; out += ' '; continue }
        if (c === '"' || c === "'" || c === '`') {
            const q = c
            i++
            while (i < n && s[i] !== q) { if (s[i] === '\\') i++; i++ }
            i++
            out += ' '
            continue
        }
        out += c
        i++
    }
    return out
}
const code = codeOnly(text)
const mustBeAbsent = [
    ['sess.events', 'a read of the removed ring'],
    ['EVENT_BUFFER', 'the removed cap'],
    ['events: Ev[]', 'the removed field'],
]
/* The knob NAME lives only inside a string literal, which codeOnly() blanks,
 * so it cannot be checked as code — the positive control below caught exactly
 * that and rejected an earlier version of this list. It is checked against the
 * raw text instead, spelled as the call it appears in so this generator's own
 * prose about the removed knob does not match it. */
const KNOB_CALL = 'envNum("ZAPO_EVENT_BUFFER"'
let bad = 0
for (const [needle, why] of mustBeAbsent) {
    const n = code.split(needle).length - 1
    if (n !== 0) { console.error(`make-nobuf: POST-CONDITION FAILED: '${needle}' (${why}) still appears ${n} time(s) in CODE`); bad++ }
}
const mustBePresent = [['MSG_KEEP', 'the message cap'], ['wsFanout(sess.id, ev)', 'the fan-out'], ['wsSubs.length === 0', 'the no-subscriber early return']]
for (const [needle, why] of mustBePresent) {
    if (!code.includes(needle)) { console.error(`make-nobuf: POST-CONDITION FAILED: '${needle}' (${why}) is missing from CODE`); bad++ }
}
if (!text.includes('no event retention')) { console.error(`make-nobuf: POST-CONDITION FAILED: the 410 marker string is missing`); bad++ }
if (text.includes(KNOB_CALL)) { console.error(`make-nobuf: POST-CONDITION FAILED: the removed knob is still read (${KNOB_CALL})`); bad++ }

/* POSITIVE CONTROL. Every check above can only say "yes"; five separate
 * checks on this project have failed silently that way in one day. Run the
 * absence checks against the CONTROL, where all three must FIRE. If they do
 * not, the checks are not looking at anything and their pass on the arm is
 * worth nothing. */
const controlRaw = readFileSync(SRC, 'utf8')
const controlCode = codeOnly(controlRaw)
const missed = mustBeAbsent.filter(([needle]) => !controlCode.includes(needle)).map(([n]) => n)
if (!controlRaw.includes(KNOB_CALL)) missed.push(KNOB_CALL)
if (missed.length > 0) {
    console.error('make-nobuf: POSITIVE CONTROL FAILED — these absence checks do not fire on the CONTROL,')
    console.error('  so their pass on the arm proves nothing:')
    for (const m of missed) console.error(`    - ${m}`)
    bad++
} else {
    console.log(`make-nobuf: positive control PASS — all ${mustBeAbsent.length + 1} absence checks fire on the control`)
}

if (bad > 0) process.exit(4)
console.log('make-nobuf: post-conditions PASS (no ring reads, no event-buffer cap, fan-out intact)')
