// zapo's `parseAppStateMutationEvent`, `src/client/events/appstate-mutation.ts:35-50`,
// reduced to the two things that made it refuse:
//
//     return {
//         schema: resolved.key,
//         operation: 'remove',
//         ...indexArgs,          // Readonly<Record<string, string | boolean | null>>
//     } as WaAppStateMutationEvent    // a union of exact per-schema arms
//
// `indexArgs` is decoded from a schema chosen at RUN TIME, so which keys the
// bag carries — and therefore which arm of the destination union the value
// is — is not a static fact. Two fences stood behind that one line:
//
//   1. the literal itself. `spreadErasedIndexValue` recovers the signature
//      tsc erases from a spread, but it demanded that every DECLARED member
//      match the recovered slot EXACTLY. `schema: string` is one ARM of the
//      `string | boolean | null` slot `indexArgs` publishes, not the whole
//      of it, so the recovery declined and the desugar refused the spread.
//      The subset rule the FOLD already uses answers here; taking it means
//      taking the fold's shape (a pure index-signature record, no struct
//      slots), which is order-correct for every arrangement.
//
//   2. the assertion. A record with an overflow store has no static width
//      lift into ANY exact arm — every arm's members might live in the
//      store — so the candidate list came back empty and the flow compiled
//      to strandedCoercionTrap's UNCONDITIONAL throw:
//
//        TypeError: a '{ operation: string; schema: string; [key: string]: string }'
//        value is not representable in the target union
//
//      one line after a value Node builds and reads without complaint. But
//      "which arm is this" is a run-time question, and the compiler already
//      answers it: `const u: unknown = bag; u as Ev` extracts correctly and
//      always did. Only the collapsed spelling (`bag as unknown as Ev`, and
//      the assertion straight off the literal) reached the trap.
//
// Every case below prints the JSON — key order included, since the store is
// insertion-ordered and that is what a JS object's key list is — and reads
// the arm back through the discriminant, which is the surface a listener
// uses.

type Slot = string | boolean | null;

type MuteSet = {
  readonly schema: 'Mute';
  readonly operation: 'set';
  readonly chatJid: string;
  readonly muteEndTs: string;
};
type MuteRemove = {
  readonly schema: 'Mute';
  readonly operation: 'remove';
  readonly chatJid: string;
};
type StarRemove = {
  readonly schema: 'Star';
  readonly operation: 'remove';
  readonly remote: string;
  readonly fromMe: boolean;
  readonly id: string;
};
type Ev = MuteSet | MuteRemove | StarRemove;

// The schema table is walked at run time, exactly as decodeIndexArgsFromSchema
// walks WA_APPSTATE_SCHEMAS[key].indexParts.
function decodeIndexArgs(schema: string, parts: readonly string[]): Readonly<Record<string, Slot>> {
  const args: Record<string, Slot> = {};
  if (schema === 'Mute') {
    args['chatJid'] = parts[0]!;
  } else {
    args['remote'] = parts[0]!;
    args['fromMe'] = parts[1] === '1';
    args['id'] = parts[2]!;
  }
  return args;
}

function parseMutation(schema: string, operation: string, parts: readonly string[]): Ev {
  const indexArgs = decodeIndexArgs(schema, parts);
  if (operation === 'set') {
    return { schema, operation: 'set', ...indexArgs, muteEndTs: '1750000000' } as Ev;
  }
  return { schema, operation: 'remove', ...indexArgs } as Ev;
}

function render(e: Ev): string {
  if (e.schema === 'Star') {
    return 'Star ' + e.remote + ' fromMe=' + String(e.fromMe) + ' id=' + e.id + ' op=' + e.operation;
  }
  if (e.operation === 'set') {
    return 'Mute/set ' + e.chatJid + ' until=' + e.muteEndTs;
  }
  return 'Mute/remove ' + e.chatJid;
}

const cases: readonly (readonly [string, string, readonly string[]])[] = [
  ['Mute', 'remove', ['120363111@g.us']],
  ['Mute', 'set', ['120363222@g.us']],
  ['Star', 'remove', ['5511999@s.whatsapp.net', '1', '3EB0AAAA']],
  ['Star', 'remove', ['5511888@s.whatsapp.net', '0', '3EB0BBBB']],
];

for (const c of cases) {
  const e = parseMutation(c[0], c[1], c[2]);
  console.log(c[0] + '/' + c[1] + ' -> ' + render(e) + ' json=' + JSON.stringify(e));
}

// The arm survives every container the event travels through.
const feed: Ev[] = cases.map((c) => parseMutation(c[0], c[1], c[2]));
console.log('feed ' + feed.map(render).join(' ; '));
console.log('feed json ' + JSON.stringify(feed));

const envelope: { readonly at: number; readonly event: Ev } = {
  at: 7,
  event: parseMutation('Star', 'remove', ['5511777@s.whatsapp.net', '1', '3EB0CCCC']),
};
console.log('envelope at=' + String(envelope.at) + ' ' + render(envelope.event));

// ...and the same value, routed through an explicit `unknown` local, is the
// spelling that always worked. The two must now agree byte for byte.
const bag = parseMutation('Mute', 'remove', ['120363333@g.us']);
const viaUnknown: unknown = bag;
console.log('collapsed ' + render(bag) + ' | explicit ' + render(viaUnknown as Ev));

// A member that is not merely a subset of the slot keeps the literal on the
// hybrid path it already had: `count: number` is no arm of `string | boolean
// | null`, so this literal declines the recovery and refuses at compile time
// — which is why it is not written here. What IS written is the boundary the
// fold does take: a `null` index value riding the same slot.
function withNullable(): Readonly<Record<string, Slot>> {
  const o: Record<string, Slot> = {};
  o['remote'] = '5511666@s.whatsapp.net';
  o['fromMe'] = false;
  o['id'] = '3EB0DDDD';
  return o;
}
const nulled = { schema: 'Star', operation: 'remove', ...withNullable() } as Ev;
console.log('nulled ' + render(nulled) + ' json=' + JSON.stringify(nulled));
