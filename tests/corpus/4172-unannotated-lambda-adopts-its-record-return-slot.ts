// An UNANNOTATED lambda whose body is an object literal, handed to a
// parameter that spells a record return.
//
// tsc infers the lambda's return from the body, and a body that writes
// `field: undefined` infers that field as the bare unit `undefined`. The
// compiler maps a bare unit field to the PADDED unit-only union `null |
// undefined` (a lone unit arm has no representation). Meanwhile the literal
// itself lowers at its CONTEXTUAL shape — which is the slot's record. So the
// ABI return slot and the body value came from two different types, and the
// return coercion refused a pair tsc had already vetted:
//
//   SC2002 record shapes must match exactly or width-coerce:
//     expected '{ name: string; routingInfo: null | undefined }',
//     got '{ name: string; routingInfo: Uint8Array | undefined }'
//     — field 'routingInfo': 'Uint8Array | undefined' does not lift into
//       'null | undefined'
//
// zapo's `patchCredentials((credentials) => ({ ...credentials, routingInfo:
// undefined }), …)` at auth/WaAuthClient.ts:308 is that site.
//
// THE SPREAD IS NOT THE DECLINER, and `clearNoSpread` below is the control
// that says so: the identical refusal reproduces with the spread absent. The
// object-spread lowering already skips a source field a later contributor
// unconditionally defines (JS last-write-wins), so `{ ...c, routingInfo:
// undefined }` never width-checked `routingInfo` in the first place. What
// decides it is the unannotated lambda; `annotated` below compiles on base
// today and is the second control.
//
// The fix is the record twin of the contextual-return adoption that unions
// already had: the lambda adopts the slot's record as its ABI return, and
// every return site still coerces into it.

type Creds = {
  readonly name: string;
  readonly routingInfo?: Uint8Array;
  readonly seq: number;
};

function patch(f: (c: Creds) => Creds, c: Creds): Creds {
  return f(c);
}

const base: Creds = { name: "n", routingInfo: new Uint8Array([1, 2]), seq: 3 };

// The zapo shape: spread, then override one field with `undefined`.
const cleared = patch((c) => ({ ...c, routingInfo: undefined }), base);
console.log(cleared.name, cleared.seq, cleared.routingInfo === undefined);

// CONTROL 1 — the spread removed. Same refusal on base, so the spread was
// never the decliner.
const clearNoSpread = patch((c) => ({ name: c.name, seq: c.seq, routingInfo: undefined }), base);
console.log(clearNoSpread.name, clearNoSpread.seq, clearNoSpread.routingInfo === undefined);

// CONTROL 2 — the return annotated. This one compiles on base; it is here so
// the fixture proves the fix did not change it.
const annotated = patch((c): Creds => ({ ...c, routingInfo: undefined }), base);
console.log(annotated.name, annotated.seq, annotated.routingInfo === undefined);

// A block body reaches the same coercion through `return`.
const blockBody = patch((c) => {
  return { ...c, routingInfo: undefined };
}, base);
console.log(blockBody.name, blockBody.seq, blockBody.routingInfo === undefined);

// The other direction: a literal that SETS the optional field, so the
// inferred and contextual shapes differ the other way round.
const setAgain = patch((c) => ({ ...c, routingInfo: new Uint8Array([9]) }), base);
console.log(setAgain.name, setAgain.seq, setAgain.routingInfo?.length);

// The source keeps its own value — a patch builds a new record.
console.log(base.routingInfo?.length, base.seq);

// Two returns in one lambda, both coercing into the adopted slot.
const branchy = patch((c) => {
  if (c.seq > 0) return { ...c, routingInfo: undefined };
  return { name: "zero", seq: 0, routingInfo: undefined };
}, base);
console.log(branchy.name, branchy.seq, branchy.routingInfo === undefined);
