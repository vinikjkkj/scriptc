// The same Date object reached through two references: an expando written through
// one is read through the other, and a Date kept in an array sees the same member.
function tag(d, label) {
  d.label = label;
  return d;
}
function main() {
  var a = new Date(5000);
  var b = tag(a, 'first');
  b.label = b.label + '+';
  console.log(a.label, b === a, a.getTime());
  var list = [tag(new Date(0), 'zero'), tag(new Date(1000), 'one')];
  list[1].label = 'uno';
  console.log(list[0].label, list[1].label, list[1].getTime());
}
main();
