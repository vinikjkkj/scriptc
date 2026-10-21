// Compound assignment and increments over static fields and static
// accessors (the shape `static count++` and option setters use).
class Counter {
  static n = 0;
  static total = 10;
  static _w = 1;
  static get width() {
    return Counter._w;
  }
  static set width(v) {
    Counter._w = v;
  }
}
Counter.n++;
++Counter.n;
Counter.n += 5;
Counter.total -= 3;
Counter.total *= 2;
const old = Counter.n++;
const next = ++Counter.n;
console.log(Counter.n, Counter.total, old, next);
Counter.width += 4;
Counter.width++;
console.log(Counter.width, Counter._w);
