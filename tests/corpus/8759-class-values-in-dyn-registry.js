class A { constructor(p) { this.p = p; this.name = 'A'; } }
class B { constructor(p) { this.p = p * 2; this.name = 'B'; } }
const parsers = {};
parsers[2] = A;
parsers[4] = B;
function make(type, p) { const P = parsers[type]; if (P) { return new P(p); } return null; }
console.log(make(2, 5), make(4, 5), make(9, 1));
const i2 = make(2, 7);
console.log(i2.p, i2.name, make(4, 3).p);
class C3 { constructor(a, b) { this.s = a + b; } hi() { return 'hi' + this.s; } }
parsers[7] = C3;
function make2(t, a, b) { const K = parsers[t]; return new K(a, b); }
const c3 = make2(7, 1, 2);
console.log(c3.s, c3.hi());
class D1 { constructor(a) { this.a = a; } get twice() { return this.a * 2; } hi() { return 'D1:' + this.a; } }
class D2 extends D1 { constructor(a) { super(a + 1); this.tag = 'd2'; } hi() { return 'D2:' + super.hi(); } }
parsers[8] = D1; parsers[9] = D2;
function build(t, a) { const K = parsers[t]; return new K(a); }
const d1 = build(8, 1), d2 = build(9, 1);
console.log(d1.twice, d1.hi(), d2.twice, d2.hi(), d2.tag);
console.log(typeof parsers[8], typeof build(9, 5).hi);
