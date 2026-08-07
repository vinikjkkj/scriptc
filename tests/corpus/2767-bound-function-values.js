// `Function.prototype.bind` over a compiled function value, in JavaScript —
// where a plain function's `this` is a real runtime read (the ambient
// receiver window) and a bound receiver therefore has somewhere to go.
//
// This used to be an ERASURE. `f.bind(x)` compiled to `f`, dropping the
// receiver, on the stated reason that "a compiled function value carries no
// runtime `this` to re-route". Case 1 is the counter-example: it answered a
// TypeError where Node answers "hi z", and no trap was emitted anywhere,
// because an erasure leaves nothing behind to count. That is the worst
// failure this compiler has — a silent wrong answer invisible to every
// census — and every case below is a shape that erasure got wrong or
// refused.
//
// The bound function is a closure over a wrapper that opens the ambient
// receiver window for the wrapped call's extent and closes it in a
// `finally`, so a throw out of the target cannot leave the receiver stack
// unbalanced (case 6 runs the throw).

// 1. The receiver actually binds.
function greet(g) { return g + " " + this.name; }
console.log(greet.bind({ name: "z" })("hi"));

// 2. Partial application: leading arguments are captured, the rest stay
//    parameters — which is also what makes `.length` right.
function add3(a, b, c) { return a + b + c + this.k; }
var plus = add3.bind({ k: 100 }, 1, 2);
console.log(plus(3), plus.length);

// 3. Rebinding: the FIRST bind wins. The outer wrapper pushes its receiver
//    first and the inner pushes last, and the innermost binding is the one
//    a `this` read answers -- so this needs no special case.
function who() { return this.tag; }
var b1 = who.bind({ tag: "first" });
console.log(b1.bind({ tag: "second" })());

// 4. A bound function in CONSTRUCT position. JS forwards to the target's
//    [[Construct]] with the bound arguments prepended and the bound
//    receiver IGNORED -- a constructor's receiver is the fresh instance --
//    so the instance links to the TARGET's prototype.
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.str = function () { return this.x + "," + this.y; };
var p1 = new (Point.bind({ ignored: true }))(3, 4);
console.log(p1.str(), p1 instanceof Point);
var p2 = new (Point.bind(null, 7))(8);
console.log(p2.str(), p2 instanceof Point);
var Held = Point.bind(null);
var p3 = new Held(9, 10);
console.log(p3.str(), p3 instanceof Point);

// 5. A throw out of a bound call must not leave the receiver stack out of
//    balance: the reads AFTER the catch have to answer their own binding,
//    not the abandoned one.
function boom() { throw new Error("from " + this.where); }
try {
  boom.bind({ where: "inner" })();
} catch (e) {
  console.log(e.message);
}
console.log(greet.bind({ name: "after" })("still"));

// 6. The receiver expression evaluates exactly once, at the bind.
var seen = 0;
function recv() { seen += 1; return { name: "once" }; }
var b7 = greet.bind(recv());
console.log(b7("a"), b7("b"), seen);

// 7. Binding is a VALUE operation -- the bound function is a distinct
//    function object, and the original is untouched by it.
console.log(typeof b1, b1 === who);
