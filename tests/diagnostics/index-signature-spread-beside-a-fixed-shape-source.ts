// zapo's `src/client/events/appstate-mutation.ts:40` and `:49` — two of the
// three "object spread involving index-signature shapes" refusals the real TU
// carried, and the two that STAY refused.
//
//     return {
//         schema: resolved.key,
//         operation: 'remove',
//         ...indexArgs,          // Readonly<Record<string, string|boolean|null>>
//         ...base                // a fixed `as const` shape
//     } as WaAppStateMutationEvent
//
// TWO walls were recorded here. ONE OF THEM IS GONE, and saying which is the
// point of this file: the argument that keeps the refusal has to be the one
// that is still true.
//
// GONE — "the target is a union of exact arms". A runtime-keyed bag asserted
// into such a union used to compile to strandedCoercionTrap's UNCONDITIONAL
// throw ("a '{ schema: string; [key: string]: string }' value is not
// representable in the target union") one line after Node reads the field. It
// no longer does: the arm is a run-time question and the checked dynamic
// extraction answers it, which is what the same value routed through an
// explicit `unknown` local always did. Corpus 4880 is that closure, byte-exact
// on both backends.
//
// STANDING — THE SLOT IS NOT UNIFORM. `base` publishes no index signature at
// all, and the literal's own members (`version: number`, `_raw`) are no arm of
// the `string | boolean | null` the one index-signature source offers. A
// recovered store would claim a uniform value type the shape does not have.
// (A member that IS an arm of the slot rides it now — that is what closes
// `schema: string`, and corpus 4880 pins it — so this fence has narrowed to
// exactly the members that do not fit and the sources that publish nothing.)
//
// STANDING BEHIND IT — THE ARMS ARE NOT TELLABLE APART. `WaAppStateMutationEvent`
// pairs a `set` arm and a `remove` arm per schema key, and the remove arm's
// fields are the set arm's minus a `Partial<DataForKey<K>>` — all optional, so
// a remove value MATCHES the set arm as well. The only thing separating them
// is the value of the `operation` string-literal discriminant, which the IR
// erases to `string`. Measured through the spelling that has no fence: a
// remove bag comes back tagged `set`, the fields read right, and the
// `operation === 'remove'` narrowing throws. The extraction declines that
// shape on purpose (dynCheckArmOrder's shadowing gate) rather than guess.
//
// Dropping the runtime keys instead is the silent answer, and it is the one
// the compiler must not give: `{ ...wide }` into a narrower slot already
// prints {"a":"A"} where Node prints {"a":"A","b":"B"} (divergence 36). The
// event would reach its listener without the index args that identify it.
declare function decodeIndexArgs(parts: readonly string[]): Readonly<Record<string, string | boolean | null>> | null;

const parts = ["Mute", "120363@g.us"];
const indexArgs = decodeIndexArgs(parts);
const base = { source: "sync", version: 3, _raw: { index: "Mute,120363@g.us" } } as const;
if (indexArgs) {
  const ev = {
    schema: "Mute",
    operation: "remove",
    ...indexArgs,
    ...base,
  };
  console.log(JSON.stringify(ev));
}
