// A prototype method is a function value: call, apply and bind take the receiver explicitly; a subclass override is a different function.
class Counter {
  step = 2;
  total = 0;
  add(n: number): number { this.total += n * this.step; return this.total; }
  label(prefix: string, suffix: string): string { return prefix + this.total + suffix; }
}
class Fast extends Counter { step = 10; }
class Named extends Counter { label(prefix: string, suffix: string): string { return "named:" + super.label(prefix, suffix); } }
const c = new Counter(), f = new Fast();
console.log(Counter.prototype.add.call(c, 5), Counter.prototype.add.call(f, 5), c.total, f.total);
console.log(Counter.prototype.label.apply(c, ["<", ">"]), Counter.prototype.label.call(f, "[", "]"));
const bound = Counter.prototype.add.bind(new Counter());
console.log(bound(1), bound(2));
console.log(Fast.prototype.add === Counter.prototype.add, Named.prototype.label === Counter.prototype.label, typeof Counter.prototype.add);
console.log(Named.prototype.label.call(new Named(), "(", ")"));
