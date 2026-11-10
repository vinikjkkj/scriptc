// A class method with a rest parameter, called through a receiver the compiler holds as a dynamic value (`any`, a cast, a function parameter): the call
// hands over its arguments one by one and the method must see the surplus packed into ONE array, as JavaScript binds it. Rows: rest only, fixed
// parameters followed by a rest, a spread at the call site, zero rest arguments, a typed rest.
class Pipe {
  log: string[] = [];
  restOnly(...args: unknown[]): string {
    this.log.push("rest");
    return "restOnly:" + args.length + ":" + args.map((a) => String(a)).join(",");
  }
  fixedRest(a: string, b: number, ...more: unknown[]): string {
    return "fixedRest:" + a + ":" + b + ":" + more.length + ":" + more.map((x) => String(x)).join(",");
  }
  typedRest(label: string, ...nums: number[]): string {
    let sum = 0;
    for (const n of nums) sum += n;
    return label + "=" + sum + "/" + nums.length;
  }
  count(...args: unknown[]): number {
    return args.length;
  }
}
const p: any = new Pipe() as any;
console.log(p.restOnly());
console.log(p.restOnly(1));
console.log(p.restOnly(1, "a", null, undefined, true));
console.log(p.fixedRest("x", 2));
console.log(p.fixedRest("x", 2, 3));
console.log(p.fixedRest("x", 2, 3, "four", 5));
const xs = [10, 20, 30];
console.log(p.restOnly(...xs));
console.log(p.fixedRest("s", 1, ...xs));
console.log(p.typedRest("sum"), p.typedRest("sum", 1, 2, 3, 4));
console.log(p.count(), p.count(7), p.count(...xs, ...xs));
console.log(p.log.length);
