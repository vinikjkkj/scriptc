function make(prefix, n) {
  class C {
    constructor() { this.v = n; }
    async am() { await null; return prefix + n; }
    *gm() { yield prefix; yield n; }
    async *agm() { yield prefix; await null; yield n; }
    async amThis() { await null; return prefix + this.v; }
  }
  return new C();
}
const a = make("p", 1), b = make("q", 2);
const am = a.am, gm = a.gm, agm = a.agm, amThis = a.amThis;
(async () => {
  console.log(await am());
  console.log(await am.call(b));
  const g1 = gm(), g2 = gm.call(b);
  console.log(g1.next().value, g1.next().value, g2.next().value, g2.next().value);
  const ag = agm.call(b);
  console.log((await ag.next()).value, (await ag.next()).value);
  console.log(await amThis.call(b));
  console.log(a.am === a.am, a.am === b.am, a.gm === a.gm);
})();
