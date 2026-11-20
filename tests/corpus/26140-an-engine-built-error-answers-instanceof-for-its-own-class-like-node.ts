// An error built inside new Function text, held as `any`: instanceof against each built-in class is the engine's answer.
const mkRange: any = new Function("return new RangeError('r')");
const mkType: any = new Function("return new TypeError('t')");
const mkSub: any = new Function("class Mine extends RangeError {} return new Mine('s')");
const mkPlain: any = new Function("return { message: 'not an error' }");
function check(e: any): void {
  console.log(e instanceof Error, e instanceof RangeError, e instanceof TypeError, e instanceof SyntaxError, e instanceof ReferenceError);
}
check(mkRange());
check(mkType());
check(mkSub());
check(mkPlain());
