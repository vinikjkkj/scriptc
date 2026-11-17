// console.log of an Error that carries expando properties assigned from code: Node appends ' { key: value }' after the stack.
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const e = new Error('x');
(e as any).fatal = true;
(e as any).code = 'E1';
console.log(e);
const f = new Error('only-one');
(f as any).n = 42;
console.log(f);
const g = new TypeError('typed');
(g as any).s = "it's";
(g as any).o = { a: 1, b: [1, 2] };
console.log(g);
const plain = new Error('plain');
console.log(plain);
