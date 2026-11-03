"use strict";
// defineCommand / addBuiltinCommand at run time: own members written under run-time keys, the pipeline copying the
// client's members, and membership tests.
class Script {
  constructor(lua, numberOfKeys, keyPrefix) {
    this.lua = lua;
    this.numberOfKeys = numberOfKeys;
    this.keyPrefix = keyPrefix;
  }
}
function generateScriptingFunction(functionName, commandName, script, encoding) {
  return function (...args) {
    return `${functionName}:${commandName}:${script.lua}:${script.numberOfKeys}:${encoding}:${this.options.keyPrefix}:${args.length}`;
  };
}
class Commander {
  constructor() {
    this.options = { keyPrefix: "p:" };
    this.scriptsSet = {};
    this.scriptNames = [];
    this.addedBuiltinSet = new Set();
  }
  addBuiltinCommand(commandName) {
    this.addedBuiltinSet.add(commandName);
    this[commandName] = function (...a) { return "builtin " + commandName + " " + a.join(); };
    this[commandName + "Buffer"] = function (...a) { return "builtinB " + commandName + " " + a.join(); };
  }
  defineCommand(name, definition) {
    const script = new Script(definition.lua, definition.numberOfKeys, this.options.keyPrefix);
    this.scriptsSet[name] = script;
    if (!this.scriptNames.includes(name)) this.scriptNames.push(name);
    this[name] = generateScriptingFunction(name, name, script, "utf8");
    this[name + "Buffer"] = generateScriptingFunction(name + "Buffer", name, script, null);
  }
}
class Pipeline extends Commander {
  constructor(redis) {
    super();
    this.redis = redis;
    this.options = redis.options;
    redis.scriptNames.forEach((name) => {
      this[name] = redis[name];
      this[name + "Buffer"] = redis[name + "Buffer"];
    });
    redis.addedBuiltinSet.forEach((name) => {
      this[name] = redis[name];
      this[name + "Buffer"] = redis[name + "Buffer"];
    });
  }
}
class Redis extends Commander {
  pipeline() {
    return new Pipeline(this);
  }
}
const r = new Redis();
r.defineCommand("mylock", { lua: "return 1", numberOfKeys: 2 });
r.addBuiltinCommand("zap");
console.log(String(r.mylock("a", "b")), String(r.mylockBuffer()), String(r.zap(1, 2)), String(r.zapBuffer(3)));
const p = r.pipeline();
console.log(String(p.mylock("x")), String(p.zap()), p.mylock === r.mylock, p.zapBuffer === r.zapBuffer);
r.defineCommand("mylock", { lua: "return 2", numberOfKeys: 0 });
console.log(String(r.mylock()), String(p.mylock()));
console.log(String(r.scriptNames.join()), String(r.addedBuiltinSet.size));
const k = "zap";
console.log(typeof r[k], r[k] === r.zap, p[k + "Buffer"] === r.zapBuffer, typeof r["nothing"]);
console.log(p.redis === r, "mylock" in r, "mylock" in new Redis());
