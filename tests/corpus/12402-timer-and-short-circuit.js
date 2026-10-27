// The feature check as the left operand of &&, and its negation in a condition.
function main() {
  var t = setTimeout(function () {}, 60000);
  t.unref && t.unref();
  if (!t.ref) {
    console.log("no ref");
  } else {
    console.log("has ref");
  }
  console.log("released", t.hasRef());
  clearTimeout(t);
}
main();
