// A DEFAULTED parameter in an object-literal method under a record
// annotation -- the other half of the omittable ABI slot, and the half
// where an explicitly-undefined argument is NOT the same as a missing
// one at the observation point: JS runs the default for both, so both
// must print the default and neither may print undefined.
//
// It was refused with corpus 7120's optional form and for the same
// reason: a MethodDeclaration is not an Expression, so the value rule
// had no target type to judge against and fenced every object-literal
// method whose ABI slot was not exactly its declared parameter list.
interface D {
  f(a: string, b?: number): string;
  g(a: string, b?: readonly unknown[]): string;
}

const d: D = {
  f(a: string, b = 5): string {
    return a + '|' + String(b) + '|' + typeof b;
  },
  g(a: string, b: readonly unknown[] = [1, 2]): string {
    return a + '|' + String(b.length);
  },
};

console.log(d.f('x'));
console.log(d.f('x', 9));
console.log(d.f('x', undefined));
console.log(d.g('y'));
console.log(d.g('y', ['a']));
console.log(d.g('y', undefined));
// present then absent -- the stale-slot test for the defaulted form.
console.log(d.f('z', 42));
console.log(d.f('z'));
