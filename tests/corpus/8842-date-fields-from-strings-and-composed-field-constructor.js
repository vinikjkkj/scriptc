// new Date(y, m, d) / Date.UTC with a string capture group (ToNumber, as in Node) and the field constructor composed with .getTime() / .toISOString().
function mk(isoDate) {
  var matches = /^(\d+)-(\d+)-(\d+)$/.exec(isoDate);
  var year = parseInt(matches[1], 10);
  var month = parseInt(matches[2], 10) - 1;
  var day = matches[3];
  var a = new Date(year, month, day);
  var b = new Date(Date.UTC(year, month, day, 1, 2, 3, 4));
  var c = new Date(year, month, +day);
  var flag = !!matches[3];
  return [a.getTime() === c.getTime(), b.toISOString(), new Date(2020, 0, flag).getTime() === new Date(2020, 0, 1).getTime(), Date.UTC(2000, 0, 'x')];
}
console.log(mk('2020-05-17'));
console.log(new Date(2021, 1, 3, 4, 5).toISOString(), new Date(1999, 11, 31).getTime());
