// The feature check inside a loop that arms and clears a handle each pass.
function main() {
  var total = 0;
  for (var i = 0; i < 3; i++) {
    var t = setTimeout(function () {}, 60000);
    if (t.unref) {
      t.unref();
      total = total + 1;
    }
    clearTimeout(t);
  }
  console.log("unrefed", total);
}
main();
