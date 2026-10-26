// A class instance walked by for-in lists its own fields in creation order
// (initializers run in declaration order), and never its methods.
class P {
  a = 1;
  b = 'x';
  c = [1, 2];
  method() { return this.a; }
  static s = 9;
}
const p = new P();
const ks = [];
for (const k in p) ks.push(k);
console.log(ks.join(','), ks.length);
for (const k in p) console.log(k, typeof k, k.length);
