// A union whose arms are separated by a STRING-LITERAL DISCRIMINANT and
// whose widest arm would otherwise swallow the narrow ones — zapo's own
// stanza shape, in miniature.
//
// The arm chain used to spell the test as `matcher(d) && literal(d)`: the
// whole subtree was walked FIRST and the one-byte discriminant checked
// afterwards. Merged, the walk is the build, so the order is reversed —
// the literal predicate decides first and an arm whose discriminant
// contradicts the value is never walked at all. Both spellings answer the
// same arm; this program is here so that "the same arm" is a thing a run
// checks rather than a thing the emitter comment claims.
//
// The two passes are still two: pass 1 requires the literals, pass 2 is
// the plain chain, so a value that contradicts EVERY arm's literals still
// lands where the widest fitting arm puts it.

type SetOp = { op: "set"; key: string; value: string; ttl: number };
type RemoveOp = { op: "remove"; key: string; value: string };
type TouchOp = { op: "touch"; key: string };
type AnyOp = SetOp | RemoveOp | TouchOp;

function describe(raw: string): string {
  const o = JSON.parse(raw) as AnyOp;
  if (o.op === "set") return "set " + o.key + "=" + o.value + " ttl" + o.ttl;
  if (o.op === "remove") return "remove " + o.key + " was " + o.value;
  return "touch " + o.key;
}

// `remove` carries every field `set` needs except ttl, and `touch` is a
// SUBSET of both, so field-width alone would take the wrong arm for two
// of the three.
console.log(describe('{"op":"set","key":"a","value":"1","ttl":30}'));
console.log(describe('{"op":"remove","key":"b","value":"2"}'));
console.log(describe('{"op":"touch","key":"c"}'));

// A `remove` value that ALSO carries a ttl: structurally it is a `set`,
// and only the discriminant separates them.
console.log(describe('{"op":"remove","key":"d","value":"4","ttl":99}'));

// Extra keys nobody declared: width tolerance, unchanged.
console.log(describe('{"op":"touch","key":"e","extra":true,"more":[1,2]}'));

// A discriminant value NO arm pins: pass 1 finds nothing, pass 2 runs the
// plain chain and the widest fitting arm takes it. Node reads the fields
// straight off the object, so the two agree on every branch below.
const odd = '{"op":"other","key":"f","value":"6","ttl":1}';
const o = JSON.parse(odd) as AnyOp;
console.log("fell-through", o.key, o.op);

// Arms tried many times over, so an arm attempt that failed to release
// its partial build would show up as growth rather than as a wrong
// answer.
let n = 0;
for (let i = 0; i < 150; i++) {
  n += describe('{"op":"remove","key":"z","value":"9"}').length;
  n += describe('{"op":"set","key":"z","value":"9","ttl":1}').length;
}
console.log("n", n);
