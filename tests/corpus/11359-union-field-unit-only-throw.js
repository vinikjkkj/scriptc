// the query.js doneInsert shape (mysql2 commands/query.js:124): a field read on a null | undefined value
function serverStatusBits(rs) {
  return rs.serverStatus & 8;
}
function pick(n) {
  if (n === 0) return null;
  return undefined;
}
for (let i = 0; i < 2; i++) {
  try {
    console.log(serverStatusBits(pick(i)));
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}
