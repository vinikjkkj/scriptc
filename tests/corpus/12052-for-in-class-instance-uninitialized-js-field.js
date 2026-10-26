// A JS class field declared without an initializer is a property (undefined)
// from construction, so it is listed in its declaration position.
class A {
  p;
  q = 2;
  r;
}
const a = new A();
const ks = [];
for (const k in a) ks.push(k);
console.log(ks.join(' '), ks.length);
