// field read on a record | null | undefined union (the mysql2 doneInsert shape): the record arm answers, the unit arms throw Node's TypeError
class Header {
  constructor(n) {
    this.fieldCount = n;
    if (n > 1) {
      this.serverStatus = 8;
    } else {
      this.serverStatus = 0;
    }
  }
}
function pick(n) {
  if (n === 0) return null;
  if (n === 1) return undefined;
  return new Header(n);
}
function status(n) {
  return pick(n).serverStatus;
}
for (let i = 0; i < 4; i++) {
  try {
    console.log(status(i));
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}
const done = (rs) => (rs.serverStatus & 8 ? "more" : "done");
console.log(done(new Header(2)));
try {
  console.log(done(pick(0)));
} catch (e) {
  console.log(e.name + ": " + e.message);
}
