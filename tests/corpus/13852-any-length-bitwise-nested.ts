// Bitwise compound operators on an any-typed array length through a nested member. `&=` can
// shrink (5 & 2 is 0), `|=` 0 is the identity, and the result is the Uint32 of the combine.
const h: any = { list: [1, 2, 3, 4, 5] };
h.list.length |= 0;
console.log(h.list.length, JSON.stringify(h.list));
h.list.length &= 6;
console.log(h.list.length, JSON.stringify(h.list));
const g: any = { list: [7, 8, 9] };
g.list.length ^= 0;
console.log(g.list.length, JSON.stringify(g.list));
g.list.length >>>= 0;
console.log(g.list.length, JSON.stringify(g.list));
