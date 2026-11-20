// `f() instanceof C` where the answer is static: the operand still runs, once, left before right.
class A { n = 1; }
class B extends A {}
const log: string[] = [];
function mkA() { log.push("mkA"); return new A(); }
function mkB() { log.push("mkB"); return new B(); }
function cls() { log.push("cls"); return A; }
console.log(mkA() instanceof A, mkB() instanceof A, mkA() instanceof B);
console.log(mkB() instanceof cls());
console.log(log.join(","));
const objs = [new A(), new B()];
console.log(objs[1] instanceof B, objs.map((o) => o instanceof A), (new B() as A) instanceof A);
