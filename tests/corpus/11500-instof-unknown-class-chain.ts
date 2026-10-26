// instanceof of a program class on an unknown value: a C instance, a subclass D of C,
// an unrelated E, a plain object, null, undefined, a number and a string, each tested
// against C, against the subclass D, and against E. Node: a subclass instance is
// instanceof its base; primitives, null and undefined are never instances.
class C {
  tag = "C";
}
class D extends C {
  extra = 1;
}
class E {
  tag = "E";
}
function pick(i: number): unknown {
  switch (i) {
    case 0: return new C();
    case 1: return new D();
    case 2: return new E();
    case 3: return { tag: "C" };
    case 4: return null;
    case 5: return undefined;
    case 6: return 42;
    default: return "str";
  }
}
for (let i = 0; i < 8; i++) {
  const v = pick(i);
  console.log(i, v instanceof C, v instanceof D, v instanceof E);
}
