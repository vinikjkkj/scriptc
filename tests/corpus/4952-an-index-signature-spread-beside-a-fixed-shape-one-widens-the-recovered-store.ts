// zapo's `parseAppStateMutationEvent` AS IT IS WRITTEN, `src/client/events/
// appstate-mutation.ts:40` and `:49` — the whole row, not a reduction of it:
//
//     const base = { source, collection, version, timestamp, _raw } as const
//     return {
//         schema: resolved.key,
//         operation: 'remove',
//         ...indexArgs,     // Readonly<Record<string, string | boolean | null>>
//         ...base           // a FIXED shape, no index signature at all
//     } as WaAppStateMutationEvent
//
// Four things stood between that line and a compiled program, and three of
// them fell before this file existed: the union wall (a runtime-keyed record
// asserted into a union of exact arms), the subset rule (a `schema: string`
// member riding a `string | boolean | null` slot), and the arm order (widest
// first, so a subset arm stops shadowing its superset).
//
// The two that this file pins:
//
//   1. THE STORE'S VALUE TYPE. The recovery demanded that every spread source
//      publish an index signature and that every declared member be an arm of
//      the one slot they agree on. `base` publishes nothing and `version` is a
//      number, so the recovery refused outright and the literal fenced at
//      `...indexArgs`. But "refuse" was never the only alternative to "claim a
//      slot one source cannot fill": a store whose value type holds EVERY
//      contributor does exist, and the checked-dynamic one is it. The literal
//      now folds into `{ [key: string]: unknown }`, which is insertion-ordered
//      — so the key order below is JS's, spreads and all.
//
//   2. THE ARM. Per schema key the destination pairs a `set` arm and a
//      `remove` arm whose fields are the set arm's minus an ALL-OPTIONAL
//      block, so a remove value fits the set arm too and the wider one is
//      tried first. Nothing structural tells them apart; the VALUE of the
//      `operation` string literal does, and the IR carries it now
//      (IrUnionDef.armLits). Without it the extraction declined the shape
//      rather than emit a value tagged `set` whose `operation` reads
//      `remove` — a wrong answer wearing a fence's clothes.
//
// On base every line here is a compile-time refusal (SC1090 at `...indexArgs`,
// twice).

type Slot = string | boolean | null;

type MuteSet = {
  readonly schema: 'Mute';
  readonly operation: 'set';
  readonly chatJid: string;
  readonly source: string;
  readonly version: number;
  readonly muteEndTs?: string;
};
type MuteRemove = {
  readonly schema: 'Mute';
  readonly operation: 'remove';
  readonly chatJid: string;
  readonly source: string;
  readonly version: number;
};
type StarSet = {
  readonly schema: 'Star';
  readonly operation: 'set';
  readonly remote: string;
  readonly fromMe: boolean;
  readonly id: string;
  readonly source: string;
  readonly version: number;
  readonly starred?: boolean;
};
type StarRemove = {
  readonly schema: 'Star';
  readonly operation: 'remove';
  readonly remote: string;
  readonly fromMe: boolean;
  readonly id: string;
  readonly source: string;
  readonly version: number;
};
type Ev = MuteSet | MuteRemove | StarSet | StarRemove;

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

function parseMutation(schema: string, operation: string, version: number, parts: readonly string[]): Ev {
  const indexArgs = decodeIndexArgs(schema, parts);
  const base = { source: 'sync', version } as const;
  if (operation === 'remove') {
    return { schema, operation: 'remove', ...indexArgs, ...base } as Ev;
  }
  return { schema, operation: 'set', ...indexArgs, ...base } as Ev;
}

function render(e: Ev): string {
  const tail = ' src=' + e.source + ' v=' + String(e.version);
  if (e.schema === 'Star') {
    if (e.operation === 'remove') {
      return 'Star/remove ' + e.remote + ' fromMe=' + String(e.fromMe) + ' id=' + e.id + tail;
    }
    return 'Star/set ' + e.remote + ' starred=' + String(e.starred) + tail;
  }
  if (e.operation === 'remove') return 'Mute/remove ' + e.chatJid + tail;
  return 'Mute/set ' + e.chatJid + ' until=' + String(e.muteEndTs) + tail;
}

const cases: readonly (readonly [string, string, number, readonly string[]])[] = [
  ['Mute', 'remove', 3, ['120363111@g.us']],
  ['Mute', 'set', 4, ['120363222@g.us']],
  ['Star', 'remove', 5, ['5511999@s.whatsapp.net', '1', '3EB0AAAA']],
  ['Star', 'set', 6, ['5511888@s.whatsapp.net', '0', '3EB0BBBB']],
];

for (const c of cases) {
  const e = parseMutation(c[0], c[1], c[2], c[3]);
  console.log(c[0] + '/' + c[1] + ' op=' + e.operation + ' -> ' + render(e));
}

const feed: Ev[] = cases.map((c) => parseMutation(c[0], c[1], c[2], c[3]));
console.log('feed ' + feed.map(render).join(' ; '));
console.log('ops ' + feed.map((e) => e.operation).join(','));

// The WIDENED store is insertion-ordered, so the literal itself enumerates
// exactly as JS does — named members, then the keyed spread's keys in their
// own order, then the fixed spread's. Printed BEFORE any assertion, because
// a value extracted into a static arm enumerates in the ARM's declared order
// instead (the project's recorded key-order debt, unrelated to this file).
function bagOf(schema: string, parts: readonly string[]): Readonly<Record<string, unknown>> {
  const indexArgs = decodeIndexArgs(schema, parts);
  const base = { source: 'sync', version: 9 } as const;
  return { schema, operation: 'remove', ...indexArgs, ...base };
}
const bag = bagOf('Star', ['5511777@s.whatsapp.net', '1', '3EB0CCCC']);
console.log('literal ' + JSON.stringify(bag));
console.log('literal keys ' + Object.keys(bag).join('|'));
