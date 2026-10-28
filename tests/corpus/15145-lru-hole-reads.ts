const a: number[] = new Array(2).fill(7);
a.length = 4;
console.log(a.length, a[3] === undefined, a[0], typeof a[3]);
a[1] = 9;
a.fill(5, 2, 3);
console.log(a[0], a[1], a[2], a[3]);
a.length = 1;
console.log(a.length, a[0], a[1] === undefined);
a[5] = 3;
console.log(a.length, a[4] === undefined, a[5]);
let h = a[4];
console.log(h, h === undefined, h + 1, typeof h, h ?? -1);
a.fill(2);
console.log(a[0], a[5]);

function make(): () => number {
  const next: number[] = new Array(3).fill(0);
  const grow = (n: number): void => {
    next.length = n;
    next.fill(0, 3);
  };
  grow(6);
  next[5] = 4;
  return () => (next[4] === undefined ? -1 : next[5]);
}
console.log(make()());
