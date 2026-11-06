// An empty `{}` literal in authored JavaScript is an open bag: `table.argument[name] = fn` stores under whatever key the program
// computes. Writes, reads, `in`, key order (integer keys first), numeric and untyped keys, overwrite, delete, undefined values and
// functions stored as values all behave as Node does.
class Command {
  constructor(name) {
    this.name = name;
  }
  static setArgumentTransformer(name, func) {
    this._transformer.argument[name] = func;
  }
  static setReplyTransformer(name, func) {
    this._transformer.reply[name] = func;
  }
  reply(v) {
    const t = Command._transformer.reply[this.name];
    return t ? t(v) : v;
  }
  argument(v) {
    const t = Command._transformer.argument[this.name];
    return t ? t(v) : v;
  }
}
Command._transformer = { argument: {}, reply: {} };

Command.setReplyTransformer("get", (v) => "<" + v + ">");
Command.setArgumentTransformer("set", (v) => v + "!");
console.log(new Command("get").reply("x"), new Command("set").reply("x"), new Command("set").argument("y"), new Command("get").argument("y"));

const bag = Command._transformer.reply;
Command.setReplyTransformer("b", 1);
Command.setReplyTransformer(10, 2);
Command.setReplyTransformer("2", 3);
Command.setReplyTransformer("a", undefined);
Command.setReplyTransformer("get", (v) => "[" + v + "]");
console.log(Object.keys(bag), "a" in bag, "zz" in bag, 2 in bag, bag["10"], bag[2], bag.a, new Command("get").reply("q"));
delete bag.b;
console.log(Object.keys(bag).join(","), "b" in bag, Object.keys(Command._transformer.argument));
