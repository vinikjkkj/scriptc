// a[i] op= e where the receiver is an ACCESSOR link (h.viaGetter[1] += 10). The getter
// runs exactly once per statement, as JavaScript does (the receiver is pinned into a
// hidden local); a getter that returns a persistent array is written through in
// place, and the setter is not called for an element write. The calls counter is
// the load-bearing line; Node is the oracle.
// Accessor receivers counted: a getter that returns a PERSISTENT array, a getter
// that returns a FRESH array, and a setter-backed receiver field.
class Holder {
  calls = 0;
  store: number[] = [1, 2, 3];
  fresh = 0;
  get viaGetter(): number[] {
    this.calls += 1;
    this.fresh += 1;
    return [1, 2, 3];
  }
  get shared(): number[] {
    this.calls += 1;
    return this.store;
  }
  set shared(v: number[]) {
    this.calls += 100;
    this.store = v;
  }
}
const h = new Holder();
h.viaGetter[1] += 10;
console.log('fresh calls=' + String(h.calls) + ' fresh=' + String(h.fresh));
h.shared[1] += 10;
console.log('shared calls=' + String(h.calls) + ' store=' + h.store.join(','));
h.shared[2] *= 5;
console.log('shared calls=' + String(h.calls) + ' store=' + h.store.join(','));
