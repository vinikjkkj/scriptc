// `new Error()` has no own message, so assigning one creates an enumerable own property; a constructed message is non-enumerable.
class Late extends Error {
  public constructor() { super(); this.message = 'late'; }
}
class Given extends Error {
  public n = 1;
  public constructor(m: string) { super(m); this.message = 'again'; }
}
function keys(x: any): string { return Object.keys(x).join(','); }
const a = new Late() as any;
a.x = 1;
console.log(keys(a), JSON.stringify(Object.entries(a)));
const b = new Given('first') as any;
b.p = 1;
b.message = 'new';
b.q = 2;
console.log(keys(b), JSON.stringify(Object.entries(b)));
const c = new Error() as any;
c.k = 1;
c.message = 'x';
c.j = 2;
console.log(keys(c), JSON.stringify(Object.entries(c)));
