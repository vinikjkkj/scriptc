// Every arithmetic and bitwise compound operator on a dyn receiver that is a field
// chain (this.box.inner.count, an any-typed field reached through a class field).
// Each statement reads, combines and stores once; the lines are Node's output.
// Every arithmetic and bitwise compound operator on a dyn receiver that is a
// field chain (`this.box.inner.count`), each evaluated once per statement.
class Box { inner: any; constructor(inner: any) { this.inner = inner; } }

class Holder {
  box: any;
  constructor(box: any) { this.box = box; }
  bump(d: number): void {
    this.box.inner.count += d;
    this.box.inner.count *= 3;
    this.box.inner.count -= 1;
    this.box.inner.count **= 2;
    this.box.inner.count <<= 1;
    this.box.inner.count >>>= 1;
    this.box.inner.count &= 0xff;
    this.box.inner.count |= 256;
    this.box.inner.count ^= 1;
    this.box.inner.count %= 1000;
    this.box.inner.count /= 2;
    console.log(this.box.inner.count);
  }
  text(c: string): void {
    this.box.inner.label += c;
    this.box.inner.label += "-";
    console.log(this.box.inner.label);
  }
}

const h = new Holder(new Box({ inner: { count: 4, label: "L" } }));
h.bump(3);
h.text("x");
