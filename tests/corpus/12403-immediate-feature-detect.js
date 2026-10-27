// The same check on an Immediate handle.
function main() {
  var im = setImmediate(function () {
    console.log("immediate ran");
  });
  if (im.unref) {
    im.unref();
  }
  console.log("immediate hasRef", im.hasRef());
  clearImmediate(im);
}
main();
