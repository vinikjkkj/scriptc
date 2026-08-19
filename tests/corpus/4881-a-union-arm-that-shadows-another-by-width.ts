// The checked-dynamic extraction into a UNION picks an arm by trying each
// arm's match predicate in turn, first hit wins. Both emitters carried the
// note "arms in CANONICAL order ... discriminated unions disambiguate
// naturally: the arm whose declared fields all fit". They do not.
//
// A record match is WIDTH-TOLERANT by construction — dynMatch examines the
// arm's declared fields and ignores every other key — so an arm whose field
// set is a SUBSET of another arm's matches every value of the bigger arm as
// well, and canonical (type-key) order decided which one won.
//
// Measured on base, `pin` below:
//
//   Node      {"schema":"Pin","chatJid":"5522@s.whatsapp.net","pinned":false}
//   compiled  {"schema":"Pin","chatJid":"5522@s.whatsapp.net"}
//
// exit 0 both ways. The value was tagged `Mute` — the narrower arm, which
// sorts first — so `pinned` had nowhere to live and vanished; a later
// `ev.schema === 'Pin'` narrowing then threw the stranded-arm TypeError
// instead of reading it. A silent wrong answer, and its loud twin.
//
// The arms are now tried by DESCENDING declared-field count, so a strict
// superset is always tried before its subsets and a value that genuinely
// lacks the wider arm's fields still falls through to the narrower one.
// This file is the pair in both directions, plus the shapes that must NOT
// move: ties, non-record arms, and an index-signature arm (which matches any
// object and therefore has to come last among the records it could swallow).

type Mute = { readonly schema: 'Mute'; readonly chatJid: string };
type Pin = { readonly schema: 'Pin'; readonly chatJid: string; readonly pinned: boolean };
type Ev = Mute | Pin;

function bag(kind: string): unknown {
  const o: Record<string, unknown> = {};
  o['schema'] = kind;
  o['chatJid'] = '5522@s.whatsapp.net';
  if (kind === 'Pin') o['pinned'] = false;
  return o;
}

const pin = bag('Pin') as Ev;
console.log('pin json ' + JSON.stringify(pin));
console.log('pin schema ' + pin.schema);
if (pin.schema === 'Pin') console.log('pin pinned ' + String(pin.pinned));
else console.log('pin MISTAGGED');

// The narrower value must still find the narrower arm: it lacks `pinned`, so
// the wider arm's match fails and the chain falls through.
const mute = bag('Mute') as Ev;
console.log('mute json ' + JSON.stringify(mute));
if (mute.schema === 'Mute') console.log('mute chatJid ' + mute.chatJid);
else console.log('mute MISTAGGED');

// THREE arms in a chain of subsets, so the ordering has to be a real sort and
// not a swap of two.
type L1 = { readonly a: string };
type L2 = { readonly a: string; readonly b: string };
type L3 = { readonly a: string; readonly b: string; readonly c: string };
type Ladder = L1 | L2 | L3;

function rung(n: number): unknown {
  const o: Record<string, string> = {};
  o['a'] = 'A';
  if (n >= 2) o['b'] = 'B';
  if (n >= 3) o['c'] = 'C';
  return o;
}
for (const n of [1, 2, 3]) {
  const v = rung(n) as Ladder;
  console.log('ladder' + String(n) + ' ' + JSON.stringify(v));
}

// Arms of OTHER kinds keep their places — they match disjoint dyn kinds, so
// no record arm can take a string's or a number's match, and no reordering of
// the records can reach them.
type Mixed = string | number | null | L1 | L2;
function mixed(which: string): unknown {
  if (which === 's') return 'str';
  if (which === 'n') return 4;
  if (which === 'z') return null;
  return rung(2);
}
for (const w of ['s', 'n', 'z', 'r']) {
  console.log('mixed ' + w + ' ' + JSON.stringify(mixed(w) as Mixed));
}

// An INDEX-SIGNATURE arm declares no fields at all, so it matches every
// object; widest-first puts it behind the arms it would otherwise swallow.
type Named = { readonly kind: string; readonly value: string };
type Loose = Readonly<Record<string, string>>;
type Either = Named | Loose;
function either(named: boolean): unknown {
  const o: Record<string, string> = {};
  if (named) {
    o['kind'] = 'K';
    o['value'] = 'V';
  } else {
    o['other'] = 'O';
  }
  return o;
}
console.log('either named ' + JSON.stringify(either(true) as Either));
console.log('either loose ' + JSON.stringify(either(false) as Either));

// Ties keep canonical order, so the choice stays deterministic: two arms of
// the same width are separated by their field TYPES, which dynMatch checks.
type TieS = { readonly one: string; readonly two: string };
type TieN = { readonly one: number; readonly two: number };
type Tie = TieS | TieN;
function tie(str: boolean): unknown {
  const o: Record<string, unknown> = {};
  o['one'] = str ? 'x' : 1;
  o['two'] = str ? 'y' : 2;
  return o;
}
console.log('tie s ' + JSON.stringify(tie(true) as Tie));
console.log('tie n ' + JSON.stringify(tie(false) as Tie));
