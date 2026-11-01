// RangeError & { tag: string } built in a function and printed through each view.
function h(): Error & { tag: string } {
  const e = new RangeError('r') as RangeError & { tag: string };
  e.tag = 'T';
  return e;
}
const q = h();
console.log(q.name, q.message, q.tag, typeof q.stack);
const asError: Error = q;
console.log(asError.name, asError.message);
