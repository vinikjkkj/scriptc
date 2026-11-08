// The applyMixin(Y, EventEmitter) helper copies EventEmitter's prototype onto Y.prototype with defineProperty. Every call of it in this program is a
// graft statement the compiler lowers to nothing, so the write never runs; a class expression evaluated inside a function (Script's Command) that
// crosses into untyped code must not make the fence refuse the helper's body.
const { EventEmitter } = require("events");
const applyMixin_1 = require("./utils/applyMixin.cjs");

class Commander {
  describe() {
    return "commander";
  }
}
class Redis extends Commander {
  constructor() {
    super();
    this.status = "wait";
  }
}
applyMixin_1.default(Redis, EventEmitter);

const registry = [];
function register(C) {
  registry.push(C);
  return typeof C + ":" + C.name;
}

class Script {
  constructor(tag) {
    this.Command = class CustomScriptCommand extends Commander {
      describe() {
        return "script:" + tag;
      }
    };
    this.label = register(this.Command);
  }
}

const r = new Redis();
r.on("ready", (who) => console.log("ready", who, r.status));
r.emit("ready", r.describe());
const s = new Script("lua");
const Cmd = s.Command;
console.log(new Cmd().describe(), typeof Cmd, r.listenerCount("ready"), s.label, registry.length);
