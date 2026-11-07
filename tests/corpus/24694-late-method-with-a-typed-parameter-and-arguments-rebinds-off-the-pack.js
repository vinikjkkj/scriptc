class Commander { constructor() { this.tag = "c"; } }
["exec", "execBuffer"].forEach(function (name) { Commander.prototype[name] = function (...a) { return name + ":" + a.join("|") + ":" + this.tag; }; });
class Pipeline extends Commander { constructor() { super(); this._t = 1; } }
const execBuffer = Pipeline.prototype.execBuffer;
/**
 * @param {(err: Error | null, result: [error: Error | null, result: unknown][] | null) => void} callback
 */
Pipeline.prototype.exec = function (callback) {
  if (this._t > 0) {
    this._t -= 1;
    return execBuffer.apply(this, arguments);
  }
  if (callback) callback(null, []);
  return "exec " + arguments.length;
};
const p = new Pipeline();
console.log(p.exec(), p.exec(), p.exec(function () {}));
