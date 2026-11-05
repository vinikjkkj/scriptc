// A class instance assigned to an interface-typed slot stays the same object: members the
// interface does not name are still there for every later reader, a write through the
// interface is the instance's write, and the instance's own writes show through.
interface Msg { name: string; length: number }
class Done implements Msg {
  name = "done";
  length: number;
  text: string;
  constructor(length: number, text: string) { this.length = length; this.text = text; }
  describe(): string { return this.name + ":" + this.text + ":" + this.length; }
}
class Rows implements Msg {
  name = "rows";
  length = -1;
  fields: string[] = [];
  count = 0;
}
const plain: Msg = { name: "plain", length: 5 };

function show(m: any): void { console.log(m.name, m.text, m.length, m.fields, m.count); }

function make(code: number): Msg {
  let message: Msg;
  switch (code) {
    case 1: message = plain; break;
    case 2: message = new Done(-1, "SELECT 1"); break;
    case 3: { const r = new Rows(); r.fields.push("a", "b"); r.count = 2; message = r; break; }
    default: throw new Error("unknown " + code);
  }
  message.length = 10 + code;
  return message;
}

for (const c of [1, 2, 3]) show(make(c));

const d = new Done(1, "x");
const m: Msg = d;
m.length = 99;
console.log(d.length, m.length);
d.length = 7;
console.log(m.length, d.describe());
console.log(JSON.stringify(m));
console.log(Object.keys(m).join(","));

const list: Msg[] = [new Done(2, "y"), new Rows()];
for (const item of list) show(item);

function pass(x: Msg): Msg { return x; }
const back = pass(d);
show(back);
