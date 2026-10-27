// Typed number[] length compounds (the provenShrink arms) keep their lowering: shrinks through
// a field and a plain name, and the element values below the new length.
class Q {
  _list: number[] = [9, 8, 7, 6, 5, 4];
  shrink(): number {
    this._list.length >>>= 1;
    return this._list.length;
  }
}
const q = new Q();
console.log(q.shrink(), q._list.join(","));
const a: number[] = [1, 2, 3, 4];
a.length -= 1;
a.length--;
console.log(a.length, a.join(","));
