'use strict'
class PG {
  v: number
  constructor(v: number) { this.v = v }
}
const pg = new PG(3);
Object.defineProperty(pg, 'native', {
  configurable: true,
  enumerable: false,
  get() {
    let native: any = null;
    native = new PG(9);
    Object.defineProperty(pg, 'native', { value: native });
    return native;
  },
});
console.log(pg);
console.log((pg as any).native.v);
