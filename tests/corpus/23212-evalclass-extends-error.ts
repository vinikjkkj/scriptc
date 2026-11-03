// A factory returning `class extends Error`: instanceof tells evaluations apart, members read the captured code.
function makeError(code: string) {
  return class CodedError extends Error {
    code2: string;
    constructor(message: string) {
      super(message);
      this.code2 = code;
    }
    describe(): string {
      return code + ":" + this.message;
    }
  };
}
const E1 = makeError("E1");
const E2 = makeError("E2");
const a = new E1("boom");
const b = new E2("two");
console.log(a instanceof E1, a instanceof E2, a instanceof Error, b instanceof E2, b instanceof E1);
console.log(a.describe(), a.code2, a.message, b.describe(), b.name);
try { throw a; } catch (e) { console.log((e as Error).message); }
