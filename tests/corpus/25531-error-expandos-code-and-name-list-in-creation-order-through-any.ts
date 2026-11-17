// `name`, `code` and expandos assigned through an `any` interleave in the order they were CREATED, and removing one keeps the rest in place.
class Tagged extends Error {
  public g = 2;
  public h = 3;
}
class Named extends Error {
  public f = 1;
  public constructor(m: string) { super(m); this.name = 'Named'; }
}
function keys(x: any): string { return Object.keys(x).join(','); }
function ent(x: any): string { return JSON.stringify(Object.entries(x)); }
const a = new Named('m') as any;
a.z = 1;
console.log(keys(a), ent(a));
const a2 = new Named('m') as any;
a2.q = 1; a2.name = 'Renamed'; a2.r = 2;
console.log(keys(a2), ent(a2));
const b = new Tagged('m') as any;
b.k = 1; b.name = 'B'; b.j = 2; b.code = 'E1'; b.l = 3;
console.log(keys(b), ent(b));
delete b.k;
console.log(keys(b), ent(b));
delete b.j;
console.log(keys(b), ent(b));
