// Logical assignment (||=, &&=, ??=) on dyn fields, dyn elements, typed fields with
// a nullable union, and locals. The store happens only when the test asks for it;
// the calls log counts every receiver evaluation.
let calls = "";
function key(k: string): string { calls += "k(" + k + ");"; return k; }
function recv(r: any): any { calls += "r;"; return r; }

class Box {
  inner: any;
  fieldS: string = "";
  fieldN: number = 0;
  constructor(inner: any) { this.inner = inner; }
}

class Holder {
  box: any;
  constructor(box: any) { this.box = box; }
  logical(): string {
    const o = this.box.inner;
    o.maybe ??= "fill";
    o.maybe ||= "never";
    o.flag &&= 5;
    o.zero ||= 9;
    o.zero &&= 7;
    return JSON.stringify(o);
  }
}

const h = new Holder({ inner: { maybe: null, flag: 1, zero: 0 } });
console.log(h.logical());

const data: any = { a: 0, b: "x", c: null };
calls = "";
recv(data)[key("a")] ||= 4;
recv(data)[key("b")] &&= "y";
recv(data)[key("c")] ??= "z";
recv(data)[key("c")] ??= "never";
console.log(JSON.stringify(data), calls);

const counts: number[] = [0, 3];
calls = "";
counts[1] &&= 9;
counts[0] ||= 5;
console.log(counts.join(","));

let loc: string | null = null;
loc ??= "set";
let zz = 0;
zz ||= 2;
let yy = 1;
yy &&= 0;
console.log(loc, zz, yy);

class Pair { left: number = 0; right: string | undefined = undefined; }
const p = new Pair();
p.left ||= 3;
p.right ??= "r";
p.right ??= "again";
console.log(p.left, p.right);
console.log(calls);
