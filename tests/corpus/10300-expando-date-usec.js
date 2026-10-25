// A JavaScript expando on a Date (the pg-types microsecond idiom): own data
// members written onto a Date, own function members that read `this`, and the
// Date methods still working beside them.
function parseDate(value) {
  var result = new Date(946684800000 + value);
  result.usec = value % 1000;
  result.getMicroSeconds = function () {
    return this.usec;
  };
  result.setMicroSeconds = function (v) {
    this.usec = v;
  };
  return result;
}
function main() {
  var d = parseDate(1234567);
  console.log(d.getTime());
  console.log(d.usec);
  console.log(d.getMicroSeconds());
  d.setMicroSeconds(42);
  console.log(d.getMicroSeconds(), d.usec);
  console.log(d instanceof Date, typeof d.getMicroSeconds, d.nope);
  console.log(d.toISOString());
}
main();
