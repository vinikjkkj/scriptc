// The constructor writes the field from a property read (a raw double while it holds a number); a later dyn keyed write of ANOTHER kind (and back to
// a number) through an untyped receiver must replace the value for every reader, including the typed one, the dyn read and the arithmetic over it.
class Rec {
  n: number;
  off: any;
  label: string;
  size: any;
  constructor(n: number, src: any) {
    this.n = n;
    this.off = src.off;
    this.label = "r" + n;
    this.size = src.size;
  }
  end(): any {
    return this.off + this.size;
  }
}

function setKey(o: any, k: string, v: any): void {
  o[k] = v;
}
function getKey(o: any, k: string): any {
  return o[k];
}
function asAny(x: any): any {
  return x;
}
function show(tag: string, r: Rec): void {
  const o: any = asAny(r);
  console.log(tag, Object.is(r.off, getKey(o, "off")), String(r.off), typeof r.off, String(r.size), typeof r.size, String(r.end()), JSON.stringify(o));
}

const r = new Rec(1, { off: 4096, size: 65535 });
show("init", r);
setKey(r, "off", "str");
show("to-string", r);
setKey(r, "off", 70000.5);
show("to-number", r);
setKey(r, "off", null);
show("to-null", r);
setKey(r, "off", -0);
show("to-negzero", r);
setKey(r, "off", NaN);
show("to-nan", r);
setKey(r, "off", { deep: [1, 2] });
show("to-object", r);
setKey(r, "size", 123456);
show("size-num", r);
setKey(r, "size", undefined);
show("size-undef", r);

// A write through the typed side is not allowed by the rule (it would make the field non-slot): the class has none; instances stay independent.
const a = new Rec(2, { off: 5000, size: 6000 });
const b = new Rec(3, { off: 5000, size: 6000 });
setKey(a, "off", 9999);
show("a", a);
show("b", b);
show("a-last", a);
