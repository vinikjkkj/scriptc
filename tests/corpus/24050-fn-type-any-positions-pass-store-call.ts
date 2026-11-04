// Function types whose parameters and returns are `any`: declared, stored in a variable, a record
// field and an array, passed as callbacks, returned from a function and called back. Every position
// holds a closure whose parameters and result are checked-dynamic values.
type Parser = (source: string, transform: (entry: any) => any) => any;
type Hook = (value: any) => any;

const splitWith: Parser = (source, transform) => source.split(",").map((e) => transform(e)).join("|");
console.log(splitWith("a,b,c", (e) => e + "!"));
console.log(splitWith("1,2", (e) => Number(e) * 3));

const stored: Hook = (v) => (typeof v === "number" ? v + 1 : String(v) + "?");
console.log(stored(1), stored("x"), stored(true));

const rec: { hook: Hook; run: (h: Hook, v: any) => any } = {
  hook: stored,
  run: (h, v) => h(v),
};
console.log(rec.run(rec.hook, 41), rec.hook === stored);

const hooks: Hook[] = [stored, (v) => v, (v) => String(v).length];
console.log(hooks.map((h) => h("q")).join(","));

function makeAdder(n: number): (x: any) => any {
  return (x) => x + n;
}
const add2 = makeAdder(2);
console.log(add2(5), add2("s"), typeof add2);

function apply(h: (x: any) => any, v: any): any {
  return h(v);
}
console.log(apply(add2, 10), apply((x) => x, null), apply((x) => typeof x, undefined));
