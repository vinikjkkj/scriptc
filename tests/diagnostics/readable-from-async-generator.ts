// `Readable.from` over an ASYNC GENERATOR — zapo's
// `src/media/sticker/sticker-pack.ts:140`, row 15 of the 24-row refusal
// survey, reduced to six lines.
//
// The row is TWO fences and only ONE of them is rendered here, which is
// the whole point of the pin:
//
//   1. SC1071 `async generators (async function*)` fires in
//      `collectSignatureInner` on the DECLARATION. It does NOT appear
//      below: the call site refused first, so `chunks`'s body is never
//      lowered and the fence lands in coverage's "in unreached code"
//      bucket (zapo's own coverage report puts it there too). Closing
//      fence 2 makes fence 1 blocking.
//   2. SC2020 at the `Readable.from` CALL — `lowerStreamStaticCall` has
//      array / string / Buffer sources and nothing else.
//
// So closing (2) alone would not compile this program; it would reveal
// (1) underneath. That is why the survey priced the row as "two features"
// and why no reduction that stops at (2) has finished it.
//
// The second fence used to print `'?'` for the source type — `L.fmt` has
// no spelling for a type `mapType` refused, and `Readable.from` is the
// one fence that reaches it with a null. Five censuses of zapo carried an
// anonymous `Readable.from over a '?' source` because of it. The checker
// always has a name; the snapshot below is what naming it looks like, and
// that rename is the whole of the compiler change that added this file.
import { Readable } from "node:stream";

async function* chunks(): AsyncGenerator<Uint8Array> {
  yield new Uint8Array([1, 2, 3]);
}

export function make(): Readable {
  return Readable.from(chunks());
}

console.log(typeof make);

// The SYNC generator is the control: it clears fence 1 entirely
// (generators lower on fibers, and `.next()` / `for-of` over one
// compiles), and reaches fence 2 with a source type `mapType` also
// refuses — so the same call site reports the same code with a DIFFERENT
// name. The two names are what tell the reader which of the two missing
// features is missing at which site.
function* syncChunks(): Generator<Uint8Array> {
  yield new Uint8Array([4, 5]);
}

export function makeSync(): Readable {
  return Readable.from(syncChunks());
}

console.log(typeof makeSync);
