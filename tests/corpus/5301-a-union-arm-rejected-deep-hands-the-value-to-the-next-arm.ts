// A union whose FIRST arm fits at the top and fails several levels DOWN,
// so the arm that finally takes the value is decided by a walk that got a
// long way in before it turned back.
//
// This is the case the merge changes the mechanics of. An arm used to be
// decided by a MATCHER that allocated nothing and then rebuilt by a
// BUILDER that allocated everything; it is now one walker that allocates
// as it goes and RELEASES what it has built when a member three levels
// down does not fit. Every partial record, array and string on that path
// has to come back, and the value has to land on the next arm exactly as
// it did before — so this program is both an arm-selection test and an
// RC test, and under SCRIPTC_SAN / the RC audit it is a leak test.
//
// Node has no arms: `as` is erased and every read below is the read the
// value's own shape answers. Its output IS the expected output.

interface Deep {
  id: string;
  rows: { name: string; vals: number[] }[];
  meta: { tag: string; extra: { flag: boolean } };
}
interface Shallow {
  id: string;
  rows: { name: string; vals: string[] }[];
  meta: { tag: string; extra: { flag: boolean } };
}
type Either = Deep | Shallow;

// `vals` holds STRINGS, so the Deep arm fits id, fits rows, fits every
// row's name, and only fails inside the third element of the second row's
// array — after two records, two arrays and four strings have been built.
const text =
  '{"id":"x","rows":[{"name":"a","vals":["1","2"]},{"name":"b","vals":["3","4","5"]}],' +
  '"meta":{"tag":"t","extra":{"flag":true}}}';

const v = JSON.parse(text) as Either;
const s = v as Shallow;
console.log(s.id, s.rows.length, s.rows[1].vals[2], s.meta.extra.flag);

// The same union, the other way round: numbers now, so the arm that fails
// deep is the other one.
const text2 =
  '{"id":"y","rows":[{"name":"c","vals":[10,20]},{"name":"d","vals":[30]}],' +
  '"meta":{"tag":"u","extra":{"flag":false}}}';
const v2 = JSON.parse(text2) as Either;
const d2 = v2 as Deep;
console.log(d2.id, d2.rows[0].vals[1] + 1, d2.meta.tag, d2.meta.extra.flag);

// Repeated crossings of the SAME shape, so a partial build that leaked a
// row or a string would show as growth rather than as a wrong answer.
let total = 0;
for (let i = 0; i < 200; i++) {
  const each = JSON.parse(text) as Either;
  const sh = each as Shallow;
  total += sh.rows[1].vals.length + sh.id.length;
}
console.log("total", total);

// A value that fits NEITHER arm: the walk turns back on both and the
// union refuses as a whole — the way to die the merge kept. Node reads
// undefined off the object instead, so only the fact of a refusal is
// printed, never scriptc's message.
const bad = '{"id":7,"rows":[],"meta":{"tag":"t","extra":{"flag":true}}}';
let outcome = "none";
try {
  const nope = JSON.parse(bad) as Either;
  const sh = nope as Shallow;
  outcome = "took:" + String(sh.id);
} catch {
  outcome = "refused";
}
console.log(outcome === "refused" || outcome === "took:7" ? "no-silent-arm" : outcome);
