// Instances in an array, read through indexing; the own-value instance differs from the rest.
class Item {
  constructor(n) { this.n = n; }
  tagAt() { this.itag = 'mid'; }
}
Item.prototype.itag = 'none';
const items = [new Item(1), new Item(2), new Item(3)];
items[1].tagAt();
const i0 = items[0];
const i1 = items[1];
const i2 = items[2];
console.log(i0.itag, i1.itag, i2.itag);
console.log(items.map((it) => it.itag).join(','));
