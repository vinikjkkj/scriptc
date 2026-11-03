"use strict";
function log(...a) {
  console.log(String(a.map((x) => String(x)).join(" | ")));
}
class Base {
  constructor() { this.opts = { p: "k:" }; this.log = []; }
  put(name, v) { this[name] = v; }
  hello() { return "base-hello"; }
  send(n, a) { return n + "(" + a.join(",") + ")" + this.opts.p; }
}
const names = ["get", "set", "exec", "hello2"];
names.forEach(function (n) {
  Base.prototype[n] = gen(n);
});
function gen(n) {
  return function (...args) { return this.send(n, args); };
}
class Sub extends Base {
  exec(x) { return "sub-exec:" + x; }
  run() { return [this.get("a"), this.exec("b"), this.hello()]; }
}
(function () {
  const b = new Base();
  const s = new Sub();
  log(b.get("a"), b.set(1, 2), b.exec(3), s.get("z"), s.exec("q"));
  log(s.run());
  b.put("custom", function (...a) { return "custom:" + a.join("+"); });
  log(b.custom(1, 2));
  b.put("hello", function () { return "own-hello"; });
  log(b.hello());
  s.put("hello", function () { return "own-sub-hello"; });
  log(s.hello(), s.run()[2]);
})();
