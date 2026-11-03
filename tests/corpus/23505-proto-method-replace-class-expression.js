// Classes created by class expressions that are evaluated once (module level): the prototype is replaced like a declared class's, the wrapper idiom included.
const E = class E2 {
  constructor(n) { this.n = n; }
  hello() { return "hello " + this.n; }
  bye() { return "bye " + this.n; }
};
const e = new E("a");
const oldHello = E.prototype.hello;
E.prototype.hello = function () { return oldHello.call(this) + "!"; };
console.log(e.hello(), new E("b").hello(), oldHello === E.prototype.hello);
const Anon = class {
  twice(x) { return x * 2; }
};
const an = new Anon();
console.log(an.twice(4));
Anon.prototype.twice = function (x) { return x * 3; };
console.log(an.twice(4), new Anon().twice(5), e.bye());
E.prototype.bye = function () { return "BYE " + this.n; };
console.log(new E("c").bye(), e.bye());
