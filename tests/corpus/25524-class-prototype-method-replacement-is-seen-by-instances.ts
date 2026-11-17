// Replacing a method on the prototype changes what instances (and subclass instances without an override) call; the original is still reachable with call before the replacement.
class Base { greet(): string { return "hi " + this.who(); } who(): string { return "base"; } }
class Child extends Base {}
class Own extends Base { greet(): string { return "own"; } }
const b = new Base(), c = new Child(), o = new Own();
console.log(b.greet(), c.greet(), o.greet(), Base.prototype.greet.call(c));
Base.prototype.greet = function (): string { return "patched"; };
console.log(b.greet(), c.greet(), o.greet());
