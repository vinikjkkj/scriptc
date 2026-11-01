// The bson Code shape: a constructor that stores `code.toString()` of a
// `string | Function` parameter, called with a declaration and a string.
class Code {
  code: string;
  scope: number | null;
  constructor(code: string | Function, scope?: number | null) {
    this.code = code.toString();
    this.scope = scope ?? null;
  }
}
function add(a: number, b: number) {
  return a + b;
}
const fromFn = new Code(add, 1);
const fromStr = new Code("return 42;");
console.log(fromFn.code);
console.log(fromFn.scope);
console.log(fromStr.code, fromStr.scope);
console.log(new Code((x: number) => x - 1).code);
