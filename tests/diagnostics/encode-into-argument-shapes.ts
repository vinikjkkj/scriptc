/* `encodeInto`'s argument refusals, pinned from outside.
 *
 * The lowering is total over the shape it claims — a source STRING and a
 * destination bytes<u8> — and says so at the boundary rather than
 * silently taking a different road.
 *
 * THE SPREAD. `encodeInto` is declared with exactly two parameters, so a
 * plain call can never be misarity; a spread of a two-tuple is the
 * spelling that typechecks against that signature while presenting the
 * lowering with ONE argument node whose values are not separable at
 * compile time. There is nothing dishonest about the call — there is
 * simply no static split of the tuple — and the refusal names the arity
 * it actually saw rather than the arity the declaration promises.
 *
 * THE DESTINATION is refused too, and cannot be spelled here: every
 * well-typed TypeScript destination is a Uint8Array, and a cast erases to
 * the same bytes. It IS reachable from a JavaScript source, where an
 * untyped local is checked-dynamic and the fence defers into the
 * translation unit like every other JS-file SC2020 — measured, verbatim:
 *
 *   Uncaught Error: 'TextEncoder.encodeInto into 'unknown' values' is part
 *   of the standard library types but has no scriptc lowering yet
 *   [SC2020 at <file>:4]
 *
 * The reason is the same one the spread has: `written` is produced by
 * writing THROUGH the argument, so a destination the compiler cannot
 * prove is a Uint8Array has nowhere to put the bytes. */

export {};

const enc = new TextEncoder();

const pair: [string, Uint8Array] = ["hi", new Uint8Array(8)];
console.log(String(enc.encodeInto(...pair).written));
