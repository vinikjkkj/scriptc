// A declared `code` field is a member row (declaration order); an assigned `code` over none is created where it was assigned.
class Coded extends Error {
  public code = 'X';
  public n = 1;
  public constructor(m: string) { super(m); this.name = 'Coded'; }
}
class Plain extends Error {}
function keys(x: any): string { return Object.keys(x).join(','); }
const a = new Coded('m');
console.log(keys(a), JSON.stringify(Object.entries(a)), JSON.stringify(Object.values(a)));
const b = new Plain('m') as any;
b.name = 'Plain2'; b.code = 'E2'; b.k = 1;
console.log(keys(b), JSON.stringify(Object.entries(b)));
const c = new Plain('m') as any;
c.code = 'E3'; c.name = 'Plain3'; c.k = 1;
console.log(keys(c), JSON.stringify(Object.entries(c)));
