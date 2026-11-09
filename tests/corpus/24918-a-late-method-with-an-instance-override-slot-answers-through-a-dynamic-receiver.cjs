// A method assigned on the prototype (`P.prototype.exec = function`) that one instance overrides with an own property: through a dynamic receiver the other instance still answers the method (ioredis' Pipeline#exec).
class P {
  constructor() {
    this.queue = [];
  }
}
P.prototype.exec = function (callback) {
  return "exec:" + (callback ? "cb" : "none");
};
// a late method that reads `arguments` (a variadic one), as ioredis' command methods do
P.prototype.run = function (first) {
  return "run:" + arguments.length + ":" + first;
};
function viaDyn(x) {
  return x.exec() + "/" + x.run(1, 2);
}
const a = new P();
const b = new P();
b.exec = function () {
  return "wrapped";
};
console.log(a.exec(), b.exec(), a.run(7));
console.log(viaDyn(a), viaDyn(b));
