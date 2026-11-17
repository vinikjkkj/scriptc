// `...(flag ? { a, b } : {})` and `...(flag ? {} : { c, d })`: several properties on one arm, in either orientation, between plain properties.
interface Opts { name: string; a?: number; b?: number; c?: string; d?: string; tail: number }
function make(on: boolean): Opts {
  const flag = on;
  return { name: "n", ...(flag ? { a: 1, b: 2 } : {}), ...(flag ? {} : { c: "x", d: "y" }), tail: 9 };
}
console.log(JSON.stringify(make(true)), JSON.stringify(make(false)));
const o = make(false);
console.log(o.a === undefined, o.c, o.d, o.tail);
