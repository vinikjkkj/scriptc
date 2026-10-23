class Q { constructor() { this._list = [1, 2, 3, 4, 5, 6, 7, 8]; } shrink() { this._list.length >>>= 1; return this._list; } }
const q = new Q();
console.log(q.shrink().length); console.log(q.shrink().length); console.log(q.shrink().length); console.log(q.shrink().length); console.log(q.shrink().length);
const s = ['a', 'b', 'c', 'd', 'e'];
s.length >>>= 2;
console.log(s, s.length);
const z = [];
z.length >>>= 3;
console.log(z, z.length);
let k = [9, 8, 7];
console.log((k.length >>>= 1), k);
