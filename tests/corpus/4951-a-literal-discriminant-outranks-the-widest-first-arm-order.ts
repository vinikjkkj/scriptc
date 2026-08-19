// Two selectors now decide which arm a checked dynamic extraction gives a
// value, and this pins what happens when they disagree.
//
//   * WIDTH. A record match is width-tolerant — it examines the arm's declared
//     fields and ignores every other key — so an arm whose field set is a
//     SUBSET of another's matches every value of the bigger arm too. That is
//     why the arms are tried WIDEST FIRST (dynCheckArmOrder); before that they
//     were tried in canonical order and a subset arm silently shadowed its
//     superset.
//
//   * THE LITERAL DISCRIMINANT. `tag: 'n'` beside `tag: 'w'` is a fact about
//     the VALUE, not about the field set, and the IR now carries it
//     (IrUnionDef.armLits).
//
// They disagree exactly when a value carries the wider arm's fields while
// pinning the narrower arm's literal. The answer is: inside a pass WIDTH
// decides, across the passes the DISCRIMINANT does — a first pass tries every
// arm in width order but skips any arm whose literals the value contradicts,
// and only if nothing matches there does the old width-only chain run.
//
// On base the first case below prints its tag and then throws the stranded-arm
// TypeError, because the value was tagged `Wide` and the `tag === 'n'`
// narrowing had nowhere to land.

type Narrow = { readonly tag: 'n'; readonly a: string };
type Wide = { readonly tag: 'w'; readonly a: string; readonly b: string };
type U = Narrow | Wide;

function bag3(tag: string, a: string, b: string): unknown {
  const o: Record<string, unknown> = {};
  o['tag'] = tag;
  o['a'] = a;
  o['b'] = b;
  return o;
}
function bag2(tag: string, a: string): unknown {
  const o: Record<string, unknown> = {};
  o['tag'] = tag;
  o['a'] = a;
  return o;
}

function render(u: U): string {
  if (u.tag === 'n') return 'narrow a=' + u.a;
  return 'wide a=' + u.a + ' b=' + u.b;
}

// THE DISAGREEMENT. Structurally this fits `Wide` (which is tried first,
// being wider) and it fits `Narrow` too; the literal says `Narrow`.
const disagree = bag3('n', 'A', 'B') as U;
console.log('disagree tag=' + disagree.tag + ' -> ' + render(disagree));

// AGREEMENT, the ordinary case: both selectors say `Wide`.
const agree = bag3('w', 'A', 'B') as U;
console.log('agree tag=' + agree.tag + ' -> ' + render(agree));

// The literal says `Wide` but the value has no `b`, so no arm's literals AND
// structure both hold. The first pass finds nothing and the ordinary
// width-only chain runs exactly as it always did — the value is not a new
// refusal, and the field reads back the string it actually holds.
const contradicts = bag2('w', 'A') as U;
console.log('contradicts tag=' + contradicts.tag);

// A WIDTH TIE the discriminant breaks: same field count, same field types,
// different literal. Canonical order alone would decide this by an accident of
// type-key spelling.
type Left = { readonly kind: 'left'; readonly v: string };
type Right = { readonly kind: 'right'; readonly v: string };
type LR = Left | Right;
function lr(kind: string, v: string): unknown {
  const o: Record<string, unknown> = {};
  o['kind'] = kind;
  o['v'] = v;
  return o;
}
for (const k of ['left', 'right']) {
  const x = lr(k, k.toUpperCase()) as LR;
  console.log('tie ' + (x.kind === 'left' ? 'L:' + x.v : 'R:' + x.v));
}

// Arrays and record fields take the same chain, so the arm has to survive them.
const feed: U[] = [bag3('n', 'A1', 'B1') as U, bag3('w', 'A2', 'B2') as U, bag2('n', 'A3') as U];
console.log('feed ' + feed.map(render).join(' ; '));
const envelope: { readonly at: number; readonly u: U } = { at: 3, u: bag3('n', 'A4', 'B4') as U };
console.log('envelope at=' + String(envelope.at) + ' ' + render(envelope.u));

// The literal VALUE rides into the emitted predicate and into the comment
// beside it, so it has to survive both. `a*/b` would end a C block comment
// early — the rest of the predicate becoming code nobody wrote, which no gate
// in this project catches — and a quote has to make it through the LLVM lane's
// line comment too.
type Starred = { readonly k: 'a*/b'; readonly v: string };
type Quoted = { readonly k: 'c"d'; readonly v: string; readonly w: string };
type Hostile = Starred | Quoted;
function hostile(k: string, v: string, w: string | null): unknown {
  const o: Record<string, unknown> = {};
  o['k'] = k;
  o['v'] = v;
  if (w !== null) o['w'] = w;
  return o;
}
for (const k of ['a*/b', 'c"d']) {
  const h = hostile(k, 'V:' + k, 'W:' + k) as Hostile;
  console.log('hostile ' + (h.k === 'a*/b' ? 'starred v=' + h.v : 'quoted v=' + h.v + ' w=' + h.w));
}

// THE TRADE, stated where it can be read. A value carrying the WIDER arm's
// extra key while pinning the NARROWER arm's literal has no answer that agrees
// with Node in both spellings, because the extraction MATERIALISES one arm and
// Node materialises nothing:
//
//   * the width order tags it `Pin`, so `JSON.stringify` keeps `pinned` and
//     agrees with Node — and the `schema === 'Mute'` narrowing below then
//     throws the stranded-arm TypeError, because the tag says Pin;
//   * the discriminant tags it `Mute`, which is what its own `schema` says, so
//     the narrowing reads — and `pinned` has no slot on that arm, so the copy
//     drops it (divergence 36's stance, the same drop every materialised arm
//     has always had).
//
// The tag is what every later narrowing rests on, so the discriminant wins and
// the drop is the inherited cost. Written here as the READING spelling, which
// is the one a program does: base throws on the last line.
type MuteEv = { readonly schema: 'Mute'; readonly chatJid: string };
type PinEv = { readonly schema: 'Pin'; readonly chatJid: string; readonly pinned: boolean };
type Chat = MuteEv | PinEv;
function chatBag(schema: string, jid: string, pinned: boolean | null): unknown {
  const o: Record<string, unknown> = {};
  o['schema'] = schema;
  o['chatJid'] = jid;
  if (pinned !== null) o['pinned'] = pinned;
  return o;
}
const wideBodyNarrowTag = chatBag('Mute', '5522@s.whatsapp.net', false) as Chat;
console.log('chat schema=' + wideBodyNarrowTag.schema);
if (wideBodyNarrowTag.schema === 'Mute') console.log('chat mute ' + wideBodyNarrowTag.chatJid);
else console.log('chat pin ' + wideBodyNarrowTag.chatJid + ' ' + String(wideBodyNarrowTag.pinned));
const bothAgree = chatBag('Pin', '5511@s.whatsapp.net', true) as Chat;
console.log(bothAgree.schema === 'Pin' ? 'chat pin ' + String(bothAgree.pinned) : 'chat mute');
