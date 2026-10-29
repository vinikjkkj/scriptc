// A nested optional object member cast through the outer record: the inner
// absent member reads undefined through the cast.
type Inner = { _id?: { hex: string } };
type Outer = { meta?: Inner };
const o: Outer = { meta: {} };
const m = (o as { meta?: unknown }).meta;
console.log(m === undefined ? 'none' : 'some', (o.meta as Inner)._id === undefined);
const p: Outer = {};
const q = (p as { meta?: unknown }).meta;
console.log(q === undefined ? 'none' : 'some');
