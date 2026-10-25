// A method of the class updates the prototype datum through the constructor reference; instances see it.
class Live {
  constructor(id) { this.id = id; }
}
Live.prototype.gen = 0;
const a = new Live(1);
Live.prototype.gen = Live.prototype.gen + 1;
Live.prototype.gen = Live.prototype.gen + 1;
console.log(a.gen, Live.prototype.gen);
