// @deferred-fences: 1
// The one fence is `process.exitCode = 1` in main()'s rejection handler:
// assignment to a stdlib MEMBER has no static lowering (SC1090), so the
// statement carries a runtime fence. main() resolves in both lanes, so
// the handler never runs and the differential oracle is unaffected --
// this line is the bookkeeping the corpus sweep asks for, added when
// the program did not carry it.
// `Readable.from([...])` and the state a fresh one is in.
//
// The lowering seeds these streams from an array, and the runtime used to
// push every entry and then push_null() inside the constructor. That made
// `_readableState.ended` answer true and `.length` answer <n> the instant
// the stream existed, where Node answers false and 0 — a silent wrong
// value with no trap anywhere near it, on both backends. Node's from()
// wraps the iterable in an async generator and pulls ONE value per _read;
// the runtime now parks the source and does the same.
//
// The eager seed was visible from three directions, and all three are
// pinned here: the construction-time read, a 'data'/'end' run, and a
// pipe().

const { Readable, PassThrough } = require("node:stream");

async function main() {
  // ── at construction: nothing buffered, nothing ended ─────────────────
  const a = Readable.from(["a", "b"]);
  console.log("fresh:", a._readableState.ended, a._readableState.length);
  console.log("fresh-flowing:", a._readableState.flowing);
  console.log("fresh-destroyed:", a._readableState.destroyed, a._readableState.closed);
  console.log("fresh-objectMode:", a._readableState.objectMode);

  // ── a 'data' run: the entries arrive, the state ends after them ──────
  const seen = [];
  await new Promise((resolve) => {
    a.on("data", (c) => {
      seen.push(c.toString());
    });
    a.on("end", () => {
      console.log("end:", a._readableState.ended, a._readableState.length);
      console.log("end-emitted:", a._readableState.endEmitted);
      resolve(0);
    });
  });
  console.log("data:", seen.join("|"));

  // ── for-await over a fresh one ───────────────────────────────────────
  const b = Readable.from(["x", "y", "z"]);
  console.log("await-pre:", b._readableState.ended, b._readableState.length);
  const got = [];
  for await (const c of b) got.push(c.toString());
  console.log("await:", got.join("|"));
  console.log("await-post:", b._readableState.ended, b._readableState.endEmitted);

  // ── an EMPTY source: still not ended until the first pull ────────────
  const e = Readable.from([""].slice(1));
  console.log("empty-pre:", e._readableState.ended, e._readableState.length);
  const none = [];
  for await (const c of e) none.push(c.toString());
  console.log("empty:", none.length, e._readableState.ended, e._readableState.endEmitted);

  // ── Node's single string/Buffer special case: ONE whole chunk ────────
  const s = Readable.from("hello");
  console.log("str-pre:", s._readableState.ended, s._readableState.length);
  const parts = [];
  for await (const c of s) parts.push(c.toString());
  console.log("str:", parts.join("|"), parts.length, s._readableState.ended);

  // ── a Buffer array source ────────────────────────────────────────────
  const bufs = Readable.from([Buffer.from("p"), Buffer.from("qq")]);
  console.log("buf-pre:", bufs._readableState.ended, bufs._readableState.length);
  const bseen = [];
  for await (const c of bufs) bseen.push(c.toString());
  console.log("buf:", bseen.join("|"));

  // ── pipe(): the source is not ended before the pipe runs ─────────────
  const src = Readable.from(["p", "q", "r"]);
  const dst = new PassThrough();
  const piped = [];
  await new Promise((resolve) => {
    dst.on("data", (c) => {
      piped.push(c.toString());
    });
    dst.on("end", () => resolve(0));
    src.pipe(dst);
    console.log("pipe-sync:", src._readableState.ended, src._readableState.length);
  });
  console.log("pipe:", piped.join("|"), src._readableState.ended, src._readableState.length);

  // ── an UNCONSUMED from() stream: the parked source is released with
  // the state, and destroying one early must not double-release it.
  const dropped = Readable.from(["never", "read"]);
  console.log("dropped-pre:", dropped._readableState.ended, dropped._readableState.length);
  dropped.destroy();
  console.log("dropped:", dropped.destroyed);
}

main().then(
  () => console.log("done"),
  (err) => {
    console.log("rejected:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
