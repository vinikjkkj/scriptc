// `Readable.from` over a generator — what is left of zapo's
// `src/media/sticker/sticker-pack.ts:140` now that the row has fallen.
//
// The row was TWO fences stacked at one call site:
//
//   1. SC1071 `async generators (async function*)` in
//      `collectSignatureInner`, on the DECLARATION.
//   2. SC2020 at the `Readable.from` CALL — `lowerStreamStaticCall` had
//      array / string / Buffer sources and nothing else.
//
// BOTH are closed for the zapo shape. A declaration-scope `async
// function*` lowers onto the scr_agen_* fiber protocol, and an async
// generator yielding Uint8Array/Buffer or string is now a PULL source for
// a Readable — Node's from() loop, one `next()` per `_read`. The program
// this file used to carry moved to `tests/corpus/5940-…`, where Node is
// its oracle instead of a snapshot, which is what the old header asked
// for in as many words.
//
// Two fences survive here, and each is a real boundary rather than an
// omission:
import { Readable } from "node:stream";

// (a) A SYNCHRONOUS generator source. Node's from() accepts it — it wraps
// the sync iterator in an async one — but the runtime's pump resumes an
// ScrGen through the ASYNC protocol (a promise per request, an await
// allowed between yields), and a synchronous generator has no such
// handle. Wiring it means a second pump, not a wider type test, so the
// fence stays until someone writes one.
function* syncChunks(): Generator<Uint8Array> {
  yield new Uint8Array([4, 5]);
}

export function makeSync(): Readable {
  return Readable.from(syncChunks());
}

console.log(typeof makeSync);

// (b) An async generator yielding something the readable buffer cannot
// hold. Entries in that buffer are ScrBytes or ScrStr, and the pump moves
// the generator's OUT slot straight into it as a reference — so a number
// yield would be read as a pointer. The refusal NAMES the yield type,
// which is the whole difference between this and the old anonymous `'?'`
// the row carried through five censuses.
async function* numbers(): AsyncGenerator<number> {
  yield 1;
}

export function makeNumbers(): Readable {
  return Readable.from(numbers());
}

console.log(typeof makeNumbers);
