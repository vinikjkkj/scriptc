// Array.prototype.<method>.call(arrayLike, ...) on a builtin, over a Buffer and over arrays:
// the dbcs-codec shape is a dyn instance field (this.prevBytes) concatenated with a borrowed
// generic slice of a dyn Buffer receiver.
function Dec() {
  this.prevBytes = [9, 8];
}
Dec.prototype.write = function (buf, seqStart) {
  var tail = this.prevBytes.slice(seqStart + 1).concat(Array.prototype.slice.call(buf));
  return tail.join(",");
};
var d = new Dec();
console.log(d.write(Buffer.from([1, 2, 3, 4, 5]), 2));
console.log(Array.prototype.slice.call(Buffer.from([1, 2, 3, 4, 5]), 2).join(","));
console.log(Array.prototype.join.call([7, 8, 9], "-"));
function Who(x) { return this.name + x; }
console.log(Who.call({ name: "n" }, "!"));
