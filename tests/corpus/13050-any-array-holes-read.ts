// new Array(n) of any: holes read as undefined, writes land, length is n.
function make(n: number): any[] {
  return new Array(n);
}

const a = make(3);
console.log(a.length);
console.log(String(a[0]), String(a[2]), a[1] === undefined);
a[1] = 7;
a[2] = "x";
console.log(String(a[1]), String(a[2]), a.length);
const k: unknown = a[1];
console.log(typeof k, typeof a[2], typeof a[0]);
