class Base {
  count = 0;
  ping(): string { return "pong"; }
  tag<T>(x: T): T { return x; }
}
class Child extends Base {
  extra(n: number): number { return n + 1; }
}
interface Opts { host: string; port: number }
let made = 0;
function make(): Child { made++; return new Child(); }
const c = new Child();
console.log(typeof c.ping, typeof c.tag, typeof c.extra, typeof c.count);
console.log(typeof make().tag, made);
console.log(typeof (c as Base).tag === "function", typeof (c as Base).ping === "function");
function isPool(v: Base | Opts): v is Base {
  return typeof (v as Base).ping === "function";
}
function isPoolGeneric(v: Child | Opts): boolean {
  return typeof (v as Child).tag === "function";
}
console.log(isPool(c), isPool({ host: "h", port: 1 }), isPool(new Base()));
console.log(isPoolGeneric(c), isPoolGeneric({ host: "h", port: 2 }));
function pick(flag: boolean): Base | Opts { return flag ? new Base() : { host: "x", port: 3 }; }
console.log(typeof (pick(true) as Base).ping, typeof (pick(false) as Base).ping);
