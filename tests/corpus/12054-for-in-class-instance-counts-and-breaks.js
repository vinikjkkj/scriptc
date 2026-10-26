// The walk of a class instance honours break, continue and a return from
// inside the loop, over its fixed key list.
class Cfg {
  host = 'localhost';
  port = 3306;
  user = 'root';
  flags = [true, false];
  first() {
    for (const k in this) {
      if (k === 'port') continue;
      if (k === 'user') return 'found ' + k;
    }
    return 'none';
  }
  count() {
    let n = 0;
    for (const k in this) {
      n++;
      if (n === 3) break;
    }
    return n;
  }
}
const c = new Cfg();
console.log(c.first(), c.count());
let seen = [];
for (const k in c) seen.push(k);
console.log(seen.length, seen[0], seen[seen.length - 1]);
