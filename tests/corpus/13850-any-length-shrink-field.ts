// The ring buffer's shrink through an untyped field: `this._list.length >>>= 1` where the
// array is an any-typed member (the JS-shaped receiver), and the mask halves beside it.
// A length compound on a receiver that is not a plain name must read once, shrink, and
// leave the elements below the new length in place, exactly as Node does.
class Ring {
  _list: any;
  _mask: number;
  constructor() {
    this._list = [1, 2, 3, 4, 5, 6, 7, 8];
    this._mask = 7;
  }
  _shrink() {
    this._list.length >>>= 1;
    this._mask >>>= 1;
  }
}
const r = new Ring();
r._shrink();
console.log(r._list.length, r._mask, JSON.stringify(r._list));
r._shrink();
console.log(r._list.length, r._mask, JSON.stringify(r._list));
r._shrink();
console.log(r._list.length, r._mask, JSON.stringify(r._list));
