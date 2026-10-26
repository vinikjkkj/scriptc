// element read over a string[] | boolean union (mysql2 parser_cache sameList): the boolean arm answers undefined, the array arm its element
function keyOf(n) {
  if (n === 0) return true;
  return ['x', 'y'];
}
function row(n) {
  const v = keyOf(n);
  const out = [];
  for (let i = 0; i < 2; i++) {
    out.push(String(v[i]));
  }
  return out.join(',');
}
console.log(row(0), row(1));
function first(n) {
  const v = keyOf(n);
  return v[0];
}
console.log(String(first(1)), String(first(0)));
