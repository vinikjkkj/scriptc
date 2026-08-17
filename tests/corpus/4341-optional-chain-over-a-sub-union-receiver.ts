// `a?.b` where what survives the nullish guard is a SUB-UNION — more than one
// non-unit arm — rather than the single arm the chain used to demand.
//
// `lowerOptionalChain` bound the chain receiver by PEEKING one payload out of
// the union box, so it required exactly one non-unit arm and fenced otherwise
// with `SC1090 '?.' on '<union>' (the guarded receiver is a sub-union; check a
// discriminant field first)`. The guard proves one thing and one thing only —
// "not nullish" — so with several record arms behind it the honest bind is the
// RECEIVER BOX itself, tag intact; the body then reads the member the way any
// union-typed receiver is read, re-tagging into the checker's non-nullable
// sub-union through the same helper a control-flow narrowing uses.
//
// Every expectation below is what Node answers, enumerated from the language:
// a null receiver, an undefined receiver, an absent optional member, a member
// declared with DIFFERENT types on different arms, the receiver evaluated
// exactly once and not at all when nullish, identity through the chain, and
// `?.` composed with `??` and with a condition. Single-arm receivers and
// non-nullish receivers are carried as controls, since they take the paths
// that already worked.

interface Img { tag: 'img'; viewOnce?: boolean | null; note?: string; w?: number }
interface Vid { tag: 'vid'; viewOnce?: boolean | null; note?: string; secs?: number }
interface Aud { tag: 'aud'; viewOnce?: boolean | null; note?: string }
type Media = Img | Vid | Aud

// --- the row: an optional member over three record arms ---------------------
function viewOnceOf(x: Media | null | undefined): boolean | null | undefined {
  return x?.viewOnce;
}
console.log('null:', viewOnceOf(null));
console.log('undefined:', viewOnceOf(undefined));
console.log('img-true:', viewOnceOf({ tag: 'img', viewOnce: true }));
console.log('vid-false:', viewOnceOf({ tag: 'vid', viewOnce: false }));
console.log('aud-null:', viewOnceOf({ tag: 'aud', viewOnce: null }));
console.log('absent:', viewOnceOf({ tag: 'vid' }));

// --- null and undefined are DISTINGUISHED on the way out ---------------------
function classify(x: Media | null | undefined): string {
  const v = x?.viewOnce;
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  return v ? 'true' : 'false';
}
console.log('classify:', classify(null), classify(undefined), classify({ tag: 'img' }),
  classify({ tag: 'img', viewOnce: null }), classify({ tag: 'img', viewOnce: false }));

// --- the shared DISCRIMINANT read, a same-typed member on every arm ----------
function tagOf(x: Media | null): string | undefined {
  return x?.tag;
}
console.log('tag:', tagOf(null), tagOf({ tag: 'img' }), tagOf({ tag: 'vid' }), tagOf({ tag: 'aud' }));

// --- a member declared with a DIFFERENT type on each arm ---------------------
interface StrCell { k: 'str'; v: string }
interface NumCell { k: 'num'; v: number }
interface BoolCell { k: 'bool'; v: boolean }
function cellValue(c: StrCell | NumCell | BoolCell | null | undefined): string {
  return String(c?.v);
}
console.log('cell:', cellValue(null), cellValue(undefined), cellValue({ k: 'str', v: 's' }),
  cellValue({ k: 'num', v: 42 }), cellValue({ k: 'bool', v: false }));

// --- only a null arm, and only an undefined arm ------------------------------
function nullOnly(x: Media | null): string | undefined { return x?.note; }
function undefOnly(x: Media | undefined): string | undefined { return x?.note; }
console.log('null-only:', nullOnly(null), nullOnly({ tag: 'img', note: 'n1' }));
console.log('undef-only:', undefOnly(undefined), undefOnly({ tag: 'aud', note: 'n2' }));

// --- the receiver is evaluated ONCE, and not at all when nullish -------------
let evals = 0;
function probe(x: Media | null): Media | null {
  evals++;
  return x;
}
console.log('once:', probe(null)?.viewOnce, probe({ tag: 'img', viewOnce: true })?.viewOnce);
console.log('evals:', evals);

// --- and the MEMBER side is never touched on the nullish path ----------------
// (a nullish receiver returns before any read; the counter proves it)
let reads = 0;
function counted(x: Media | null | undefined): boolean | null | undefined {
  if (x !== null && x !== undefined) reads++;
  return x?.viewOnce;
}
console.log('counted:', counted(null), counted(undefined), counted({ tag: 'vid', viewOnce: true }));
console.log('reads:', reads);

// --- identity survives the chain ---------------------------------------------
interface HoldA { h: 'a'; inner: { s: string } }
interface HoldB { h: 'b'; inner: { s: string } }
const shared = { s: 'same' };
const holderA: HoldA | HoldB | null = { h: 'a', inner: shared };
console.log('identity:', holderA?.inner === shared, holderA?.inner.s);

// --- composed with ?? and with a condition ------------------------------------
function describe(x: Media | null | undefined): string {
  if (x?.viewOnce) return 'view-once';
  return x?.note ?? 'plain';
}
console.log('describe:', describe(null), describe({ tag: 'img', viewOnce: true }),
  describe({ tag: 'vid', note: 'n' }), describe({ tag: 'aud' }));

// --- the zapo shape: `.some` over a key list, each read chained ---------------
interface Msg {
  imageMessage?: Img | null;
  videoMessage?: Vid | null;
  audioMessage?: Aud | null;
  conversation?: string | null;
}
function anyViewOnce(m: Msg): boolean {
  return m.imageMessage?.viewOnce === true || m.videoMessage?.viewOnce === true ||
    m.audioMessage?.viewOnce === true;
}
console.log('any:', anyViewOnce({ videoMessage: { tag: 'vid', viewOnce: true } }),
  anyViewOnce({ imageMessage: { tag: 'img' } }), anyViewOnce({ conversation: 'hi' }),
  anyViewOnce({}));

// --- FOUR arms ----------------------------------------------------------------
interface Doc { tag: 'doc'; viewOnce?: boolean | null; note?: string }
function four(x: Img | Vid | Aud | Doc | null | undefined): boolean | null | undefined {
  return x?.viewOnce;
}
console.log('four:', four(null), four({ tag: 'doc', viewOnce: true }), four({ tag: 'img' }));

// --- CONTROL: ONE non-unit arm keeps the peeked-payload bind ------------------
function oneArm(x: Img | null | undefined): boolean | null | undefined {
  return x?.viewOnce;
}
console.log('one-arm:', oneArm(null), oneArm(undefined), oneArm({ tag: 'img', viewOnce: true }));

// --- CONTROL: a receiver the checker proves non-nullish — `?.` IS `.` ---------
const plain: Media = { tag: 'aud', viewOnce: true };
console.log('non-nullish:', plain?.viewOnce, plain?.tag);

// --- CONTROL: the plain (unguarded) read of the same sub-union ----------------
function plainRead(x: Media): boolean | null | undefined {
  return x.viewOnce;
}
console.log('plain:', plainRead({ tag: 'img', viewOnce: false }), plainRead({ tag: 'vid' }));
