// A method read off an instance held in an untyped slot (`q.m`, or destructured `const { m } = q`) is the class's own function:
// called with no receiver it runs its body, and throws Node's TypeError only where the body touches `this`; called with a receiver
// (`.call`) it uses that one; two reads of the same method are the same function.
class Q {
  constructor(n) { this.n = n; }
  label() { return "L"; }
  twice() { return this.n * 2; }
}
function destructured(q) { const { label } = q; return label(); }
function readOff(q) { const f = q.label; return f(); }
function touchesThis(q) { const { twice } = q; try { return twice(); } catch (e) { return e.name + ": " + e.message; } }
function withReceiver(q, other) { const f = q.twice; return f.call(other); }
function sameFunction(q, r) { return q.label === r.label && q.label === q.label; }
console.log(destructured(new Q(1)), readOff(new Q(2)), touchesThis(new Q(3)), withReceiver(new Q(4), new Q(5)), sameFunction(new Q(6), new Q(7)));
