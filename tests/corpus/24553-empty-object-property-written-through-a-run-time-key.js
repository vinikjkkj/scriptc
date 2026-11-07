// A property bound to an EMPTY object literal and written through a run-time key is a string-keyed table (ioredis'
// `Command._transformer = { argument: {}, reply: {} }`, filled by `this._transformer.reply[name] = func`). The static
// expando after a class, the nested members, and the direct `C.t = {}` all take keys the literal never named: absent keys
// read undefined, a later write replaces, and the functions stored in the table keep their identity and run.
class Cmd {
  constructor(name) { this.name = name; }
  static setArg(name, func) { this._tr.argument[name] = func; }
  static setReply(name, func) { this._tr.reply[name] = func; }
  run(x) {
    const tr = Cmd._tr.reply[this.name];
    if (tr) return tr(x, { commandName: this.name });
    return x;
  }
  args(a) {
    const t = Cmd._tr.argument[this.name];
    return t ? t(a) : a;
  }
}
Cmd._tr = { argument: {}, reply: {} };
Cmd.setArg("mset", (a) => a.concat(["z"]));
Cmd.setReply("hgetall", (r, o) => r.length + ":" + o.commandName);
console.log(new Cmd("mset").args([1]), new Cmd("hgetall").run([1, 2]), new Cmd("none").run(5), new Cmd("x").args([2]));
Cmd.setReply("hgetall", (r) => "replaced" + r.length);
console.log(new Cmd("hgetall").run([1, 2, 3]));

class Registry {
  static add(key, fn) { Registry.handlers[key] = fn; }
  static call(key, v) { const h = Registry.handlers[key]; return h === undefined ? "none:" + key : h(v); }
}
Registry.handlers = {};
Registry.add("double", (v) => v * 2);
Registry.add("name", (v) => "<" + v + ">");
console.log(Registry.call("double", 21), Registry.call("name", "n"), Registry.call("missing", 0));

const counts = { seen: {} };
function count(word) { counts.seen[word] = (counts.seen[word] || 0) + 1; }
["a", "b", "a", "c", "a", "b"].forEach(count);
console.log(counts.seen.a, counts.seen.b, counts.seen.c, counts.seen.d);
