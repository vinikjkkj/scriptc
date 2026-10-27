// A Date reached through an unknown value converts with ToNumber (its time
// value) in unary +, subtraction and relational operators; the default-hint
// loose equality compares its text, so a Date is not loosely equal to its time.
// An invalid Date is NaN in every numeric position.
function plus(a: any): number { return +a; }
function minus(a: any, b: any): number { return a - b; }
function lt(a: any, b: any): boolean { return a < b; }
function eq(a: any, b: any): boolean { return a == b; }
const d = new Date(5000);
const bad = new Date("not a date");
console.log(plus(d), minus(d, 1), minus(d, d), plus(bad), lt(bad, 1), lt(1, bad));
console.log(lt(d, 6000), lt(7000, d), eq(d, 5000), eq(d, d), typeof (d as any + 1));
