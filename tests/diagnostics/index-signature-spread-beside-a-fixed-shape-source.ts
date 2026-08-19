// zapo's `src/client/events/appstate-mutation.ts:40` and `:49` — two of the
// three "object spread involving index-signature shapes" refusals the real TU
// carried, and the two that STAY refused after the spread-erased fold closed
// the third (`src/retry/replay.ts:369`, corpus 4802).
//
//     return {
//         schema: resolved.key,
//         operation: 'remove',
//         ...indexArgs,          // Readonly<Record<string, string|boolean|null>>
//         ...base                // a fixed `as const` shape
//     } as WaAppStateMutationEvent
//
// TWO walls stand here, and neither is the fold's.
//
// 1. THE SLOT IS NOT UNIFORM. `base` publishes no index signature, and the
//    literal's own members (`version: number`, `_raw`, the string-literal
//    discriminants) do not fit the `string | boolean | null` the one
//    index-signature source offers. A recovered store would claim a uniform
//    value type the shape does not have, and every undeclared key read would
//    answer at a type the value cannot produce.
//
// 2. THE TARGET IS A UNION OF EXACT ARMS. `WaAppStateMutationEvent` is a
//    mapped union whose every arm declares NAMED fields (`chatJid: string`,
//    `remote/id/fromMe/participant`), while `decodeIndexArgsFromSchema` writes
//    `part.name` off a schema chosen at run time. Even a bag the compiler CAN
//    build does not become such an arm: measured, the assertion throws
//    "a '{ schema: string; [key: string]: string }' value is not representable
//    in the target union" where Node prints the field.
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
