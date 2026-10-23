// The CommonJS consumer of declared-and-twinned CLASSES. `new rs.Box(4)`,
// `rs.Box.make(9)` and `rs.Box.KIND` read a class through a require binding;
// `class X extends rs.Base` extends it (named and `exports.default` forms, with
// `super` calls); `instanceof` takes the qualified class on its right.
const rs = require("twinpkg");
const m = require("twindef");

const b = new rs.Box(4);
console.log("get=" + String(b.get()));
console.log("make=" + String(rs.Box.make(9).get()) + " kind=" + rs.Box.KIND);
const o = new rs.Other();
console.log(o.tag());
console.log(String(o instanceof rs.Box) + String(b instanceof rs.Other) + String(o instanceof rs.Other));
console.log("v=" + String(b.v));
b.v = 11;
console.log("v2=" + String(b.get()));

// the default export, which the declaration spells `export default class`
const c = new m.default("a");
console.log(c.ping());
console.log(m.default.create("q").ping() + String(m.default.instances));
const s = new m.Sub();
console.log(s.ping() + String(s.extra()) + String(s instanceof m.default));

class MyClient extends m.default {
  ping() {
    return "my-" + super.ping();
  }
}
const k = new MyClient("k");
console.log(k.ping() + String(k instanceof m.default) + String(k instanceof MyClient));
class MySub extends m.Sub {
  extra() {
    return super.extra() + 1;
  }
}
console.log(String(new MySub().extra()) + new MySub().ping());
