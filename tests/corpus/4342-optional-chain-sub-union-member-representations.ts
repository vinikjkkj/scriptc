// The companion to 4341: `a?.b` over a SUB-UNION where the member's
// REPRESENTATION differs from arm to arm — a function on one arm and a string
// on another, a record on one and a string on another, a boxed number and a
// string. The chain binds the receiver box and the body reads the member the
// way any union receiver is read, so what the member's arms are is the union
// field read's business, not the chain's; these cases exist to pin that the
// answers are still Node's, identity included.
//
// Every expectation is Node's, enumerated from the language: which arm is
// present, `typeof` over the result, calling a function member read through the
// chain, and reference identity of a function and of a record read through it.

interface FnStr { t: 'fn'; m: () => string }
interface PlainStr { t: 'str'; m: string }

function readMember(x: FnStr | PlainStr | null | undefined): string {
  const v = x?.m;
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return 'fn:' + v();
  return 'str:' + v;
}
const named = () => 'called';
console.log('member:', readMember(null), readMember(undefined),
  readMember({ t: 'str', m: 'hello' }), readMember({ t: 'fn', m: named }));

// identity of a FUNCTION member read through the chain
const holdFn: FnStr | PlainStr | null = { t: 'fn', m: named };
console.log('fn-identity:', holdFn?.m === named);

// a RECORD on one arm, a string on the other
interface RecArm { t: 'rec'; m: { s: string } }
interface StrArm { t: 'str2'; m: string }
function readRec(x: RecArm | StrArm | null): string {
  const v = x?.m;
  if (v === undefined) return 'undefined';
  return typeof v === 'string' ? 'str:' + v : 'rec:' + v.s;
}
const innerRec = { s: 'R' };
console.log('rec:', readRec(null), readRec({ t: 'rec', m: innerRec }), readRec({ t: 'str2', m: 'S' }));

// identity of a RECORD member read through the chain
const holdRec: RecArm | StrArm | null = { t: 'rec', m: innerRec };
console.log('rec-identity:', holdRec?.m === innerRec);

// three arms, three representations: number, string, boolean
interface NArm { t: 'n'; m: number }
interface SArm { t: 's'; m: string }
interface BArm { t: 'b'; m: boolean }
function three(x: NArm | SArm | BArm | null | undefined): string {
  const v = x?.m;
  return typeof v + '/' + String(v);
}
console.log('three:', three(null), three(undefined), three({ t: 'n', m: 0 }),
  three({ t: 's', m: '' }), three({ t: 'b', m: false }));

// an OPTIONAL member that is absent on the arm actually held
interface OA { t: 'oa'; m?: string }
interface OB { t: 'ob'; m?: string }
function optional(x: OA | OB | null): string {
  return String(x?.m);
}
console.log('optional:', optional(null), optional({ t: 'oa' }), optional({ t: 'ob', m: 'present' }));

// CONTROL: the same members read WITHOUT the guard, off a proven receiver
const proven: FnStr = { t: 'fn', m: named };
console.log('control:', typeof proven.m, proven.m(), proven.m === named);
