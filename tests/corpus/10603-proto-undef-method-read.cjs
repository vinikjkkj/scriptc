// A method reads the prototype datum through this, before and after the instance's own write.
class Cell {
  constructor(id) { this.id = id; }
  label() { return this.tag === undefined ? 'none' + this.id : this.tag; }
  tagIt() { this.tag = "hot"; }
}
Cell.prototype.tag = undefined;
const c = new Cell(1);
console.log(c.label());
c.tagIt();
console.log(c.label(), new Cell(2).label());
