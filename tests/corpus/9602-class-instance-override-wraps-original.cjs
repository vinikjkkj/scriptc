// An instance override that captures the class method and wraps it.
class Pipe {
  constructor() { this.v = 5; }
  run() { return this.v; }
}
const p = new Pipe();
const orig = p.run;
p.run = function () { return orig.call(this) * 10; };
console.log(p.run(), new Pipe().run());
