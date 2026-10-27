// The same feature check on a local handle, then a second read after the call.
function main() {
  var t = setTimeout(function () {
    console.log("never runs");
  }, 60000);
  if (t.unref) {
    t.unref();
  }
  console.log("hasRef", t.hasRef());
  clearTimeout(t);
  console.log("done");
}
main();
