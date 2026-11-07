// ioredis index: the module's whole export is the class, and an accessor is then installed on that class value with defineProperty.
class Redis { constructor() { this.x = 1; } }
exports = module.exports = Redis;
Object.defineProperty(exports, "Promise", {
  get() { console.log("warn"); return Promise; },
  set(_lib) { console.log("set ignored"); },
});
exports.default = Redis;
console.log(new Redis().x);
