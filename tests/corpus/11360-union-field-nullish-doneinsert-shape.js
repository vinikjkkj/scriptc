// doneInsert shape, closer to mysql2 commands/query.js: a method whose parameter is null or undefined at its call sites
class Q {
  constructor() {
    this._rows = [];
    this.result = 0;
  }
  doneInsert(rs) {
    this._rows.push(rs);
    this.result++;
    if (rs.serverStatus & 8) {
      return 1;
    }
    return 0;
  }
}
function pick(n) {
  if (n === 0) return null;
  return undefined;
}
const q = new Q();
for (let i = 0; i < 2; i++) {
  try {
    console.log(q.doneInsert(pick(i)));
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}
console.log(q.result);
