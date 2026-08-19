// One IR shape, SEVERAL source arms — the shape zapo's appstate union actually
// has, and the one that made a single-valued discriminant not enough.
//
// `{ kind: 'mute'; jid: string }` and `{ kind: 'pin'; jid: string }` are two
// arms in the source and ONE record shape in the IR: string literals map to
// `string`, so both intern to `{ jid: string; kind: string }`. Asking that arm
// which literal it pins has no single answer, and intersecting the two left it
// pinning NOTHING — so it went on stealing the values of the wider arm beside
// it, and the extraction declined the whole union rather than mis-tag them.
//
// Measured on zapo before this: `RTKEYED DECLINES: arm 28 shadows arm 75` —
// arm 28 pinned `operation="set"` and nothing else, arm 75 pinned
// `operation="set" schema="SettingsSync"`, they agreed on the only field they
// shared, and the two appstate rows stayed refused with the spread already
// compiling.
//
// The arm holds ANY of its own keys' values and NONE of its neighbour's, which
// is what a SET says and a single value cannot. `IrUnionDef.armLits` carries
// one per field, the emitted predicate is one length-and-memcmp per member,
// and two arms are separated when their sets are DISJOINT.

type MuteE = { readonly kind: 'mute'; readonly jid: string };
type PinE = { readonly kind: 'pin'; readonly jid: string };
type StarE = { readonly kind: 'star'; readonly jid: string; readonly id: string };
type LabelE = { readonly kind: 'label'; readonly jid: string; readonly id: string };
type Ev = MuteE | PinE | StarE | LabelE;

// Two IR shapes: { jid, kind } for mute/pin, { id, jid, kind } for star/label.
// The narrow one's fields are a subset of the wide one's, so it is tried after
// it and would take every star/label value if nothing told them apart.

function indexArgs(kind: string, jid: string, id: string): Readonly<Record<string, string>> {
  const o: Record<string, string> = {};
  o['jid'] = jid;
  if (kind === 'star' || kind === 'label') o['id'] = id;
  return o;
}

function parse(kind: string, jid: string, id: string): Ev {
  return { kind, ...indexArgs(kind, jid, id) } as Ev;
}

function render(e: Ev): string {
  if (e.kind === 'star') return 'star ' + e.jid + '/' + e.id;
  if (e.kind === 'label') return 'label ' + e.jid + '/' + e.id;
  if (e.kind === 'pin') return 'pin ' + e.jid;
  return 'mute ' + e.jid;
}

const rows: readonly (readonly [string, string, string])[] = [
  ['mute', '120363111@g.us', '-'],
  ['pin', '120363222@g.us', '-'],
  ['star', '5511999@s.whatsapp.net', '3EB0AAAA'],
  ['label', '5511888@s.whatsapp.net', 'L7'],
];
for (const r of rows) {
  const e = parse(r[0], r[1], r[2]);
  console.log(r[0] + ' -> ' + render(e) + ' kind=' + e.kind);
}
console.log('kinds ' + rows.map((r) => parse(r[0], r[1], r[2]).kind).join(','));

// The same values through the spelling with no fence at all.
function bag(kind: string, jid: string, id: string | null): unknown {
  const o: Record<string, unknown> = {};
  o['kind'] = kind;
  o['jid'] = jid;
  if (id !== null) o['id'] = id;
  return o;
}
console.log('explicit ' + render(bag('star', '5511777@s.whatsapp.net', '3EB0BBBB') as Ev));
console.log('explicit ' + render(bag('pin', '120363333@g.us', null) as Ev));

// A value carrying the WIDE arm's extra key while naming a NARROW arm's kind:
// the set says `mute` is not one of star/label, so the narrow arm takes it and
// the narrowing reads. (Base, with no discriminant at all, tags it the wide arm
// and this line throws.)
const wideBodyNarrowKind = bag('mute', '120363444@g.us', 'IGNORED') as Ev;
console.log('mixed kind=' + wideBodyNarrowKind.kind + ' -> ' + render(wideBodyNarrowKind));

// ...and a kind no arm names still falls through to the structural pass, so it
// is not a new refusal.
const odd = bag('archive', '120363555@g.us', null) as Ev;
console.log('odd kind=' + odd.kind + ' jid=' + odd.jid);
