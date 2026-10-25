// console.log of a Date that carries expandos: Node prints the ISO text, then
// its own members as one object dump, and breaks the dump across lines when the
// base text makes it too wide to fit on one.
function parseDate(value) {
  var result = new Date(946684800000 + value);
  result.usec = value % 1000;
  result.getMicroSeconds = function () {
    return this.usec;
  };
  return result;
}
var d = parseDate(1234567);
console.log(d);
console.log(String(d.getMicroSeconds()), d.usec, d.nope);
var e = new Date(0);
console.log(e);
