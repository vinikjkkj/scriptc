// What is LEFT of "object spread involving index-signature shapes" once the
// spread-erased index recovery can widen its store.
//
// This file replaces `index-signature-spread-beside-a-fixed-shape-source.ts`,
// whose refusal is GONE. That one carried zapo's
// `src/client/events/appstate-mutation.ts:40`/`:49` —
//
//     { schema, operation: 'remove', ...indexArgs, ...base } as WaAppStateMutationEvent
//
// — and its argument was "the slot is not uniform": `base` publishes no index
// signature and `version: number` is no arm of the `string | boolean | null`
// that `indexArgs` offers, so a recovered store would claim a value type the
// shape does not have. True, and not a reason to refuse: a store whose value
// type holds EVERY contributor exists, and the checked-dynamic one is it. The
// literal folds into `{ [key: string]: unknown }` — insertion-ordered, so the
// key order stays JS's — and the assertion into the union takes the checked
// extraction, which now tells the `set` and `remove` arms apart by the value
// of their `operation` literal. Corpus 4952 is that closure, byte-exact
// against Node on both backends; 4950 and 4951 pin the discriminant itself.
//
// TWO things still refuse here, and both are about a member that has no home
// in an insertion-ordered store rather than about the store's type:
//
//   * AN ACCESSOR MEMBER has no data slot to fold. Its value is a CALL, and
//     the store holds values; folding it would either run the getter at
//     construction (JS runs it per read) or lose it. There is no third
//     answer that is not a wrong one.
//
//   * AN ARRAY-INDEX-LIKE NAME (`0`, `1`, …) has to enumerate FIRST across
//     the whole object — JS's own integer-key rule — while the store can
//     only place it where it was written. This is the rule
//     `overflowShapeKeysDenied` already encodes for granted overflows, and
//     it is the same rule here.
//
// Both are the FOLD's guards, and the fold is now the only shape the recovery
// produces once it has to widen — so what used to be a fence about the SLOT is
// a fence about the MEMBER.
declare function decodeIndexArgs(parts: readonly string[]): Readonly<Record<string, string>> | null;

const parts = ["Mute", "120363@g.us"];
const indexArgs = decodeIndexArgs(parts);
const base = { source: "sync", version: 3 } as const;

if (indexArgs) {
  const withAccessor = {
    schema: "Mute",
    ...indexArgs,
    ...base,
    get later(): string {
      return "L";
    },
  };
  console.log(JSON.stringify(withAccessor));
}

if (indexArgs) {
  const numbered = { 0: "zero", schema: "Mute", ...indexArgs, ...base };
  console.log(JSON.stringify(numbered));
}
