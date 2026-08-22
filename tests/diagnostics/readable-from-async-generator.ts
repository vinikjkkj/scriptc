// `Readable.from` over an ASYNC GENERATOR — zapo's
// `src/media/sticker/sticker-pack.ts:140`, reduced to six lines.
//
// The row used to be TWO fences stacked at one call site:
//
//   1. SC1071 `async generators (async function*)` in
//      `collectSignatureInner`, on the DECLARATION.
//   2. SC2020 at the `Readable.from` CALL — `lowerStreamStaticCall` has
//      array / string / Buffer sources and nothing else.
//
// Fence 1 is CLOSED: a declaration-scope `async function*` now lowers onto
// the scr_agen_* fiber protocol and `for await` drives it. So `chunks`'s
// body compiles, its type maps, and what remains at this call site is
// fence 2 alone — the stream bridge, which is a separate feature: nothing
// in the runtime turns an async iterator into a pull-based Readable with
// Node's backpressure and objectMode semantics.
//
// That closure is why the rendered name below changed. While the type was
// unmapped the message fell back to the checker's spelling
// (`AsyncGenerator<Uint8Array<ArrayBufferLike>, any, any>`); now that
// `mapType` answers it, `L.fmt` renders the compiler's own NORMALIZED
// channels — `AsyncGenerator<Uint8Array, void, unknown>`, a defaulted
// TReturn being "no modeled return value" (void) and a defaulted TNext
// riding dyn. The sync control below has always printed that way, so the
// two lines now agree on one convention instead of two.
//
// The pin remains valuable in the same shape it always had: it is the one
// place a widening of `Readable.from` would show up, and if this file ever
// compiles clean, the bridge landed and this program belongs in
// tests/corpus with Node as its oracle.
import { Readable } from "node:stream";


async function* chunks(): AsyncGenerator<Uint8Array> {
  yield new Uint8Array([1, 2, 3]);
}

export function make(): Readable {
  return Readable.from(chunks());
}

console.log(typeof make);

// The SYNC generator is the control, and now it is a control in the
// strict sense: both sources map, both reach fence 2, and both render
// through `L.fmt`. The two lines differ ONLY in the kind name
// (Generator vs AsyncGenerator), which is what shows that the remaining
// refusal is about the STREAM BRIDGE and not about either generator
// flavour. Before async generators lowered, this line was the only one of
// the pair whose name came from the compiler rather than the checker.
function* syncChunks(): Generator<Uint8Array> {
  yield new Uint8Array([4, 5]);
}

export function makeSync(): Readable {
  return Readable.from(syncChunks());
}

console.log(typeof makeSync);
