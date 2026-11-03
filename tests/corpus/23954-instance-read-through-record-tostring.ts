// The instance's own ToString survives the read through a record type: String(view), a template
// literal and `+` reach the class's toString, and a class without one answers the default.
class Money {
  cents = 250;
  toString(): string {
    return "$" + (this.cents / 100).toFixed(2);
  }
}
class Plain {
  v = 1;
}
interface Amount {
  cents: number;
}
interface P {
  v: number;
}
const a = (new Money() as unknown) as Amount;
console.log(`${a}`, String(a), a + "!", a.cents);
const p = (new Plain() as unknown) as P;
console.log(`${p}`, String(p), p.v);
