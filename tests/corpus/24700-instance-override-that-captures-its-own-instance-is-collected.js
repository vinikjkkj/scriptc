// A function assigned onto one instance that captures that instance is a reference cycle (instance -> own function -> instance). The
// cycle collector must reclaim it once nothing else holds the instance, while instances that never got an override are released plainly.
class Pipe {
  constructor() { this.n = 0; }
  run(x) { return "base:" + this.n + ":" + x; }
}
let total = 0;
for (let i = 0; i < 3000; i++) {
  const p = new Pipe();
  p.n = i;
  if (i % 3 === 0) {
    p.run = function (x) { return "own:" + p.n + ":" + x; };
  }
  total += p.run(i).length;
}
const keep = new Pipe();
keep.n = 5;
keep.run = function (x) { return "kept:" + keep.n + ":" + x; };
const plain = new Pipe();
console.log(total, keep.run(1), plain.run(2));
