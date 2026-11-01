// RangeError & { tag: string } built and written in one block, then printed through each view.
const q = new RangeError('r') as RangeError & { tag: string };
q.tag = 'T';
console.log(q.name, q.message, q.tag, typeof q.stack);
const asError: Error = q;
console.log(asError.name, asError.message);
