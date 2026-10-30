// A function-valued class field is named by its key, the way JS's
// NamedEvaluation names every anonymous function in a field initializer.
// `console.log` of the field used to print `[Function (anonymous)]`, and
// the instance printed `toString: [Function (anonymous)]`; node prints
// `[Function: toString]` and `T { toString: [Function: toString], g: [Function: f2] }`.
const f2 = (): number => 2;
class T {
  toString = (): string => "F";
  g = f2;
  static s = (): number => 3;
}
const t: any = new T();
console.log(t.toString);
console.log(t);
const tt = new T();
console.log(tt);
console.log(String(tt.toString()));
console.log(T.s);
