// An untyped read of a name that a class AND its subclass both write as prototype data keeps the compile-time refusal: which slot answers depends on the instance.
class Base { constructor() { this.tag = "b"; } }
Base.prototype.label = "base-label";
class Derived extends Base {}
Derived.prototype.label = "derived-label";
function show(x) { return x.label; }
console.log(show(new Derived()), show(new Base()));
