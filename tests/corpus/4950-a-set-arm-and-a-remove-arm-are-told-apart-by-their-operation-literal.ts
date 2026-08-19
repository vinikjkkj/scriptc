// zapo's `WaAppStateMutationEvent`, `src/client/events/appstate-mutation.ts:40`
// and `:49`, reduced to the thing that kept them refused after the union wall
// came down. Per schema key the type pairs
//
//     ({ schema: K; operation: 'set'    } & IndexArgs<K> & Partial<Data<K>>)
//   | ({ schema: K; operation: 'remove' } & IndexArgs<K>)
//
// so the remove arm's fields are the set arm's MINUS an ALL-OPTIONAL block. In
// the IR an optional field is `T | undefined` and a MISSING key matches it, so
// a remove value fits the set arm too — and the set arm is wider, so the arm
// chain tried it first and took it. The fields still read right (`op remove`
// printed) and only the TAG was wrong, which surfaced one line later as the
// stranded-arm TypeError on `operation === 'remove'`: a wrong answer wearing a
// fence's clothes.
//
// Nothing structural separates those two arms. What separates them is the
// VALUE of the `operation` string literal, which the IR erased to `string`
// when it mapped the property. It does not any more: a union's def carries the
// literals its arms pin (IrUnionDef.armLits), and the arm chain runs a first
// pass that skips an arm whose literals the value contradicts.
//
// On base every case here is a runtime throw: `runtimeKeyedUnionExtraction`
// declined the whole extraction rather than emit a mis-tagged value
// (`SCRIPTC_RTKEYED_WHY=1` says "arm 1 shadows arm 0"), so the value took
// strandedCoercionTrap's unconditional TypeError.

type Slot = string | boolean;

type MuteSet = {
  readonly schema: 'Mute';
  readonly operation: 'set';
  readonly chatJid: string;
  readonly muteEndTs?: string;
};
type MuteRemove = {
  readonly schema: 'Mute';
  readonly operation: 'remove';
  readonly chatJid: string;
};
type StarSet = {
  readonly schema: 'Star';
  readonly operation: 'set';
  readonly remote: string;
  readonly fromMe: boolean;
  readonly id: string;
  readonly starred?: boolean;
};
type StarRemove = {
  readonly schema: 'Star';
  readonly operation: 'remove';
  readonly remote: string;
  readonly fromMe: boolean;
  readonly id: string;
};
type Ev = MuteSet | MuteRemove | StarSet | StarRemove;

// The schema table is walked at RUN TIME, exactly as
// decodeIndexArgsFromSchema walks WA_APPSTATE_SCHEMAS[key].indexParts — so
// which keys the bag carries is not a static fact.
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

// The assertion is straight off the LITERAL, which is what the real rows do
// (a bag bound to a const is a different, easier shape).
function parseMutation(schema: string, operation: string, parts: readonly string[]): Ev {
  const indexArgs = decodeIndexArgs(schema, parts);
  if (operation === 'set') {
    return { schema, operation: 'set', ...indexArgs } as Ev;
  }
  return { schema, operation: 'remove', ...indexArgs } as Ev;
}

function render(e: Ev): string {
  if (e.schema === 'Star') {
    if (e.operation === 'remove') {
      return 'Star/remove ' + e.remote + ' fromMe=' + String(e.fromMe) + ' id=' + e.id;
    }
    return 'Star/set ' + e.remote + ' starred=' + String(e.starred);
  }
  if (e.operation === 'remove') {
    return 'Mute/remove ' + e.chatJid;
  }
  return 'Mute/set ' + e.chatJid + ' until=' + String(e.muteEndTs);
}

const cases: readonly (readonly [string, string, readonly string[]])[] = [
  ['Mute', 'remove', ['120363111@g.us']],
  ['Mute', 'set', ['120363222@g.us']],
  ['Star', 'remove', ['5511999@s.whatsapp.net', '1', '3EB0AAAA']],
  ['Star', 'set', ['5511888@s.whatsapp.net', '0', '3EB0BBBB']],
];

for (const c of cases) {
  const e = parseMutation(c[0], c[1], c[2]);
  console.log(c[0] + '/' + c[1] + ' op=' + e.operation + ' -> ' + render(e));
}

// The arm survives the containers the event travels through.
const feed: Ev[] = cases.map((c) => parseMutation(c[0], c[1], c[2]));
console.log('feed ' + feed.map(render).join(' ; '));
console.log('ops ' + feed.map((e) => e.operation).join(','));

// ...and the same value routed through an explicit `unknown` local — the
// spelling that has no fence at all, and the one the mis-tagging was measured
// through on base — must agree with the collapsed one byte for byte.
function bagOf(schema: string, operation: string, chatJid: string): unknown {
  const o: Record<string, unknown> = {};
  o['schema'] = schema;
  o['operation'] = operation;
  o['chatJid'] = chatJid;
  return o;
}
const collapsed = parseMutation('Mute', 'remove', ['120363333@g.us']);
const explicit = bagOf('Mute', 'remove', '120363333@g.us') as Ev;
console.log('collapsed ' + render(collapsed) + ' | explicit ' + render(explicit));
console.log('same-op ' + String(collapsed.operation === explicit.operation));

// The OPTIONAL member is what made the two arms overlap; a set value that
// actually carries it still lands on the set arm.
function setBagWith(chatJid: string, until: string): unknown {
  const o: Record<string, unknown> = {};
  o['schema'] = 'Mute';
  o['operation'] = 'set';
  o['chatJid'] = chatJid;
  o['muteEndTs'] = until;
  return o;
}
const withOptional = setBagWith('120363444@g.us', '1750000000') as Ev;
console.log('with-optional ' + render(withOptional));

// A value whose `operation` matches NO arm's literal is not a new refusal: the
// first pass finds nothing, the ordinary structural pass runs exactly as it
// did before, and the field reads back the string the value actually holds.
function oddBag(): unknown {
  const o: Record<string, unknown> = {};
  o['schema'] = 'Mute';
  o['operation'] = 'toggle';
  o['chatJid'] = '120363555@g.us';
  return o;
}
const odd = oddBag() as Ev;
console.log('odd op=' + odd.operation + ' schema=' + odd.schema);
if (odd.schema === 'Mute') console.log('odd chatJid=' + odd.chatJid);
