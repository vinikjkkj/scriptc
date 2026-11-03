// .name follows NamedEvaluation; inspect of values and instances is exact.
class Base {
  b = 1;
}
function f1() {
  return class {
    x = 1;
  };
}
function f2() {
  return class extends Base {
    y = 2;
  };
}
function f3() {
  const Named = class {
    z = 3;
  };
  return Named;
}
function f4(k: number) {
  return class Inner extends Base {
    w = k;
  };
}
console.log(new (f1())(), new (f2())(), new (f3())(), new (f4(9))());
console.log(f1(), f2(), f3(), f4(1));
console.log(f1().name === "", f2().name === "", f3().name, f4(1).name);
console.log([f3(), f4(2)]);
console.log({ a: f3(), b: f4(3) });
console.log(String(new (f1())()), `${new (f4(1))()}`);
